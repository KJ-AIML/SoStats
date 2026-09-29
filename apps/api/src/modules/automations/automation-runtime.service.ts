import {
  BadRequestException,
  HttpException,
  Injectable,
  Inject,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DRIZZLE } from '../../db/db.module.js';
import * as schema from '../../db/schema.js';
import { CampaignsService } from '../campaigns/campaigns.service.js';
import { SchedulingService } from '../scheduling/scheduling.service.js';
import { RecommendationsService } from '../analytics/recommendations.service.js';
import { AutomationDecisionDto } from './automations.dto.js';
import {
  nodeConfig,
  orderWorkflow,
  validateWorkflowDefinition,
  workflowNodeKind,
  type WorkflowNode,
} from './workflow-definition.js';

type StepLog = {
  triggerPayload?: Record<string, unknown>;
  checkpoint?: Record<string, unknown>;
  output?: Record<string, unknown>;
  decision?: string;
  notes?: string;
};

type RuntimeResult = {
  status:
    | 'completed'
    | 'waiting_approval'
    | 'failed'
    | 'stale'
    | 'already_terminal';
  runId: number;
  stepId?: string;
  error?: string;
};

function parseStepLog(value?: string | null): StepLog {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as StepLog) : {};
  } catch {
    return {};
  }
}

