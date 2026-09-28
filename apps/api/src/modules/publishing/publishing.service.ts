import {
  ConflictException,
  Injectable,
  Inject,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { and, eq, lte } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DRIZZLE } from '../../db/db.module.js';
import * as schema from '../../db/schema.js';
import { ProviderRegistry } from '../channels/ProviderRegistry.js';
import { ProviderPublishError } from '../channels/ports/SocialPublisherPort.js';
import { decrypt, encrypt } from '../../utils/encryption.util.js';

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

@Injectable()
export class PublishingService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly providerRegistry: ProviderRegistry,
  ) {}

  private async reconcileStaleClaims() {
    const cutoff = new Date(Date.now() - 15 * 60_000);
    const staleJobs = await this.db.query.publicationJobs.findMany({
      where: and(
        eq(schema.publicationJobs.status, 'processing'),
        lte(schema.publicationJobs.lastAttemptAt, cutoff),
      ),
      with: {
        scheduledPublication: true,
      },
      limit: 50,
    });

    for (const job of staleJobs) {
      const publication = job.scheduledPublication;
      if (!publication || publication.status !== 'publishing') continue;

      await this.db.transaction(async (tx) => {
        await tx
          .update(schema.publicationJobs)
          .set({
            status: 'failed',
            nextAttemptAt: null,
            updatedAt: new Date(),
          })
          .where(eq(schema.publicationJobs.id, job.id));

        await tx.insert(schema.publicationResults).values({
          publicationJobId: job.id,
          errorType: 'unknown_outcome',
          errorMessage:
            'Publishing execution lease expired before SoStats could confirm the provider outcome. Automatic retry was stopped to avoid duplicate publication.',
        });

        await tx
          .update(schema.scheduledPublications)
          .set({ status: 'failed', updatedAt: new Date() })
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

  private async beginAttempt(scheduledPublicationId: number) {
    const existing = await this.db.query.publicationJobs.findFirst({
      where: eq(
        schema.publicationJobs.scheduledPublicationId,
        scheduledPublicationId,
      ),
      orderBy: (fields, { desc }) => [desc(fields.createdAt)],
    });

    if (!existing) {
      const [created] = await this.db
        .insert(schema.publicationJobs)
        .values({
          scheduledPublicationId,
          status: 'processing',
          attempts: 1,
          lastAttemptAt: new Date(),
        })
        .returning();
      return created;
    }

    const [updated] = await this.db
      .update(schema.publicationJobs)
      .set({
        status: 'processing',
        attempts: existing.attempts + 1,
        lastAttemptAt: new Date(),
        nextAttemptAt: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.publicationJobs.id, existing.id))
      .returning();

    return updated;
  }

  private retryAt(attempts: number) {
    const delay = Math.min(15 * 60_000, 30_000 * 2 ** Math.max(0, attempts - 1));
    return new Date(Date.now() + delay);
  }

  private async recordFailure(
    scheduledPublicationId: number,
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
          nextAttemptAt:
            terminal || !job ? null : this.retryAt(job.attempts),
          updatedAt: new Date(),
        })
        .where(eq(schema.publicationJobs.id, jobId));

      await tx
        .update(schema.scheduledPublications)
        .set({ status: terminal ? 'failed' : 'scheduled' })
        .where(eq(schema.scheduledPublications.id, scheduledPublicationId));
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
      return { status: 'in_progress', scheduledPublicationId };
    }

    if (publication.scheduledAt.getTime() > Date.now() + 10_000) {
      throw new ConflictException('Scheduled publication is not due yet');
    }

    const [claimed] = await this.db
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

    if (!claimed) {
      const current = await this.getPublication(scheduledPublicationId);
      if (current.status === 'published') {
        return { status: 'already_published', scheduledPublicationId };
      }
      if (current.updatedAt.toISOString() !== expectedVersion) {
        return { status: 'stale', scheduledPublicationId };
      }
      return { status: 'in_progress', scheduledPublicationId };
    }

    const job = await this.beginAttempt(scheduledPublicationId);

    try {
      const account = publication.socialAccount;
      if (account.status !== 'active' || !account.accessToken) {
        throw new ProviderPublishError(
          'Connected channel is unavailable or has no usable access token',
          { retryable: false },
        );
      }

      const adapter = this.providerRegistry.getProvider(account.provider);
      let accessToken = decrypt(account.accessToken);

      if (account.expiresAt && account.expiresAt.getTime() <= Date.now()) {
        if (!account.refreshToken) {
          await this.db
            .update(schema.socialAccounts)
            .set({ status: 'expired', updatedAt: new Date() })
            .where(eq(schema.socialAccounts.id, account.id));

          throw new ProviderPublishError(
            'Connected channel access token is expired and no refresh token is available',
            { retryable: false },
          );
        }

        try {
          const refreshed = await adapter.refreshAccessToken(
            decrypt(account.refreshToken),
          );
          accessToken = refreshed.accessToken;

          await this.db
            .update(schema.socialAccounts)
            .set({
              accessToken: encrypt(refreshed.accessToken),
              refreshToken: refreshed.refreshToken
                ? encrypt(refreshed.refreshToken)
                : account.refreshToken,
              expiresAt: refreshed.expiresAt,
              status: 'active',
              updatedAt: new Date(),
            })
            .where(eq(schema.socialAccounts.id, account.id));
        } catch (refreshError) {
          if (
            refreshError instanceof ProviderPublishError &&
            !refreshError.retryable
          ) {
            await this.db
              .update(schema.socialAccounts)
              .set({ status: 'expired', updatedAt: new Date() })
              .where(eq(schema.socialAccounts.id, account.id));
          }
          throw refreshError;
        }
      }

      const content =
        publication.variant?.content ||
        publication.contentItem.description ||
        publication.contentItem.title;

      const result = await adapter.publishPost(
        content,
        accessToken,
        { providerAccountId: account.providerAccountId },
      );

      await this.db.transaction(async (tx) => {
        await tx.insert(schema.publicationResults).values({
          publicationJobId: job.id,
          platformPostId: result.postId,
          platformPostUrl: result.url,
        });

        await tx
          .update(schema.publicationJobs)
          .set({
            status: 'completed',
            nextAttemptAt: null,
            updatedAt: new Date(),
          })
          .where(eq(schema.publicationJobs.id, job.id));

        await tx
          .update(schema.scheduledPublications)
          .set({ status: 'published', updatedAt: new Date() })
          .where(
            eq(
              schema.scheduledPublications.id,
              scheduledPublicationId,
            ),
          );

        if (publication.variantId) {
          await tx
            .update(schema.contentVariants)
            .set({
              status: 'published',
              publishedAt: new Date(),
              updatedAt: new Date(),
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
          sibling.id === scheduledPublicationId
            ? true
            : ['published', 'cancelled'].includes(sibling.status),
        );

        if (allTerminallyPublished) {
          await tx
            .update(schema.contentItems)
            .set({ status: 'published', updatedAt: new Date() })
            .where(eq(schema.contentItems.id, publication.contentItemId));
        }
      });

      return {
        status: 'published',
        scheduledPublicationId,
        platformPostId: result.postId,
        platformPostUrl: result.url,
      };
    } catch (error) {
      const providerError =
        error instanceof ProviderPublishError ? error : undefined;
      const terminal =
        !providerError ||
        providerError.outcomeUnknown ||
        !providerError.retryable;

      const failure = await this.recordFailure(
        scheduledPublicationId,
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

    const latestJob = publication.jobs.sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    )[0];

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
            nextAttemptAt: null,
            updatedAt: new Date(),
          })
          .where(eq(schema.publicationJobs.id, latestJob.id));

        if (reason) {
          await tx.insert(schema.publicationResults).values({
            publicationJobId: latestJob.id,
            errorType: 'retry_exhausted',
            errorMessage: reason.slice(0, 1500),
          });
        }
      }
    });

    return { status: 'failed', scheduledPublicationId };
  }
}
