import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Inject,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  and,
  eq,
  gte,
  inArray,
  isNotNull,
  sql,
} from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DRIZZLE } from '../../db/db.module.js';
import * as schema from '../../db/schema.js';
import { BrandContextService } from '../brands/brand-context.service.js';
import { ProviderRegistry } from '../channels/ProviderRegistry.js';
import { ChannelCredentialService } from '../channels/channel-credential.service.js';
import { ProviderAnalyticsError } from '../channels/ports/SocialAnalyticsPort.js';
import { ProviderPublishError } from '../channels/ports/SocialPublisherPort.js';

export interface AiInsightResponse {
  insights: Array<{
    finding: string;
    recommendation: string;
    impact_estimate: string;
  }>;
  summary: string;
}

type NumericMetrics = Record<string, number>;

type DispatchableAnalytics = {
  publicationResultId: number;
  contentItemId: number;
  socialAccountId: number;
  provider: string;
  platformPostId: string;
  expectedSnapshotAt: string | null;
  revision: string;
  dueAt: string;
};

type IngestResult =
  | {
      status: 'ingested';
      publicationResultId: number;
      snapshotId: number;
      metrics: NumericMetrics;
      delta: NumericMetrics;
    }
  | {
      status: 'stale' | 'not_due' | 'not_supported';
      publicationResultId: number;
    }
  | {
      status: 'failed_terminal';
      publicationResultId: number;
      reason: string;
      permissionDenied?: boolean;
    };

function utcDay(date = new Date()) {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

export function asNumericMetrics(value: unknown): NumericMetrics {
  if (!value || typeof value !== 'object') return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, number] =>
        typeof entry[1] === 'number' && Number.isFinite(entry[1]),
    ),
  );
}

export function subtractMetrics(current: NumericMetrics, previous: NumericMetrics) {
  return Object.fromEntries(
    Object.entries(current).map(([key, value]) => [
      key,
      value - (previous[key] || 0),
    ]),
  );
}

export function addMetrics(current: NumericMetrics, delta: NumericMetrics) {
  const result = { ...current };
  for (const [key, value] of Object.entries(delta)) {
    result[key] = (result[key] || 0) + value;
  }
  return result;
}

export function analyticsIntervalMs(postAgeMs: number) {
  const hour = 60 * 60_000;
  const day = 24 * hour;

  if (postAgeMs < 24 * hour) return hour;
  if (postAgeMs < 7 * day) return 6 * hour;
  if (postAgeMs < 30 * day) return day;
  return null;
}