function numberConfig(
  config: Record<string, unknown>,
  key: string,
  fallback?: number,
) {
  const value = config[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function stringConfig(
  config: Record<string, unknown>,
  key: string,
  fallback?: string,
) {
  const value = config[key];
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function stringArrayConfig(
  config: Record<string, unknown>,
  key: string,
): string[] {
  const value = config[key];
  if (Array.isArray(value)) {
    return value
      .filter((entry): entry is string => typeof entry === 'string')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [];
}

function normalizeProvider(value?: string | null) {
  const normalized = (value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return normalized === 'twitter' ? 'x' : normalized;
}

@Injectable()
export class AutomationRuntimeService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly campaigns: CampaignsService,
    private readonly scheduling: SchedulingService,
    private readonly recommendations: RecommendationsService,
  ) {}

  async listDispatchable(offset = 0, limit = 250) {
    const safeOffset = Math.max(0, offset);
    const safeLimit = Math.min(500, Math.max(1, limit));

    const runs = await this.db.query.automationRuns.findMany({
      where: eq(schema.automationRuns.status, 'pending'),
      with: {
        steps: true,
        version: true,
      },
      orderBy: (fields, { asc }) => [asc(fields.createdAt)],
      offset: safeOffset,
      limit: safeLimit,
    });

    return runs
      .map((run) => {
        const definition = validateWorkflowDefinition(
          run.version.workflowDefinition,
        );
        const order = orderWorkflow(definition);
        const stepMap = new Map(run.steps.map((step) => [step.stepId, step]));
        const next = order.find((node) => {
          const status = stepMap.get(node.id)?.status;
          return status !== 'completed';
        });

        return next
          ? {
              id: run.id,
              resumeToken: next.id,
            }
          : null;
      })
      .filter(
        (
          item,
        ): item is {
          id: number;
          resumeToken: string;
        } => Boolean(item),
      );
  }

  async execute(runId: number, expectedStepId?: string): Promise<RuntimeResult> {
    const run = await this.getRun(runId);

    if (['completed', 'failed'].includes(run.status)) {
      return { status: 'already_terminal', runId };
    }
    if (run.status === 'waiting_approval') {
      const waiting = run.steps.find((step) => step.status === 'waiting_approval');
      return {
        status: 'waiting_approval',
        runId,
        stepId: waiting?.stepId,
      };
    }

    const definition = validateWorkflowDefinition(
      run.version.workflowDefinition,
    );
    const order = orderWorkflow(definition);
    const stepMap = new Map(run.steps.map((step) => [step.stepId, step]));
    const firstPending = order.find(
      (node) => stepMap.get(node.id)?.status !== 'completed',
    );

    if (!firstPending) {
      await this.completeRun(runId);
      return { status: 'completed', runId };
    }

    if (expectedStepId && firstPending.id !== expectedStepId) {
      return { status: 'stale', runId, stepId: firstPending.id };
    }

    if (!run.startedAt) {
      await this.db
        .update(schema.automationRuns)
        .set({ status: 'running', startedAt: new Date(), error: null })
        .where(eq(schema.automationRuns.id, runId));
    } else {
      await this.db
        .update(schema.automationRuns)
        .set({ status: 'running', error: null })
        .where(eq(schema.automationRuns.id, runId));
    }

    for (let index = 0; index < order.length; index += 1) {
      const node = order[index];
      const step = stepMap.get(node.id);
      if (!step || step.status === 'completed') continue;

      if (workflowNodeKind(node) === 'review') {
        await this.pauseForReview(run, node, order, index);
        return { status: 'waiting_approval', runId, stepId: node.id };
      }

      await this.db
        .update(schema.automationRunSteps)
        .set({
          status: 'running',
          startedAt: step.startedAt || new Date(),
          completedAt: null,
          error: null,
        })
        .where(eq(schema.automationRunSteps.id, step.id));

      try {
        const output = await this.executeNode(run, node, order, index, step);

        const completedAt = new Date();
        const completedLogs = JSON.stringify({
          ...parseStepLog(step.logs),
          output,
        });

        await this.db
          .update(schema.automationRunSteps)
          .set({
            status: 'completed',
            completedAt,
            logs: completedLogs,
            error: null,
          })
          .where(eq(schema.automationRunSteps.id, step.id));

        step.status = 'completed';
        step.completedAt = completedAt;
        step.logs = completedLogs;
        step.error = null;
      } catch (error) {
        const message =
          error instanceof Error ? error.message.slice(0, 1500) : String(error);
        const retryable = this.isRetryable(error);

        if (retryable) {
          await this.db.transaction(async (tx) => {
            await tx
              .update(schema.automationRunSteps)
              .set({
                status: 'pending',
                error: message,
              })
              .where(eq(schema.automationRunSteps.id, step.id));
            await tx
              .update(schema.automationRuns)
              .set({ status: 'pending', error: message })
              .where(eq(schema.automationRuns.id, runId));
          });

          throw new ServiceUnavailableException(message);
        }

        await this.db.transaction(async (tx) => {
          await tx
            .update(schema.automationRunSteps)
            .set({
              status: 'failed',
              completedAt: new Date(),
              error: message,
            })
            .where(eq(schema.automationRunSteps.id, step.id));
          await tx
            .update(schema.automationRuns)
            .set({
              status: 'failed',
              completedAt: new Date(),
              error: message,
            })
            .where(eq(schema.automationRuns.id, runId));
        });

        return { status: 'failed', runId, stepId: node.id, error: message };
      }
    }

    await this.completeRun(runId);
    return { status: 'completed', runId };
  }

  async decide(
    workspaceId: number,
    runId: number,
    stepId: string,
    dto: AutomationDecisionDto,
  ) {
    if (!['approve', 'reject'].includes(dto.decision)) {
      throw new BadRequestException('decision must be approve or reject');
    }

    const run = await this.getWorkspaceRun(workspaceId, runId);
    const definition = validateWorkflowDefinition(
      run.version.workflowDefinition,
    );
    const order = orderWorkflow(definition);
    const nodeIndex = order.findIndex((node) => node.id === stepId);
    const node = order[nodeIndex];

    if (!node || workflowNodeKind(node) !== 'review') {
      throw new BadRequestException('Step is not a human review step');
    }

    const step = run.steps.find((candidate) => candidate.stepId === stepId);
    if (!step || step.status !== 'waiting_approval') {
      throw new BadRequestException('Step is not waiting for approval');
    }

    const contentItemIds = this.sourceContentItemIds(run.steps, node, order, nodeIndex);
    const nextStatus = dto.decision === 'approve' ? 'approved' : 'draft';

    await this.db.transaction(async (tx) => {
      if (contentItemIds.length) {
        await tx
          .update(schema.contentItems)
          .set({ status: nextStatus, updatedAt: new Date() })
          .where(
            and(
              eq(schema.contentItems.workspaceId, workspaceId),
              inArray(schema.contentItems.id, contentItemIds),
            ),
          );

        await tx
          .update(schema.approvalRequests)
          .set({
            status: dto.decision === 'approve' ? 'approved' : 'rejected',
            notes: dto.notes,
            updatedAt: new Date(),
          })
          .where(
            and(
              inArray(schema.approvalRequests.contentItemId, contentItemIds),
              eq(schema.approvalRequests.status, 'pending'),
            ),
          );
      }

      await tx
        .update(schema.automationRunSteps)
        .set({
          status: dto.decision === 'approve' ? 'completed' : 'failed',
          completedAt: new Date(),
          logs: JSON.stringify({
            ...parseStepLog(step.logs),
            decision: dto.decision,
            notes: dto.notes,
            output: {
              contentItemIds,
              decision: dto.decision,
            },
          }),
          error:
            dto.decision === 'reject'
              ? dto.notes || 'Human review rejected'
              : null,
        })
        .where(eq(schema.automationRunSteps.id, step.id));

      await tx
        .update(schema.automationRuns)
        .set(
          dto.decision === 'approve'
            ? { status: 'pending', error: null }
            : {
                status: 'failed',
                completedAt: new Date(),
                error: dto.notes || 'Human review rejected',
              },
        )
        .where(eq(schema.automationRuns.id, runId));
    });

    return {
      runId,
      stepId,
      decision: dto.decision,
      contentItemIds,
      status: dto.decision === 'approve' ? 'pending' : 'failed',
    };
  }

  async retry(workspaceId: number, runId: number) {
    const run = await this.getWorkspaceRun(workspaceId, runId);
    if (run.status !== 'failed') {
      throw new BadRequestException('Only failed automation runs can be retried');
    }

    const failed = run.steps.find((step) => step.status === 'failed');
    if (!failed) {
      throw new BadRequestException('No failed step found');
    }

    await this.db.transaction(async (tx) => {
      await tx
        .update(schema.automationRunSteps)
        .set({
          status: 'pending',
          startedAt: null,
          completedAt: null,
          error: null,
        })
        .where(eq(schema.automationRunSteps.id, failed.id));

      await tx
        .update(schema.automationRuns)
        .set({
          status: 'pending',
          completedAt: null,
          error: null,
        })
        .where(eq(schema.automationRuns.id, runId));
    });

    return { runId, stepId: failed.stepId, status: 'pending' };
  }

  async deadLetter(runId: number, reason?: string) {
    const run = await this.getRun(runId);
    if (['completed', 'failed', 'waiting_approval'].includes(run.status)) {
      return { runId, status: run.status };
    }

    const definition = validateWorkflowDefinition(
      run.version.workflowDefinition,
    );
    const order = orderWorkflow(definition);
    const current = order.find((node) => {
      const step = run.steps.find((candidate) => candidate.stepId === node.id);
      return step && step.status !== 'completed';
    });
    const step = current
      ? run.steps.find((candidate) => candidate.stepId === current.id)
      : undefined;
    const message = (reason || 'Automation queue retries exhausted').slice(0, 1500);

    await this.db.transaction(async (tx) => {
      if (step) {
        await tx
          .update(schema.automationRunSteps)
          .set({
            status: 'failed',
            completedAt: new Date(),
            error: message,
          })
          .where(eq(schema.automationRunSteps.id, step.id));
      }

      await tx
        .update(schema.automationRuns)
        .set({
          status: 'failed',
          completedAt: new Date(),
          error: message,
        })
        .where(eq(schema.automationRuns.id, runId));
    });

    return { runId, status: 'failed', stepId: step?.stepId };
  }

  private async executeNode(
    run: Awaited<ReturnType<AutomationRuntimeService['getRun']>>,
    node: WorkflowNode,
    order: WorkflowNode[],
    index: number,
    step: typeof schema.automationRunSteps.$inferSelect,
  ): Promise<Record<string, unknown>> {
    const kind = workflowNodeKind(node);

    if (kind === 'trigger') {
      return {
        triggerPayload: parseStepLog(step.logs).triggerPayload || {},
      };
    }

    if (kind === 'generate') {
      return this.executeGenerate(run, node, step);
    }

    if (kind === 'schedule') {
      return this.executeSchedule(run, node, order, index, step);
    }

    if (kind === 'analyze') {
      const config = nodeConfig(node);
      const brandId = numberConfig(config, 'brandId');
      const result = await this.recommendations.generate(
        run.automation.workspaceId,
        brandId,
        { supersedePending: false },
      );
      return {
        summary: result.summary,
        insights: result.insights,
      };
    }

    throw new BadRequestException(`Node type "${kind}" is not executable`);
  }

  private async executeGenerate(
    run: Awaited<ReturnType<AutomationRuntimeService['getRun']>>,
    node: WorkflowNode,
    step: typeof schema.automationRunSteps.$inferSelect,
  ) {
    const config = nodeConfig(node);
    const log = parseStepLog(step.logs);
    const triggerContext = this.triggerContext(run.steps);
    let campaignId =
      numberConfig(config, 'campaignId') ||
      (typeof log.checkpoint?.campaignId === 'number'
        ? log.checkpoint.campaignId
        : undefined);

    if (!campaignId) {
      const goal =
        stringConfig(config, 'goal') ||
        stringConfig(config, 'topic') ||
        node.data.label ||
        'Automation campaign';
      const channels = stringArrayConfig(config, 'channels');
      const created = await this.campaigns.create(run.automation.workspaceId, {
        brandId: numberConfig(config, 'brandId'),
        name:
          stringConfig(config, 'name') ||
          (triggerContext.title
            ? `${goal}: ${triggerContext.title}`.slice(0, 255)
            : goal),
        description:
          stringConfig(config, 'description') ||
          triggerContext.context ||
          undefined,
        goal,
        channels,
      });
      campaignId = created.id;

      await this.db
        .update(schema.automationRunSteps)
        .set({
          logs: JSON.stringify({
            ...log,
            checkpoint: { campaignId },
          }),
        })
        .where(eq(schema.automationRunSteps.id, step.id));
    }

    const generated = await this.campaigns.generate(
      run.automation.workspaceId,
      campaignId,
      {
        topic: stringConfig(config, 'goal') || stringConfig(config, 'topic'),
        instructions: stringConfig(config, 'audience'),
      },
      { replaceExistingContent: true },
    );

    return {
      campaignId: generated.id,
      contentItemIds: generated.contentItems.map((item) => item.id),
      contentItems: generated.contentItems.map((item) => ({
        id: item.id,
        title: item.title,
        variantIds: item.variants.map((variant) => variant.id),
      })),
    };
  }

  private triggerContext(
    steps: Array<typeof schema.automationRunSteps.$inferSelect>,
  ) {
    for (const step of steps) {
      const payload = parseStepLog(step.logs).triggerPayload;
      if (!payload || typeof payload !== 'object') continue;

      const source =
        typeof payload.source === 'string' ? payload.source : 'external';
      const item =
        payload.item && typeof payload.item === 'object'
          ? (payload.item as Record<string, unknown>)
          : {};
      const feed =
        payload.feed && typeof payload.feed === 'object'
          ? (payload.feed as Record<string, unknown>)
          : {};
      const event =
        payload.event && typeof payload.event === 'object'
          ? (payload.event as Record<string, unknown>)
          : {};

      const title =
        typeof item.title === 'string' ? item.title.trim() : undefined;
      const summary =
        typeof item.summary === 'string' ? item.summary.trim() : undefined;
      const link =
        typeof item.link === 'string' ? item.link.trim() : undefined;
      const publishedAt =
        typeof item.publishedAt === 'string'
          ? item.publishedAt.trim()
          : undefined;
      const feedTitle =
        typeof feed.title === 'string' ? feed.title.trim() : undefined;
      const eventName =
        typeof event.name === 'string' ? event.name.trim() : undefined;
      const postType =
        typeof item.postType === 'string' ? item.postType.trim() : undefined;
      const status =
        typeof item.status === 'string' ? item.status.trim() : undefined;

      const lines = [
        `External trigger source: ${source}`,
        eventName ? `Event: ${eventName}` : undefined,
        feedTitle ? `Feed: ${feedTitle}` : undefined,
        postType ? `Content type: ${postType}` : undefined,
        status ? `Source status: ${status}` : undefined,
        title ? `Source title: ${title}` : undefined,
        publishedAt ? `Published at: ${publishedAt}` : undefined,
        link ? `Source URL: ${link}` : undefined,
        summary ? `Source summary: ${summary}` : undefined,
      ].filter((value): value is string => Boolean(value));

      return {
        title,
        context: lines.join('\n').slice(0, 14_000),
      };
    }

    return { title: undefined, context: undefined };
  }

  private async executeSchedule(
    run: Awaited<ReturnType<AutomationRuntimeService['getRun']>>,
    node: WorkflowNode,
    order: WorkflowNode[],
    index: number,
    step: typeof schema.automationRunSteps.$inferSelect,
  ) {
    const config = nodeConfig(node);
    const socialAccountId = numberConfig(config, 'socialAccountId');
    if (!socialAccountId) {
      throw new BadRequestException(
        'Schedule node requires config.socialAccountId',
      );
    }

    const contentItemIds = this.sourceContentItemIds(
      run.steps,
      node,
      order,
      index,
    );
    if (!contentItemIds.length) {
      throw new BadRequestException(
        'Schedule node could not resolve content from a previous step',
      );
    }

    const account = await this.db.query.socialAccounts.findFirst({
      where: and(
        eq(schema.socialAccounts.id, socialAccountId),
        eq(
          schema.socialAccounts.workspaceId,
          run.automation.workspaceId,
        ),
      ),
    });
    if (!account) {
      throw new BadRequestException('Configured social account was not found');
    }

    const log = parseStepLog(step.logs);
    const startAtRaw =
      stringConfig(config, 'startAt') ||
      (typeof log.checkpoint?.startAt === 'string'
        ? log.checkpoint.startAt
        : undefined);
    const delayMinutes = numberConfig(config, 'delayMinutes', 60) || 60;
    const spacingMinutes = numberConfig(config, 'spacingMinutes', 60) || 60;
    const startAt = startAtRaw
      ? new Date(startAtRaw)
      : new Date(Date.now() + delayMinutes * 60_000);

    if (Number.isNaN(startAt.getTime())) {
      throw new BadRequestException('Schedule node startAt is invalid');
    }

    if (!startAtRaw) {
      const checkpointLogs = JSON.stringify({
        ...log,
        checkpoint: {
          ...(log.checkpoint || {}),
          startAt: startAt.toISOString(),
        },
      });
      await this.db
        .update(schema.automationRunSteps)
        .set({ logs: checkpointLogs })
        .where(eq(schema.automationRunSteps.id, step.id));
      step.logs = checkpointLogs;
    }

    const scheduleIds: number[] = [];
    for (let itemIndex = 0; itemIndex < contentItemIds.length; itemIndex += 1) {
      const contentItemId = contentItemIds[itemIndex];
      const scheduledAt = new Date(
        startAt.getTime() + itemIndex * spacingMinutes * 60_000,
      );

      const existing = await this.db.query.scheduledPublications.findFirst({
        where: and(
          eq(schema.scheduledPublications.workspaceId, run.automation.workspaceId),
          eq(schema.scheduledPublications.contentItemId, contentItemId),
          eq(schema.scheduledPublications.socialAccountId, socialAccountId),
          eq(schema.scheduledPublications.scheduledAt, scheduledAt),
        ),
      });

      if (existing) {
        scheduleIds.push(existing.id);
        continue;
      }

      const variants = await this.db.query.contentVariants.findMany({
        where: eq(schema.contentVariants.contentItemId, contentItemId),
      });
      const variant = variants.find(
        (candidate) =>
          normalizeProvider(candidate.platform) ===
          normalizeProvider(account.provider),
      );

      const created = await this.scheduling.createSchedule(
        run.automation.workspaceId,
        {
          contentItemId,
          variantId: variant?.id,
          socialAccountId,
          scheduledAt: scheduledAt.toISOString(),
        },
      );
      scheduleIds.push(created.id);
    }

    return {
      contentItemIds,
      scheduleIds,
      socialAccountId,
      firstScheduledAt: startAt.toISOString(),
      spacingMinutes,
    };
  }

  private async pauseForReview(
    run: Awaited<ReturnType<AutomationRuntimeService['getRun']>>,
    node: WorkflowNode,
    order: WorkflowNode[],
    index: number,
  ) {
    const step = run.steps.find((candidate) => candidate.stepId === node.id);
    if (!step) throw new NotFoundException('Automation review step not found');

    const contentItemIds = this.sourceContentItemIds(
      run.steps,
      node,
      order,
      index,
    );

    await this.db.transaction(async (tx) => {
      if (contentItemIds.length) {
        await tx
          .update(schema.contentItems)
          .set({ status: 'in_review', updatedAt: new Date() })
          .where(
            and(
              eq(schema.contentItems.workspaceId, run.automation.workspaceId),
              inArray(schema.contentItems.id, contentItemIds),
            ),
          );

        await tx.insert(schema.approvalRequests).values(
          contentItemIds.map((contentItemId) => ({
            contentItemId,
            status: 'pending',
          })),
        );
      }

      await tx
        .update(schema.automationRunSteps)
        .set({
          status: 'waiting_approval',
          startedAt: step.startedAt || new Date(),
          logs: JSON.stringify({
            ...parseStepLog(step.logs),
            output: { contentItemIds },
          }),
          error: null,
        })
        .where(eq(schema.automationRunSteps.id, step.id));

      await tx
        .update(schema.automationRuns)
        .set({ status: 'waiting_approval', error: null })
        .where(eq(schema.automationRuns.id, run.id));
    });
  }

  private sourceContentItemIds(
    steps: Array<typeof schema.automationRunSteps.$inferSelect>,
    node: WorkflowNode,
    order: WorkflowNode[],
    index: number,
  ) {
    const config = nodeConfig(node);
    const sourceStepId =
      stringConfig(config, 'sourceStepId') || order[index - 1]?.id;
    if (!sourceStepId) return [];

    const source = steps.find((step) => step.stepId === sourceStepId);
    const output = parseStepLog(source?.logs).output;
    const raw = output?.contentItemIds;

    return Array.isArray(raw)
      ? raw.filter((value): value is number => typeof value === 'number')
      : [];
  }

  private isRetryable(error: unknown) {
    if (error instanceof BadRequestException || error instanceof NotFoundException) {
      return false;
    }
    if (error instanceof HttpException) {
      return error.getStatus() >= 500;
    }
    return true;
  }

  private async completeRun(runId: number) {
    await this.db
      .update(schema.automationRuns)
      .set({
        status: 'completed',
        completedAt: new Date(),
        error: null,
      })
      .where(eq(schema.automationRuns.id, runId));
  }

  private async getRun(runId: number) {
    const run = await this.db.query.automationRuns.findFirst({
      where: eq(schema.automationRuns.id, runId),
      with: {
        automation: true,
        version: true,
        steps: true,
      },
    });
    if (!run) throw new NotFoundException('Automation run not found');
    return run;
  }

  private async getWorkspaceRun(workspaceId: number, runId: number) {
    const run = await this.getRun(runId);
    if (run.automation.workspaceId !== workspaceId) {
      throw new NotFoundException('Automation run not found');
    }
    return run;
  }
}
