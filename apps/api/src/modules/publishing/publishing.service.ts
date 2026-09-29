import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, isNull, lte, or } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DRIZZLE } from '../../db/db.module.js';
import * as schema from '../../db/schema.js';
import { AuditLogService } from '../../common/audit/audit-log.service.js';
import { ProviderRegistry } from '../channels/ProviderRegistry.js';
import { ChannelCredentialService } from '../channels/channel-credential.service.js';
import {
  ProviderPublishError,
  type PublishResult,
} from '../channels/ports/SocialPublisherPort.js';
import { MediaService } from '../media/media.service.js';
import {
  PublicationLedger,
  type ClaimedAttempt,
  type FailureRecord,
} from './publication-ledger.js';
import {
  decideFailure,
  failureMessage,
  type FailureDecision,
} from './publication-outcome.js';
import {
  PUBLISHING_CONFIG,
  type PublishingConfig,
} from './publishing.config.js';

const sp = schema.scheduledPublications;
const DUE_TOLERANCE_MS = 10_000;

export type DispatchablePublication = {
  id: number;
  scheduledAt: string;
  nextAttemptAt: string | null;
  updatedAt: string;
  dispatchGeneration: number;
};

export type ExecuteRequest = {
  expectedVersion: string;
  expectedDispatchGeneration?: number;
  queueJobId?: string;
};

export type ExecuteResult =
  | {
      status: 'published' | 'already_published';
      scheduledPublicationId: number;
      platformPostId?: string | null;
      platformPostUrl?: string | null;
    }
  | {
      status:
        | 'stale'
        | 'terminal'
        | 'in_progress'
        | 'outcome_unknown'
        | 'retry_scheduled';
      scheduledPublicationId: number;
    }
  | {
      status: 'failed_terminal';
      scheduledPublicationId: number;
      reason: string;
    };

type AttemptOutcome =
  | { kind: 'success'; result: PublishResult; published: boolean }
  | { kind: 'lease_lost' }
  | {
      kind: 'failure';
      decision: Exclude<FailureDecision, { kind: 'lease_lost' }>;
      recorded: FailureRecord;
      message: string;
      statusCode: number | null;
    };

@Injectable()
export class PublishingService {
  private readonly logger = new Logger(PublishingService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly providerRegistry: ProviderRegistry,
    private readonly credentials: ChannelCredentialService,
    private readonly mediaService: MediaService,
    private readonly audit: AuditLogService,
    private readonly ledger: PublicationLedger,
    @Inject(PUBLISHING_CONFIG) private readonly config: PublishingConfig,
  ) {}

  async listDispatchable(
    until?: string,
    offset = 0,
    limit = 250,
  ): Promise<DispatchablePublication[]> {
    const swept = await this.ledger.sweepExpiredLeases();
    for (const decision of swept) {
      this.logEvent('publication.sweep', {
        workspace_id: decision.workspaceId,
        publication_id: decision.publicationId,
        attempt_id: decision.attemptId,
        outcome: decision.outcome,
      });
      if (decision.outcome !== 'retry_scheduled') {
        await this.safeAudit(
          decision.workspaceId,
          decision.publicationId,
          decision.outcome === 'unknown'
            ? 'publication.outcome_unknown'
            : 'publication.failed',
          { attemptId: decision.attemptId, errorType: decision.outcome },
        );
      }
    }

    const horizon = until ? new Date(until) : new Date(Date.now() + 120_000);
    if (Number.isNaN(horizon.getTime())) {
      throw new ConflictException('Invalid dispatch horizon');
    }

    const records = await this.db.query.scheduledPublications.findMany({
      where: and(
        eq(sp.status, 'scheduled'),
        lte(sp.scheduledAt, horizon),
        or(isNull(sp.nextAttemptAt), lte(sp.nextAttemptAt, horizon)),
      ),
      orderBy: (fields, { asc }) => [asc(fields.scheduledAt), asc(fields.id)],
      limit: Math.min(500, Math.max(1, limit)),
      offset: Math.max(0, offset),
    });

    return records.map((record) => ({
      id: record.id,
      scheduledAt: record.scheduledAt.toISOString(),
      nextAttemptAt: record.nextAttemptAt?.toISOString() ?? null,
      updatedAt: record.updatedAt.toISOString(),
      dispatchGeneration: record.dispatchGeneration,
    }));
  }