@Injectable()
export class AnalyticsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly brandContext: BrandContextService,
    private readonly providerRegistry: ProviderRegistry,
    private readonly credentials: ChannelCredentialService,
  ) {}

  async getOverview(workspaceId: number) {
    const start = utcDay();
    start.setUTCDate(start.getUTCDate() - 29);

    const rows = await this.db.query.analyticsDaily.findMany({
      where: and(
        eq(schema.analyticsDaily.workspaceId, workspaceId),
        gte(schema.analyticsDaily.date, start),
      ),
      orderBy: (fields, { asc }) => [asc(fields.date)],
    });

    const grouped = new Map<
      string,
      { id: number; date: string; metrics: NumericMetrics }
    >();

    for (const row of rows) {
      const key = row.date.toISOString().slice(0, 10);
      const previous = grouped.get(key);
      grouped.set(key, {
        id: previous?.id || row.id,
        date: row.date.toISOString(),
        metrics: addMetrics(
          previous?.metrics || {},
          asNumericMetrics(row.metrics),
        ),
      });
    }

    const daily = [...grouped.values()].sort((a, b) =>
      a.date.localeCompare(b.date),
    );
    const totals = daily.reduce<NumericMetrics>(
      (acc, row) => addMetrics(acc, row.metrics),
      {},
    );

    const accounts = await this.db.query.socialAccounts.findMany({
      where: eq(schema.socialAccounts.workspaceId, workspaceId),
      columns: { id: true },
    });
    const accountIds = accounts.map((account) => account.id);

    let latestSnapshotAt: string | null = null;
    let trackedPosts = 0;

    if (accountIds.length) {
      const snapshots = await this.db.query.metricSnapshots.findMany({
        where: inArray(schema.metricSnapshots.socialAccountId, accountIds),
        columns: {
          platformPostId: true,
          snapshotAt: true,
        },
        orderBy: (fields, { desc: orderDesc }) => [
          orderDesc(fields.snapshotAt),
        ],
        limit: 1000,
      });

      latestSnapshotAt = snapshots[0]?.snapshotAt.toISOString() || null;
      trackedPosts = new Set(
        snapshots
          .map((snapshot) => snapshot.platformPostId)
          .filter((value): value is string => Boolean(value)),
      ).size;
    }

    return {
      workspaceId,
      totals,
      daily,
      hasData: rows.length > 0,
      latestSnapshotAt,
      trackedPosts,
      syncWindowDays: 30,
    };
  }

  async listDispatchable(limit = 250): Promise<DispatchableAnalytics[]> {
    const safeLimit = Math.min(500, Math.max(1, limit));
    const now = Date.now();
    const maxAge = 30 * 24 * 60 * 60_000;
    const initialDelay = 15 * 60_000;

    const results = await this.db.query.publicationResults.findMany({
      where: isNotNull(schema.publicationResults.platformPostId),
      with: {
        job: {
          with: {
            scheduledPublication: {
              with: {
                socialAccount: true,
              },
            },
          },
        },
      },
      orderBy: (fields, { desc: orderDesc }) => [
        orderDesc(fields.createdAt),
      ],
      limit: 1000,
    });

    const candidates = results.filter((result) => {
      const publication = result.job.scheduledPublication;
      if (
        publication.status !== 'published' ||
        !result.platformPostId ||
        now - result.createdAt.getTime() > maxAge
      ) {
        return false;
      }

      const description = this.providerRegistry.describeProvider(
        publication.socialAccount.provider,
      );
      return Boolean(description.capabilities?.analytics);
    });

    const postIds = [
      ...new Set(
        candidates
          .map((result) => result.platformPostId)
          .filter((value): value is string => Boolean(value)),
      ),
    ];

    const snapshots = postIds.length
      ? await this.db.query.metricSnapshots.findMany({
          where: inArray(schema.metricSnapshots.platformPostId, postIds),
          orderBy: (fields, { desc: orderDesc }) => [
            orderDesc(fields.snapshotAt),
          ],
        })
      : [];

    const latestByKey = new Map<
      string,
      typeof schema.metricSnapshots.$inferSelect
    >();
    for (const snapshot of snapshots) {
      if (!snapshot.platformPostId || !snapshot.socialAccountId) continue;
      const key = `${snapshot.contentItemId}:${snapshot.socialAccountId}:${snapshot.platformPostId}`;
      if (!latestByKey.has(key)) latestByKey.set(key, snapshot);
    }

    const dispatchable: DispatchableAnalytics[] = [];

    for (const result of candidates) {
      const publication = result.job.scheduledPublication;
      const account = publication.socialAccount;
      const postId = result.platformPostId;
      if (!postId) continue;

      const key = `${publication.contentItemId}:${account.id}:${postId}`;
      const latest = latestByKey.get(key);
      const postAge = now - result.createdAt.getTime();
      const interval = analyticsIntervalMs(postAge);
      if (interval === null) continue;

      const dueAt = latest
        ? latest.snapshotAt.getTime() + interval
        : result.createdAt.getTime() + initialDelay;

      if (dueAt > now) continue;

      dispatchable.push({
        publicationResultId: result.id,
        contentItemId: publication.contentItemId,
        socialAccountId: account.id,
        provider: account.provider,
        platformPostId: postId,
        expectedSnapshotAt: latest?.snapshotAt.toISOString() || null,
        revision: latest
          ? String(latest.snapshotAt.getTime())
          : 'initial',
        dueAt: new Date(dueAt).toISOString(),
      });

      if (dispatchable.length >= safeLimit) break;
    }

    return dispatchable;
  }

  async ingestPublication(
    publicationResultId: number,
    expectedSnapshotAt?: string | null,
  ): Promise<IngestResult> {
    const result = await this.db.query.publicationResults.findFirst({
      where: eq(schema.publicationResults.id, publicationResultId),
      with: {
        job: {
          with: {
            scheduledPublication: {
              with: {
                socialAccount: true,
              },
            },
          },
        },
      },
    });

    if (!result?.platformPostId) {
      throw new NotFoundException('Published provider result not found');
    }

    const publication = result.job.scheduledPublication;
    const account = publication.socialAccount;

    if (publication.status !== 'published') {
      return { status: 'not_due', publicationResultId };
    }

    const description = this.providerRegistry.describeProvider(account.provider);
    if (!description.capabilities?.analytics) {
      return { status: 'not_supported', publicationResultId };
    }

    const latest = await this.db.query.metricSnapshots.findFirst({
      where: and(
        eq(schema.metricSnapshots.contentItemId, publication.contentItemId),
        eq(schema.metricSnapshots.socialAccountId, account.id),
        eq(schema.metricSnapshots.platformPostId, result.platformPostId),
      ),
      orderBy: (fields, { desc: orderDesc }) => [
        orderDesc(fields.snapshotAt),
      ],
    });

    const latestVersion = latest?.snapshotAt.toISOString() || null;
    if ((expectedSnapshotAt || null) !== latestVersion) {
      return { status: 'stale', publicationResultId };
    }

    const postAge = Date.now() - result.createdAt.getTime();
    const interval = analyticsIntervalMs(postAge);
    if (interval === null) {
      return { status: 'not_due', publicationResultId };
    }

    const dueAt = latest
      ? latest.snapshotAt.getTime() + interval
      : result.createdAt.getTime() + 15 * 60_000;
    if (dueAt > Date.now() + 5_000) {
      return { status: 'not_due', publicationResultId };
    }

    try {
      const publisher = this.providerRegistry.getProvider(account.provider);
      const analytics = this.providerRegistry.getAnalyticsProvider(
        account.provider,
      );
      const accessToken = await this.credentials.getValidAccessToken(
        account,
        publisher,
      );
      const current = asNumericMetrics(
        await analytics.fetchPostMetrics(result.platformPostId, accessToken),
      );
      const day = utcDay();

      let insertedSnapshotId = 0;
      let delta: NumericMetrics = {};
      let staleAfterLock = false;

      await this.db.transaction(async (tx) => {
        await tx.execute(
          sql`select pg_advisory_xact_lock(${publication.workspaceId}, ${account.id})`,
        );

        const lockedLatest = await tx.query.metricSnapshots.findFirst({
          where: and(
            eq(schema.metricSnapshots.contentItemId, publication.contentItemId),
            eq(schema.metricSnapshots.socialAccountId, account.id),
            eq(schema.metricSnapshots.platformPostId, result.platformPostId),
          ),
          orderBy: (fields, { desc: orderDesc }) => [
            orderDesc(fields.snapshotAt),
          ],
        });

        const lockedVersion =
          lockedLatest?.snapshotAt.toISOString() || null;
        if ((expectedSnapshotAt || null) !== lockedVersion) {
          staleAfterLock = true;
          return;
        }

        delta = subtractMetrics(
          current,
          asNumericMetrics(lockedLatest?.metrics),
        );

        const [snapshot] = await tx
          .insert(schema.metricSnapshots)
          .values({
            contentItemId: publication.contentItemId,
            socialAccountId: account.id,
            platformPostId: result.platformPostId,
            metrics: current,
            snapshotAt: new Date(),
          })
          .returning();
        insertedSnapshotId = snapshot.id;

        const daily = await tx.query.analyticsDaily.findFirst({
          where: and(
            eq(schema.analyticsDaily.workspaceId, publication.workspaceId),
            eq(schema.analyticsDaily.socialAccountId, account.id),
            eq(schema.analyticsDaily.date, day),
          ),
        });

        if (daily) {
          await tx
            .update(schema.analyticsDaily)
            .set({
              metrics: addMetrics(asNumericMetrics(daily.metrics), delta),
              updatedAt: new Date(),
            })
            .where(eq(schema.analyticsDaily.id, daily.id));
        } else {
          await tx.insert(schema.analyticsDaily).values({
            workspaceId: publication.workspaceId,
            socialAccountId: account.id,
            date: day,
            metrics: delta,
          });
        }
      });

      if (staleAfterLock) {
        return { status: 'stale', publicationResultId };
      }

      return {
        status: 'ingested',
        publicationResultId,
        snapshotId: insertedSnapshotId,
        metrics: current,
        delta,
      };
    } catch (error) {
      const retryable =
        (error instanceof ProviderAnalyticsError && error.retryable) ||
        (error instanceof ProviderPublishError && error.retryable);

      if (retryable) {
        throw new ServiceUnavailableException(
          error instanceof Error ? error.message : 'Analytics provider unavailable',
        );
      }

      if (
        error instanceof ProviderAnalyticsError ||
        error instanceof ProviderPublishError
      ) {
        return {
          status: 'failed_terminal',
          publicationResultId,
          reason: error.message,
          ...(error instanceof ProviderAnalyticsError
            ? { permissionDenied: error.permissionDenied }
            : {}),
        };
      }

      throw error;
    }
  }

  async generateInsights(workspaceId: number, brandId?: number) {
    const rows = await this.db.query.analyticsDaily.findMany({
      where: eq(schema.analyticsDaily.workspaceId, workspaceId),
      with: { socialAccount: true },
      orderBy: (fields, { desc: orderDesc }) => [orderDesc(fields.date)],
      limit: 90,
    });

    const metrics = rows.flatMap((row) => {
      const values = asNumericMetrics(row.metrics);
      return Object.entries(values).map(([metricType, value]) => ({
        platform: row.socialAccount?.provider || 'all',
        metric_type: metricType,
        value,
        period: row.date.toISOString().slice(0, 10),
      }));
    });

    if (!metrics.length) {
      throw new BadRequestException(
        'Analytics data is required before generating AI insights',
      );
    }

    const brand = await this.brandContext.get(workspaceId, brandId);
    const baseUrl = process.env.AI_SERVICE_URL || 'http://localhost:8000';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);

    try {
      const response = await fetch(baseUrl + '/v1/insights/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          metrics,
          brand_context: this.brandContext.serialize(brand),
        }),
      });

      if (!response.ok) {
        throw new BadGatewayException(
          `AI service returned HTTP ${response.status}`,
        );
      }

      return (await response.json()) as AiInsightResponse;
    } catch (error) {
      if (error instanceof BadGatewayException) throw error;
      throw new BadGatewayException('AI insight service unavailable');
    } finally {
      clearTimeout(timer);
    }
  }

  async getContentAnalytics(workspaceId: number, contentId: number) {
    const content = await this.db.query.contentItems.findFirst({
      where: and(
        eq(schema.contentItems.id, contentId),
        eq(schema.contentItems.workspaceId, workspaceId),
      ),
    });

    if (!content) throw new NotFoundException('Content item not found');

    const snapshots = await this.db.query.metricSnapshots.findMany({
      where: eq(schema.metricSnapshots.contentItemId, contentId),
      orderBy: (fields, { desc: orderDesc }) => [
        orderDesc(fields.snapshotAt),
      ],
    });

    return {
      contentId,
      latest: snapshots[0]?.metrics ?? null,
      snapshots,
      hasData: snapshots.length > 0,
    };
  }
}
