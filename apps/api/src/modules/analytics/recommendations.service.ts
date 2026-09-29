import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  Inject,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  and,
  eq,
  gte,
  inArray,
  lte,
} from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DRIZZLE } from '../../db/db.module.js';
import * as schema from '../../db/schema.js';
import { BrandContextService } from '../brands/brand-context.service.js';
import { CampaignsService } from '../campaigns/campaigns.service.js';
import { ContentService } from '../content/content.service.js';
import { SchedulingService } from '../scheduling/scheduling.service.js';
import { ProviderRegistry } from '../channels/ProviderRegistry.js';
import {
  asNumericMetrics,
  calendarDayInZone,
} from './analytics.service.js';

import {
  sanitizeInsightAction,
  type AiInsightAction,
} from './recommendation-policy.js';

type AiInsight = {
  finding: string;
  evidence: string[];
  recommendation: string;
  impact_estimate: string;
  confidence: 'low' | 'medium' | 'high';
  action: AiInsightAction;
};

type AiInsightResponse = {
  insights: AiInsight[];
  summary: string;
};

type ContentPerformance = {
  content_item_id: number;
  title: string;
  platform: string;
  published_at: string | null;
  metrics: Record<string, number>;
};

type UpcomingSchedule = {
  schedule_id: number;
  content_item_id: number;
  title: string;
  platform: string;
  scheduled_at: string;
};

function interactionScore(metrics: Record<string, number>) {
  return (
    (metrics.reactions || metrics.likes || 0) +
    (metrics.comments || 0) * 2 +
    (metrics.shares || metrics.reshares || 0) * 3 +
    (metrics.clicks || metrics.link_clicks || 0)
  );
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}