  async execute(id: number, request: ExecuteRequest): Promise<ExecuteResult> {
    const publication = await this.getPublication(id);
    const gate = this.gate(publication, request);
    if (gate) return gate;

    const dueLimit = Date.now() + DUE_TOLERANCE_MS;
    if (
      publication.scheduledAt.getTime() > dueLimit ||
      (publication.nextAttemptAt &&
        publication.nextAttemptAt.getTime() > dueLimit)
    ) {
      throw new ConflictException('Scheduled publication is not due yet');
    }

    const claim = await this.ledger.claim({
      publicationId: id,
      expectedVersion: request.expectedVersion,
      expectedDispatchGeneration: request.expectedDispatchGeneration,
    });
    if (!claim) {
      return (
        this.gate(await this.getPublication(id), request) ?? {
          status: 'in_progress',
          scheduledPublicationId: id,
        }
      );
    }

    const marker = { set: false };
    let outcome: AttemptOutcome;
    try {
      const account = publication.socialAccount;
      const adapter = this.providerRegistry.getProvider(account.provider);
      const accessToken = await this.credentials.getValidAccessToken(
        account,
        adapter,
      );
      const content =
        publication.variant?.content ||
        publication.contentItem.description ||
        publication.contentItem.title;
      const media = await this.mediaService.getProviderPublishMedia(
        publication.workspaceId,
        publication.contentItemId,
        publication.variantId || undefined,
      );

      const result = await adapter.publishPost(content, accessToken, {
        providerAccountId: account.providerAccountId,
        media,
        signal: AbortSignal.timeout(this.config.providerBudgetMs),
        beforeSideEffect: async (checkpoint) => {
          await this.ledger.markSideEffect(claim, checkpoint);
          marker.set = true;
        },
      });
      outcome = {
        kind: 'success',
        result,
        published: await this.ledger.recordSuccess(claim, result),
      };
    } catch (error) {
      outcome = await this.recordError(claim, error, marker.set);
    }

    return this.finish(
      publication,
      claim,
      outcome,
      request.queueJobId,
      marker.set,
    );
  }

  async deadLetter(id: number) {
    const publication = await this.db.query.scheduledPublications.findFirst({
      where: eq(sp.id, id),
      columns: { id: true, status: true },
    });
    if (!publication) {
      throw new NotFoundException('Scheduled publication not found');
    }
    // Spec I8 / §5.3: transport exhaustion never changes publication state.
    this.logEvent('publication.transport_exhausted', {
      publication_id: id,
      status: publication.status,
      source: 'legacy_dead_letter',
    });
    return { status: publication.status, scheduledPublicationId: id };
  }

  private async getPublication(id: number) {
    const publication = await this.db.query.scheduledPublications.findFirst({
      where: eq(sp.id, id),
      with: {
        contentItem: true,
        variant: true,
        socialAccount: true,
        jobs: { with: { results: true } },
      },
    });
    if (!publication) {
      throw new NotFoundException('Scheduled publication not found');
    }
    return publication;
  }

  private gate(
    publication: Awaited<ReturnType<PublishingService['getPublication']>>,
    request: ExecuteRequest,
  ): ExecuteResult | null {
    const scheduledPublicationId = publication.id;
    switch (publication.status) {
      case 'published': {
        const result = publication.jobs
          .flatMap((job) => job.results)
          .filter((row) => row.platformPostId)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
        return {
          status: 'already_published',
          scheduledPublicationId,
          platformPostId: result?.platformPostId ?? null,
          platformPostUrl: result?.platformPostUrl ?? null,
        };
      }
      case 'failed':
      case 'cancelled':
        return { status: 'terminal', scheduledPublicationId };
      case 'unknown':
      case 'needs_review':
        return { status: 'outcome_unknown', scheduledPublicationId };
      case 'publishing':
        return { status: 'in_progress', scheduledPublicationId };
    }

    const stale =
      request.expectedDispatchGeneration === undefined
        ? publication.updatedAt.toISOString() !== request.expectedVersion
        : publication.dispatchGeneration !== request.expectedDispatchGeneration;
    return stale ? { status: 'stale', scheduledPublicationId } : null;
  }

