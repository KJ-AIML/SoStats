import {
  ConflictException,
  Injectable,
  Inject,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { and, eq, isNull, lte, or } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { randomBytes } from 'crypto';
import { DRIZZLE } from '../../db/db.module.js';
import * as schema from '../../db/schema.js';
import { ProviderRegistry } from '../channels/ProviderRegistry.js';
import { ProviderPublishError } from '../channels/ports/SocialPublisherPort.js';
import { ChannelCredentialService } from '../channels/channel-credential.service.js';
import { MediaService } from '../media/media.service.js';
import { AuditLogService } from '../../common/audit/audit-log.service.js';

type DispatchablePublication = {
  id: number;
  scheduledAt: string;
  updatedAt: string;
};

type ExecuteResult =
  | {
      status: 'published';
      scheduledPublicationId: number;
      platformPostId?: string | null;
      platformPostUrl?: string | null;
    }
  | {
      status: 'already_published' | 'stale' | 'terminal' | 'in_progress';
      scheduledPublicationId: number;
    }
  | {
      status: 'failed_terminal';
      scheduledPublicationId: number;
      reason: string;
    };

function publishingLeaseMs() {
  const parsed = Number.parseInt(
    process.env.PUBLISH_EXECUTION_LEASE_SECONDS || '900',
    10,
  );
  const seconds = Number.isFinite(parsed)
    ? Math.min(Math.max(parsed, 120), 3600)
    : 900;
  return seconds * 1000;
}

@Injectable()
export class PublishingService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly providerRegistry: ProviderRegistry,
    private readonly credentials: ChannelCredentialService,
    private readonly mediaService: MediaService,
    private readonly audit: AuditLogService,
  ) {}

  private async reconcileStaleClaims() {
    const staleJobs = await this.db.query.publicationJobs.findMany({
      where: and(
        eq(schema.publicationJobs.status, 'processing'),
        or(
          isNull(schema.publicationJobs.leaseExpiresAt),
          lte(schema.publicationJobs.leaseExpiresAt, new Date()),
        ),
      ),
      with: {
        scheduledPublication: true,
      },
      limit: 50,
    });

    for (const job of staleJobs) {
      const publication = job.scheduledPublication;
      if (!publication || publication.status !== 'publishing') continue;

      const fullPublication = await this.getPublication(publication.id);
      const fullJob = fullPublication.jobs.find(
        (candidate) => candidate.id === job.id,
      );

      if (job.executionPhase === 'provider_confirmed' && fullJob) {
        const success = fullJob.results.find(
          (result) => Boolean(result.platformPostId),
        );
        if (success?.platformPostId) {
          await this.finalizeProviderConfirmed(
            fullPublication,
            job.id,
            success,
          );
          continue;
        }
      }

      if (
        job.executionPhase === 'provider_request_started' ||
        job.executionPhase === 'provider_confirmed'
      ) {
        await this.recordFailure(
          fullPublication,
          job.id,
          new ProviderPublishError(
            'Publishing execution lease expired after the provider request started but before SoStats could safely confirm the final outcome. Automatic retry was stopped to avoid a duplicate post.',
            { outcomeUnknown: true },
          ),
          true,
        );
        continue;
      }

      await this.db.transaction(async (tx) => {
        await tx
          .update(schema.publicationJobs)
          .set({
            status: 'failed',
            executionPhase: 'idle',
            executionToken: null,
            leaseExpiresAt: null,
            providerRequestStartedAt: null,
            nextAttemptAt: null,
            updatedAt: new Date(),
          })
          .where(eq(schema.publicationJobs.id, job.id));

        await tx
          .update(schema.scheduledPublications)
          .set({
            status: 'scheduled',
            updatedAt: new Date(),
          })
          .where(eq(schema.scheduledPublications.id, publication.id));
      });
    }
  }

  async listDispatchable(
    until?: string,
    offset = 0,
    limit = 250,
  ): Promise<DispatchablePublication[]> {
    await this.reconcileStaleClaims();

    const horizon = until ? new Date(until) : new Date(Date.now() + 120_000);
    if (Number.isNaN(horizon.getTime())) {
      throw new ConflictException('Invalid dispatch horizon');
    }

    const safeOffset = Math.max(0, offset);
    const safeLimit = Math.min(500, Math.max(1, limit));

    const records = await this.db.query.scheduledPublications.findMany({
      where: and(
        eq(schema.scheduledPublications.status, 'scheduled'),
        lte(schema.scheduledPublications.scheduledAt, horizon),
      ),
      orderBy: (fields, { asc }) => [
        asc(fields.scheduledAt),
        asc(fields.id),
      ],
      limit: safeLimit,
      offset: safeOffset,
    });

    return records.map((record) => ({
      id: record.id,
      scheduledAt: record.scheduledAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    }));
  }

  private async getPublication(id: number) {
    const publication = await this.db.query.scheduledPublications.findFirst({
      where: eq(schema.scheduledPublications.id, id),
      with: {
        contentItem: true,
        variant: true,
        socialAccount: true,
        jobs: {
          with: { results: true },
        },
      },
    });

    if (!publication) {
      throw new NotFoundException('Scheduled publication not found');
    }

    return publication;
  }

  private latestResult(
    publication: Awaited<ReturnType<PublishingService['getPublication']>>,
  ) {
    return publication.jobs
      .flatMap((job) => job.results)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  }

  private async claimExecution(
    scheduledPublicationId: number,
    expectedVersion: string,
  ) {
    const token = randomBytes(24).toString('hex');
    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + publishingLeaseMs());

    return this.db.transaction(async (tx) => {
      const [claimedPublication] = await tx
        .update(schema.scheduledPublications)
        .set({ status: 'publishing' })
        .where(
          and(
            eq(schema.scheduledPublications.id, scheduledPublicationId),
            eq(schema.scheduledPublications.status, 'scheduled'),
            eq(
              schema.scheduledPublications.updatedAt,
              new Date(expectedVersion),
            ),
          ),
        )
        .returning();

      if (!claimedPublication) return null;

      const existing = await tx.query.publicationJobs.findFirst({
        where: eq(
          schema.publicationJobs.scheduledPublicationId,
          scheduledPublicationId,
        ),
        orderBy: (fields, { desc }) => [desc(fields.createdAt)],
      });

      if (!existing) {
        const [created] = await tx
          .insert(schema.publicationJobs)
          .values({
            scheduledPublicationId,
            status: 'processing',
            executionPhase: 'claimed',
            executionToken: token,
            leaseExpiresAt,
            providerRequestStartedAt: null,
            attempts: 1,
            lastAttemptAt: now,
          })
          .returning();
        return created;
      }

      const [updated] = await tx
        .update(schema.publicationJobs)
        .set({
          status: 'processing',
          executionPhase: 'claimed',
          executionToken: token,
          leaseExpiresAt,
          providerRequestStartedAt: null,
          attempts: existing.attempts + 1,
          lastAttemptAt: now,
          nextAttemptAt: null,
          updatedAt: now,
        })
        .where(eq(schema.publicationJobs.id, existing.id))
        .returning();

      return updated;
    });
  }

  private async markProviderRequestStarted(
    jobId: number,
    executionToken: string,
  ) {
    const now = new Date();
    const [updated] = await this.db
      .update(schema.publicationJobs)
      .set({
        executionPhase: 'provider_request_started',
        providerRequestStartedAt: now,
        leaseExpiresAt: new Date(now.getTime() + publishingLeaseMs()),
        updatedAt: now,
      })
      .where(
        and(
          eq(schema.publicationJobs.id, jobId),
          eq(schema.publicationJobs.status, 'processing'),
          eq(schema.publicationJobs.executionPhase, 'claimed'),
          eq(schema.publicationJobs.executionToken, executionToken),
        ),
      )
      .returning();

    return Boolean(updated);
  }

  private async checkpointProviderSuccess(
    jobId: number,
    executionToken: string,
    result: { postId: string; url?: string },
  ) {
    return this.db.transaction(async (tx) => {
      await tx
        .insert(schema.publicationResults)
        .values({
          publicationJobId: jobId,
          platformPostId: result.postId,
          platformPostUrl: result.url,
        })
        .onConflictDoNothing();

      const [updated] = await tx
        .update(schema.publicationJobs)
        .set({
          executionPhase: 'provider_confirmed',
          leaseExpiresAt: new Date(Date.now() + publishingLeaseMs()),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.publicationJobs.id, jobId),
            eq(schema.publicationJobs.status, 'processing'),
            eq(
              schema.publicationJobs.executionPhase,
              'provider_request_started',
            ),
            eq(schema.publicationJobs.executionToken, executionToken),
          ),
        )
        .returning();

      if (!updated) {
        throw new ConflictException(
          'Publishing execution lease changed before provider confirmation could be checkpointed',
        );
      }

      const checkpoint = await tx.query.publicationResults.findFirst({
        where: and(
          eq(schema.publicationResults.publicationJobId, jobId),
          eq(schema.publicationResults.platformPostId, result.postId),
        ),
      });
      if (!checkpoint) {
        throw new ConflictException(
          'Provider confirmation checkpoint could not be persisted',
        );
      }

      return checkpoint;
    });
  }

  private async finalizeProviderConfirmed(
    publication: Awaited<ReturnType<PublishingService['getPublication']>>,
    jobId: number,
    result: typeof schema.publicationResults.$inferSelect,
  ) {
    const account = publication.socialAccount;
    const completedAt = new Date();

    await this.db.transaction(async (tx) => {
      await tx
        .update(schema.publicationJobs)
        .set({
          status: 'completed',
          executionPhase: 'terminal',
          executionToken: null,
          leaseExpiresAt: null,
          nextAttemptAt: null,
          updatedAt: completedAt,
        })
        .where(eq(schema.publicationJobs.id, jobId));

      await tx
        .update(schema.scheduledPublications)
        .set({ status: 'published', updatedAt: completedAt })
        .where(eq(schema.scheduledPublications.id, publication.id));

      if (publication.variantId) {
        await tx
          .update(schema.contentVariants)
          .set({
            status: 'published',
            publishedAt: completedAt,
            updatedAt: completedAt,
          })
          .where(eq(schema.contentVariants.id, publication.variantId));
      }

      const siblings = await tx.query.scheduledPublications.findMany({
        where: eq(
          schema.scheduledPublications.contentItemId,
          publication.contentItemId,
        ),
      });

      const allTerminallyPublished = siblings.every((sibling) =>
        sibling.id === publication.id
          ? true
          : ['published', 'cancelled'].includes(sibling.status),
      );

      if (allTerminallyPublished) {
        await tx
          .update(schema.contentItems)
          .set({ status: 'published', updatedAt: completedAt })
          .where(eq(schema.contentItems.id, publication.contentItemId));
      }

      await this.audit.enqueue(
        tx,
        {
          workspaceId: publication.workspaceId,
          actor: {
            userId: null,
            email: null,
            authMethod: 'system',
          },
          action: 'publication.published',
          targetType: 'scheduled_publication',
          targetId: publication.id,
          metadata: {
            contentItemId: publication.contentItemId,
            variantId: publication.variantId,
            socialAccountId: publication.socialAccountId,
            provider: account.provider,
            platformPostId: result.platformPostId,
            platformPostUrl: result.platformPostUrl,
          },
        },
        [
          'audit',
          'publication.published',
          publication.id,
          jobId,
          result.id,
        ].join(':'),
      );
    });
  }

  private retryAt(attempts: number) {
    const delay = Math.min(15 * 60_000, 30_000 * 2 ** Math.max(0, attempts - 1));
    return new Date(Date.now() + delay);
  }

  private async recordFailure(
    publication: Awaited<ReturnType<PublishingService['getPublication']>>,
    jobId: number,
    error: unknown,
    terminal: boolean,
  ) {
    const providerError =
      error instanceof ProviderPublishError ? error : undefined;
    const errorType = providerError
      ? providerError.outcomeUnknown
        ? 'unknown_outcome'
        : providerError.retryable
          ? 'provider_retryable'
          : 'provider_rejected'
      : 'unexpected_error';
    const message =
      error instanceof Error ? error.message.slice(0, 1500) : String(error);

    const job = await this.db.query.publicationJobs.findFirst({
      where: eq(schema.publicationJobs.id, jobId),
    });

    await this.db.transaction(async (tx) => {
      await tx.insert(schema.publicationResults).values({
        publicationJobId: jobId,
        errorType,
        errorMessage: message,
      });

      await tx
        .update(schema.publicationJobs)
        .set({
          status: 'failed',
          executionPhase: terminal ? 'terminal' : 'idle',
          executionToken: null,
          leaseExpiresAt: null,
          nextAttemptAt:
            terminal || !job ? null : this.retryAt(job.attempts),
          updatedAt: new Date(),
        })
        .where(eq(schema.publicationJobs.id, jobId));

      await tx
        .update(schema.scheduledPublications)
        .set({
          status: terminal ? 'failed' : 'scheduled',
          ...(terminal ? { updatedAt: new Date() } : {}),
        })
        .where(eq(schema.scheduledPublications.id, publication.id));

      if (terminal) {
        await this.audit.enqueue(
          tx,
          {
            workspaceId: publication.workspaceId,
            actor: {
              userId: null,
              email: null,
              authMethod: 'system',
            },
            action: 'publication.failed',
            targetType: 'scheduled_publication',
            targetId: publication.id,
            metadata: {
              contentItemId: publication.contentItemId,
              variantId: publication.variantId,
              socialAccountId: publication.socialAccountId,
              provider: publication.socialAccount.provider,
              jobId,
              errorType,
            },
          },
          [
            'audit',
            'publication.failed',
            publication.id,
            jobId,
            errorType,
            job?.attempts || 0,
          ].join(':'),
        );
      }
    });

    return { errorType, message };
  }

  async execute(
    scheduledPublicationId: number,
    expectedVersion: string,
  ): Promise<ExecuteResult> {
    const publication = await this.getPublication(scheduledPublicationId);

    if (publication.updatedAt.toISOString() !== expectedVersion) {
      return { status: 'stale', scheduledPublicationId };
    }

    if (publication.status === 'published') {
      const result = this.latestResult(publication);
      return {
        status: 'already_published',
        scheduledPublicationId,
        ...(result
          ? {
              platformPostId: result.platformPostId,
              platformPostUrl: result.platformPostUrl,
            }
          : {}),
      } as ExecuteResult;
    }

    if (publication.status === 'failed' || publication.status === 'cancelled') {
      return { status: 'terminal', scheduledPublicationId };
    }

    if (publication.status === 'publishing') {
      const activeJob = [...publication.jobs].sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
      )[0];

      if (activeJob?.executionPhase === 'provider_confirmed') {
        const success = activeJob.results.find(
          (result) => Boolean(result.platformPostId),
        );
        if (success?.platformPostId) {
          await this.finalizeProviderConfirmed(
            publication,
            activeJob.id,
            success,
          );
          return {
            status: 'published',
            scheduledPublicationId,
            platformPostId: success.platformPostId,
            platformPostUrl: success.platformPostUrl,
          };
        }
      }

      return { status: 'in_progress', scheduledPublicationId };
    }

    if (publication.scheduledAt.getTime() > Date.now() + 10_000) {
      throw new ConflictException('Scheduled publication is not due yet');
    }

    const job = await this.claimExecution(
      scheduledPublicationId,
      expectedVersion,
    );

    if (!job) {
      const current = await this.getPublication(scheduledPublicationId);
      if (current.status === 'published') {
        return { status: 'already_published', scheduledPublicationId };
      }
      if (current.updatedAt.toISOString() !== expectedVersion) {
        return { status: 'stale', scheduledPublicationId };
      }
      return { status: 'in_progress', scheduledPublicationId };
    }

    const account = publication.socialAccount;
    const adapter = this.providerRegistry.getProvider(account.provider);

    let accessToken: string;
    let content: string;
    let media: Awaited<
      ReturnType<MediaService['getProviderPublishMedia']>
    >;

    try {
      accessToken = await this.credentials.getValidAccessToken(
        account,
        adapter,
      );
      content =
        publication.variant?.content ||
        publication.contentItem.description ||
        publication.contentItem.title;
      media = await this.mediaService.getProviderPublishMedia(
        publication.workspaceId,
        publication.contentItemId,
        publication.variantId || undefined,
      );
    } catch (error) {
      const providerError =
        error instanceof ProviderPublishError ? error : undefined;
      const terminal =
        !providerError ||
        providerError.outcomeUnknown ||
        !providerError.retryable;
      const failure = await this.recordFailure(
        publication,
        job.id,
        error,
        terminal,
      );

      if (terminal) {
        return {
          status: 'failed_terminal',
          scheduledPublicationId,
          reason: failure.message,
        };
      }
      throw new ServiceUnavailableException(failure.message);
    }

    const requestStarted = await this.markProviderRequestStarted(
      job.id,
      job.executionToken!,
    );
    if (!requestStarted) {
      return { status: 'in_progress', scheduledPublicationId };
    }

    let providerResult: { postId: string; url?: string };
    try {
      providerResult = await adapter.publishPost(
        content,
        accessToken,
        {
          providerAccountId: account.providerAccountId,
          media,
        },
      );
    } catch (error) {
      const providerError =
        error instanceof ProviderPublishError ? error : undefined;
      const terminal =
        !providerError ||
        providerError.outcomeUnknown ||
        !providerError.retryable;
      const failure = await this.recordFailure(
        publication,
        job.id,
        error,
        terminal,
      );

      if (terminal) {
        return {
          status: 'failed_terminal',
          scheduledPublicationId,
          reason: failure.message,
        };
      }
      throw new ServiceUnavailableException(failure.message);
    }

    let checkpoint: typeof schema.publicationResults.$inferSelect;
    try {
      checkpoint = await this.checkpointProviderSuccess(
        job.id,
        job.executionToken!,
        providerResult,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'checkpoint persistence failed';
      throw new ServiceUnavailableException(
        `Provider confirmed publication, but SoStats could not persist the provider checkpoint: ${message}. Automatic re-publish is blocked; recovery will not call the provider again without a confirmed checkpoint.`,
      );
    }

    try {
      await this.finalizeProviderConfirmed(publication, job.id, checkpoint);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'finalization failed';
      throw new ServiceUnavailableException(
        `Provider confirmation is safely checkpointed, but publication finalization failed: ${message}`,
      );
    }

    return {
      status: 'published',
      scheduledPublicationId,
      platformPostId: checkpoint.platformPostId,
      platformPostUrl: checkpoint.platformPostUrl,
    };
  }

  async deadLetter(
    scheduledPublicationId: number,
    expectedVersion: string,
    reason?: string,
  ) {
    const publication = await this.getPublication(scheduledPublicationId);

    if (
      publication.status === 'published' ||
      publication.updatedAt.toISOString() !== expectedVersion
    ) {
      return {
        status: publication.status,
        scheduledPublicationId,
      };
    }

    const latestJob = [...publication.jobs].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    )[0];

    if (latestJob?.executionPhase === 'provider_confirmed') {
      const success = latestJob.results.find(
        (result) => Boolean(result.platformPostId),
      );
      if (success?.platformPostId) {
        await this.finalizeProviderConfirmed(
          publication,
          latestJob.id,
          success,
        );
        return {
          status: 'published',
          scheduledPublicationId,
          platformPostId: success.platformPostId,
          platformPostUrl: success.platformPostUrl,
        };
      }
    }

    if (latestJob?.executionPhase === 'provider_request_started') {
      const failure = await this.recordFailure(
        publication,
        latestJob.id,
        new ProviderPublishError(
          'Publishing worker retries exhausted after the provider request started without a durable provider confirmation. Automatic retry was stopped to avoid a duplicate post.',
          { outcomeUnknown: true },
        ),
        true,
      );
      return {
        status: 'failed',
        scheduledPublicationId,
        reason: failure.message,
      };
    }

    const message = (reason || 'Publishing queue retries exhausted').slice(
      0,
      1500,
    );

    await this.db.transaction(async (tx) => {
      await tx
        .update(schema.scheduledPublications)
        .set({ status: 'failed', updatedAt: new Date() })
        .where(eq(schema.scheduledPublications.id, scheduledPublicationId));

      if (latestJob) {
        await tx
          .update(schema.publicationJobs)
          .set({
            status: 'failed',
            executionPhase: 'terminal',
            executionToken: null,
            leaseExpiresAt: null,
            nextAttemptAt: null,
            updatedAt: new Date(),
          })
          .where(eq(schema.publicationJobs.id, latestJob.id));

        await tx.insert(schema.publicationResults).values({
          publicationJobId: latestJob.id,
          errorType: 'retry_exhausted',
          errorMessage: message,
        });
      }

      await this.audit.enqueue(
        tx,
        {
          workspaceId: publication.workspaceId,
          actor: {
            userId: null,
            email: null,
            authMethod: 'system',
          },
          action: 'publication.failed',
          targetType: 'scheduled_publication',
          targetId: scheduledPublicationId,
          metadata: {
            contentItemId: publication.contentItemId,
            variantId: publication.variantId,
            socialAccountId: publication.socialAccountId,
            provider: publication.socialAccount.provider,
            jobId: latestJob?.id,
            errorType: 'retry_exhausted',
            hasReason: Boolean(reason),
          },
        },
        [
          'audit',
          'publication.failed',
          scheduledPublicationId,
          latestJob?.id || 'none',
          'retry_exhausted',
        ].join(':'),
      );
    });

    return {
      status: 'failed',
      scheduledPublicationId,
      reason: message,
    };
  }

}