function numberFrom(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

@Injectable()
export class RecommendationsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly brandContext: BrandContextService,
    private readonly campaigns: CampaignsService,
    private readonly content: ContentService,
    private readonly scheduling: SchedulingService,
    private readonly providerRegistry: ProviderRegistry,
  ) {}

  list(workspaceId: number, limit = 30) {
    return this.db.query.aiInsights.findMany({
      where: eq(schema.aiInsights.workspaceId, workspaceId),
      orderBy: (fields, { desc }) => [desc(fields.createdAt)],
      limit: Math.min(100, Math.max(1, limit)),
    });
  }

  async generate(
    workspaceId: number,
    brandId?: number,
    options: {
      supersedePending?: boolean;
      generationId?: string;
    } = {},
  ) {
    const requestedGenerationId = options.generationId?.trim().slice(0, 64);
    if (requestedGenerationId) {
      const existing = await this.db.query.aiInsights.findMany({
        where: and(
          eq(schema.aiInsights.workspaceId, workspaceId),
          eq(schema.aiInsights.generationId, requestedGenerationId),
        ),
        orderBy: (fields, { asc }) => [asc(fields.id)],
      });

      if (existing.length) {
        return {
          generationId: requestedGenerationId,
          summary: existing[0]?.summary || '',
          insights: existing,
        };
      }
    }

    const evidence = await this.buildEvidence(workspaceId);
    if (!evidence.metrics.length || !evidence.contentPerformance.length) {
      throw new BadRequestException(
        'Published content with provider metrics is required before generating recommendations',
      );
    }

    const brand = await this.brandContext.get(workspaceId, brandId);
    const baseUrl = process.env.AI_SERVICE_URL || 'http://localhost:8000';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);

    let generated: AiInsightResponse;
    try {
      const response = await fetch(baseUrl + '/v1/insights/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          metrics: evidence.metrics,
          content_performance: evidence.contentPerformance,
          upcoming_schedules: evidence.upcomingSchedules,
          available_channels: evidence.availableChannels,
          brand_context: this.brandContext.serialize(brand),
        }),
      });

      if (!response.ok) {
        throw new BadGatewayException(
          `AI service returned HTTP ${response.status}`,
        );
      }

      generated = (await response.json()) as AiInsightResponse;
    } catch (error) {
      if (error instanceof BadGatewayException) throw error;
      throw new BadGatewayException('AI insight service unavailable');
    } finally {
      clearTimeout(timer);
    }

    const generationId = requestedGenerationId || randomUUID();
    const safeInsights = (generated.insights || [])
      .slice(0, 5)
      .map((insight) => {
        const action = sanitizeInsightAction(
          insight.action,
          insight.recommendation,
          evidence,
        );

        return {
          finding: String(insight.finding || '').slice(0, 4000),
          evidence: Array.isArray(insight.evidence)
            ? insight.evidence
                .filter((item): item is string => typeof item === 'string')
                .slice(0, 8)
            : [],
          recommendation: String(insight.recommendation || '').slice(0, 4000),
          impactEstimate: String(insight.impact_estimate || '').slice(0, 1000),
          confidence: ['low', 'medium', 'high'].includes(insight.confidence)
            ? insight.confidence
            : 'medium',
          action,
        };
      })
      .filter((insight) => insight.finding && insight.recommendation);

    const evidenceData = {
      windowStart: evidence.windowStart,
      windowEnd: evidence.windowEnd,
      contentPerformance: evidence.contentPerformance,
      upcomingSchedules: evidence.upcomingSchedules,
      availableChannels: evidence.availableChannels,
    };

    const inserted = await this.db.transaction(async (tx) => {
      if (options.supersedePending !== false) {
        await tx
          .update(schema.aiInsights)
          .set({ status: 'superseded', updatedAt: new Date() })
          .where(
            and(
              eq(schema.aiInsights.workspaceId, workspaceId),
              inArray(schema.aiInsights.status, ['pending', 'informational']),
            ),
          );
      }

      if (!safeInsights.length) return [];

      return tx
        .insert(schema.aiInsights)
        .values(
          safeInsights.map((insight) => ({
            workspaceId,
            brandId: brand?.id || null,
            generationId,
            summary: String(generated.summary || '').slice(0, 4000),
            finding: insight.finding,
            evidence: insight.evidence,
            evidenceData,
            recommendation: insight.recommendation,
            impactEstimate: insight.impactEstimate,
            confidence: insight.confidence,
            actionType: insight.action.type,
            actionPayload: insight.action.payload,
            status:
              insight.action.type === 'none'
                ? 'informational'
                : 'pending',
          })),
        )
        .returning();
    });

    return {
      generationId,
      summary: String(generated.summary || ''),
      insights: inserted,
    };
  }

  async execute(workspaceId: number, insightId: number) {
    const insight = await this.requireInsight(workspaceId, insightId);

    if (insight.status === 'executed') return insight;
    if (['dismissed', 'superseded', 'informational'].includes(insight.status)) {
      throw new ConflictException(
        'This recommendation is not available for execution',
      );
    }
    if (insight.actionType === 'none') {
      throw new BadRequestException('This insight has no domain action');
    }

    const [claimed] = await this.db
      .update(schema.aiInsights)
      .set({ status: 'executing', error: null, updatedAt: new Date() })
      .where(
        and(
          eq(schema.aiInsights.id, insightId),
          eq(schema.aiInsights.workspaceId, workspaceId),
          inArray(schema.aiInsights.status, ['pending', 'failed']),
        ),
      )
      .returning();

    if (!claimed) {
      const current = await this.requireInsight(workspaceId, insightId);
      if (current.status === 'executed') return current;
      throw new ConflictException('Recommendation is already being executed');
    }

    try {
      const result = await this.executeAction(claimed);

      const [completed] = await this.db
        .update(schema.aiInsights)
        .set({
          status: 'executed',
          result,
          error: null,
          executedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.aiInsights.id, claimed.id))
        .returning();

      return completed;
    } catch (error) {
      const message =
        error instanceof Error ? error.message.slice(0, 2000) : String(error);

      await this.db
        .update(schema.aiInsights)
        .set({
          status: 'failed',
          error: message,
          updatedAt: new Date(),
        })
        .where(eq(schema.aiInsights.id, claimed.id));

      throw error;
    }
  }

  async dismiss(workspaceId: number, insightId: number) {
    const [dismissed] = await this.db
      .update(schema.aiInsights)
      .set({ status: 'dismissed', updatedAt: new Date() })
      .where(
        and(
          eq(schema.aiInsights.id, insightId),
          eq(schema.aiInsights.workspaceId, workspaceId),
          inArray(schema.aiInsights.status, [
            'pending',
            'failed',
            'informational',
          ]),
        ),
      )
      .returning();

    if (!dismissed) {
      throw new ConflictException(
        'Only pending, failed, or informational recommendations can be dismissed',
      );
    }

    return dismissed;
  }

  private async executeAction(
    insight: typeof schema.aiInsights.$inferSelect,
  ): Promise<Record<string, unknown>> {
    if (insight.actionType === 'create_campaign') {
      return this.executeCampaign(insight, false);
    }
    if (insight.actionType === 'repurpose_content') {
      return this.executeCampaign(insight, true);
    }
    if (insight.actionType === 'reschedule_publication') {
      const payload = asRecord(insight.actionPayload);
      const scheduleId = numberFrom(payload.scheduleId);
      const suggestedAt =
        typeof payload.suggestedAt === 'string'
          ? payload.suggestedAt
          : undefined;

      if (!scheduleId || !suggestedAt) {
        throw new BadRequestException(
          'Recommendation is missing a valid schedule target',
        );
      }

      const schedule = await this.scheduling.updateSchedule(
        insight.workspaceId,
        scheduleId,
        { scheduledAt: suggestedAt },
      );

      return {
        scheduleId: schedule.id,
        scheduledAt: schedule.scheduledAt.toISOString(),
        status: schedule.status,
      };
    }

    throw new BadRequestException('Unsupported recommendation action');
  }

  private async executeCampaign(
    insight: typeof schema.aiInsights.$inferSelect,
    repurpose: boolean,
  ) {
    const payload = asRecord(insight.actionPayload);
    const checkpoint = asRecord(insight.result);
    let campaignId = numberFrom(checkpoint.campaignId);

    let source:
      | Awaited<ReturnType<ContentService['findOne']>>
      | undefined;

    if (repurpose) {
      const sourceContentId = numberFrom(payload.sourceContentId);
      if (!sourceContentId) {
        throw new BadRequestException(
          'Repurpose recommendation has no source content',
        );
      }
      source = await this.content.findOne(
        insight.workspaceId,
        sourceContentId,
      );
    }

    const platforms = Array.isArray(payload.targetPlatforms)
      ? payload.targetPlatforms.filter(
          (item): item is string => typeof item === 'string',
        )
      : [];
    const goal =
      typeof payload.campaignGoal === 'string' && payload.campaignGoal.trim()
        ? payload.campaignGoal.trim()
        : insight.recommendation;

    if (!campaignId) {
      const created = await this.campaigns.create(insight.workspaceId, {
        brandId: source?.brandId || insight.brandId || undefined,
        name: repurpose
          ? `Repurpose: ${source?.title || 'winning content'}`
          : `Insight: ${goal.slice(0, 120)}`,
        description: repurpose
          ? [
              'Evidence-backed repurpose recommendation.',
              `Source title: ${source?.title || ''}`,
              source?.description
                ? `Source description: ${source.description}`
                : '',
              `Recommendation: ${insight.recommendation}`,
            ]
              .filter(Boolean)
              .join('\n')
          : `Created from SoStats analytics insight #${insight.id}.\n${insight.recommendation}`,
        goal,
        channels: platforms,
      });
      campaignId = created.id;

      await this.db
        .update(schema.aiInsights)
        .set({
          result: {
            ...checkpoint,
            campaignId,
            ...(source ? { sourceContentId: source.id } : {}),
          },
          updatedAt: new Date(),
        })
        .where(eq(schema.aiInsights.id, insight.id));
    }

    const generated = await this.campaigns.generate(
      insight.workspaceId,
      campaignId,
      {
        topic: goal,
        instructions:
          typeof payload.audience === 'string'
            ? payload.audience
            : undefined,
      },
      { replaceExistingContent: true },
    );

    return {
      campaignId: generated.id,
      ...(source ? { sourceContentId: source.id } : {}),
      contentItemIds: generated.contentItems.map((item) => item.id),
      action: repurpose ? 'repurpose_content' : 'create_campaign',
    };
  }

  private async buildEvidence(workspaceId: number) {
    const workspace = await this.db.query.workspaces.findFirst({
      where: eq(schema.workspaces.id, workspaceId),
      columns: { timezone: true },
    });
    const windowEnd = new Date();
    const windowStartDate = calendarDayInZone(
      workspace?.timezone || 'UTC',
      windowEnd,
    );
    windowStartDate.setUTCDate(windowStartDate.getUTCDate() - 29);

    const [dailyRows, accounts, publishedSchedules, upcoming] =
      await Promise.all([
        this.db.query.analyticsDaily.findMany({
          where: and(
            eq(schema.analyticsDaily.workspaceId, workspaceId),
            gte(schema.analyticsDaily.date, windowStartDate),
          ),
          with: { socialAccount: true },
          orderBy: (fields, { asc }) => [asc(fields.date)],
          limit: 1000,
        }),
        this.db.query.socialAccounts.findMany({
          where: eq(schema.socialAccounts.workspaceId, workspaceId),
          columns: {
            id: true,
            provider: true,
            status: true,
          },
        }),
        this.db.query.scheduledPublications.findMany({
          where: and(
            eq(schema.scheduledPublications.workspaceId, workspaceId),
            eq(schema.scheduledPublications.status, 'published'),
            gte(schema.scheduledPublications.scheduledAt, windowStartDate),
          ),
          with: {
            contentItem: true,
            socialAccount: true,
          },
          orderBy: (fields, { desc }) => [desc(fields.scheduledAt)],
          limit: 500,
        }),
        this.db.query.scheduledPublications.findMany({
          where: and(
            eq(schema.scheduledPublications.workspaceId, workspaceId),
            eq(schema.scheduledPublications.status, 'scheduled'),
            gte(schema.scheduledPublications.scheduledAt, windowEnd),
            lte(
              schema.scheduledPublications.scheduledAt,
              new Date(windowEnd.getTime() + 14 * 24 * 60 * 60_000),
            ),
          ),
          with: {
            contentItem: true,
            socialAccount: true,
          },
          orderBy: (fields, { asc }) => [asc(fields.scheduledAt)],
          limit: 50,
        }),
      ]);

    const accountIds = accounts.map((account) => account.id);
    const snapshots = accountIds.length
      ? await this.db.query.metricSnapshots.findMany({
          where: inArray(schema.metricSnapshots.socialAccountId, accountIds),
          with: {
            contentItem: true,
            socialAccount: true,
          },
          orderBy: (fields, { desc }) => [desc(fields.snapshotAt)],
          limit: 2000,
        })
      : [];

    const publishedAt = new Map<string, string>();
    for (const schedule of publishedSchedules) {
      const key = `${schedule.contentItemId}:${schedule.socialAccountId}`;
      if (!publishedAt.has(key)) {
        publishedAt.set(key, schedule.scheduledAt.toISOString());
      }
    }

    const latestPost = new Map<string, (typeof snapshots)[number]>();
    for (const snapshot of snapshots) {
      if (
        !snapshot.contentItem ||
        !snapshot.socialAccount ||
        !snapshot.platformPostId
      ) {
        continue;
      }
      const key = `${snapshot.contentItemId}:${snapshot.socialAccountId}:${snapshot.platformPostId}`;
      if (!latestPost.has(key)) latestPost.set(key, snapshot);
    }

    const contentPerformance: ContentPerformance[] = [...latestPost.values()]
      .map((snapshot) => ({
        content_item_id: snapshot.contentItem!.id,
        title: snapshot.contentItem!.title,
        platform: snapshot.socialAccount!.provider,
        published_at:
          publishedAt.get(
            `${snapshot.contentItemId}:${snapshot.socialAccountId}`,
          ) || null,
        metrics: asNumericMetrics(snapshot.metrics),
      }))
      .sort((a, b) => {
        const scoreDelta =
          interactionScore(b.metrics) - interactionScore(a.metrics);
        if (scoreDelta !== 0) return scoreDelta;
        return (
          (b.metrics.reach || b.metrics.impressions || 0) -
          (a.metrics.reach || a.metrics.impressions || 0)
        );
      })
      .slice(0, 20);

    const upcomingSchedules: UpcomingSchedule[] = upcoming.map((schedule) => ({
      schedule_id: schedule.id,
      content_item_id: schedule.contentItemId,
      title: schedule.contentItem.title,
      platform: schedule.socialAccount.provider,
      scheduled_at: schedule.scheduledAt.toISOString(),
    }));

    const availableChannels = [
      ...new Set(
        accounts
          .filter((account) => {
            if (account.status !== 'active') return false;
            const provider = this.providerRegistry.describeProvider(
              account.provider,
            );
            return Boolean(provider.capabilities?.text);
          })
          .map((account) => account.provider),
      ),
    ];

    const metrics = dailyRows.flatMap((row) =>
      Object.entries(asNumericMetrics(row.metrics)).map(
        ([metricType, value]) => ({
          platform: row.socialAccount?.provider || 'all',
          metric_type: metricType,
          value,
          period: row.date.toISOString().slice(0, 10),
        }),
      ),
    );

    return {
      windowStart: windowStartDate.toISOString(),
      windowEnd: windowEnd.toISOString(),
      metrics,
      contentPerformance,
      upcomingSchedules,
      availableChannels,
    };
  }

  private async requireInsight(workspaceId: number, insightId: number) {
    const insight = await this.db.query.aiInsights.findFirst({
      where: and(
        eq(schema.aiInsights.id, insightId),
        eq(schema.aiInsights.workspaceId, workspaceId),
      ),
    });
    if (!insight) throw new NotFoundException('AI insight not found');
    return insight;
  }
}