  private async recordError(
    claim: ClaimedAttempt,
    error: unknown,
    markerSet: boolean,
  ): Promise<AttemptOutcome> {
    const decision = decideFailure(error, markerSet);
    if (decision.kind === 'lease_lost') return { kind: 'lease_lost' };

    const message = failureMessage(error);
    const recorded = await this.ledger.recordFailure(
      claim,
      decision.kind,
      decision.errorClass,
      message,
    );
    return {
      kind: 'failure',
      decision,
      recorded,
      message,
      statusCode:
        error instanceof ProviderPublishError
          ? (error.statusCode ?? null)
          : null,
    };
  }

  private async finish(
    publication: Awaited<ReturnType<PublishingService['getPublication']>>,
    claim: ClaimedAttempt,
    outcome: AttemptOutcome,
    queueJobId: string | undefined,
    markerSet: boolean,
  ): Promise<ExecuteResult> {
    const scheduledPublicationId = publication.id;
    const fields = {
      workspace_id: publication.workspaceId,
      publication_id: scheduledPublicationId,
      attempt_id: claim.attemptId,
      attempt_number: claim.attemptNumber,
      attempt_count: claim.attemptCount,
      dispatch_generation: claim.dispatchGeneration,
      provider: publication.socialAccount.provider,
      social_account_id: publication.socialAccountId,
      queue_job_id: queueJobId ?? null,
      marker_set: markerSet,
    };
    const auditBase = {
      contentItemId: publication.contentItemId,
      variantId: publication.variantId,
      socialAccountId: publication.socialAccountId,
      provider: publication.socialAccount.provider,
      attemptId: claim.attemptId,
    };

    if (outcome.kind === 'success') {
      this.logEvent('publication.attempt', {
        ...fields,
        outcome: outcome.published
          ? 'published'
          : 'ownership_lost_after_success',
        error_class: null,
        status_code: null,
      });
      if (!outcome.published) {
        return { status: 'in_progress', scheduledPublicationId };
      }
      await this.safeAudit(
        publication.workspaceId,
        scheduledPublicationId,
        'publication.published',
        {
          ...auditBase,
          platformPostId: outcome.result.postId,
          platformPostUrl: outcome.result.url,
        },
      );
      return {
        status: 'published',
        scheduledPublicationId,
        platformPostId: outcome.result.postId,
        platformPostUrl: outcome.result.url,
      };
    }

    if (outcome.kind === 'lease_lost') {
      this.logEvent('publication.attempt', {
        ...fields,
        outcome: 'lease_lost',
        error_class: null,
        status_code: null,
      });
      return { status: 'in_progress', scheduledPublicationId };
    }

    this.logEvent('publication.attempt', {
      ...fields,
      outcome: outcome.recorded,
      error_class: outcome.decision.errorClass,
      status_code: outcome.statusCode,
      contract_violation:
        outcome.decision.kind === 'unknown'
          ? outcome.decision.contractViolation
          : false,
    });

    switch (outcome.recorded) {
      case 'retry_scheduled':
        return { status: 'retry_scheduled', scheduledPublicationId };
      case 'unknown':
        await this.safeAudit(
          publication.workspaceId,
          scheduledPublicationId,
          'publication.outcome_unknown',
          { ...auditBase, errorType: outcome.decision.errorClass },
        );
        return { status: 'outcome_unknown', scheduledPublicationId };
      case 'failed':
      case 'retry_exhausted':
        await this.safeAudit(
          publication.workspaceId,
          scheduledPublicationId,
          'publication.failed',
          {
            ...auditBase,
            errorType:
              outcome.recorded === 'retry_exhausted'
                ? 'retry_exhausted'
                : outcome.decision.errorClass,
          },
        );
        return {
          status: 'failed_terminal',
          scheduledPublicationId,
          reason: outcome.message,
        };
      case 'ownership_lost':
        return { status: 'in_progress', scheduledPublicationId };
    }
  }

  /** Audit is post-commit until #33; its failure must never change the committed outcome. */
  private async safeAudit(
    workspaceId: number,
    scheduledPublicationId: number,
    action: string,
    metadata: Record<string, unknown>,
  ) {
    try {
      await this.audit.record({
        workspaceId,
        actor: { userId: null, email: null, authMethod: 'system' },
        action,
        targetType: 'scheduled_publication',
        targetId: scheduledPublicationId,
        metadata,
      });
    } catch {
      this.logEvent('publication.audit_failed', {
        workspace_id: workspaceId,
        publication_id: scheduledPublicationId,
        action,
      });
    }
  }

  private logEvent(event: string, fields: Record<string, unknown>) {
    this.logger.log(JSON.stringify({ event, ...fields }));
  }
}
