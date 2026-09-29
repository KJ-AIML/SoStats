import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DRIZZLE } from '../../db/db.module.js';
import * as schema from '../../db/schema.js';
import type {
  ProviderCheckpoint,
  ProviderErrorClass,
  PublishResult,
} from '../channels/ports/SocialPublisherPort.js';
import { LeaseLostError } from './publication-outcome.js';
import { rearmSet } from './publication-state.js';
import {
  PUBLISHING_CONFIG,
  retryDelayMs,
  type PublishingConfig,
} from './publishing.config.js';

const sp = schema.scheduledPublications;
const pj = schema.publicationJobs;
const pr = schema.publicationResults;

export type ClaimRequest = {
  publicationId: number;
  expectedVersion: string;
  expectedDispatchGeneration?: number;
};

export type ClaimedAttempt = {
  publicationId: number;
  attemptId: number;
  attemptNumber: number;
  attemptCount: number;
  dispatchGeneration: number;
};

export type FailureRecord =
  | 'retry_scheduled'
  | 'retry_exhausted'
  | 'failed'
  | 'unknown'
  | 'ownership_lost';

export type SweepDecision = {
  publicationId: number;
  workspaceId: number;
  attemptId: number | null;
  outcome: 'unknown' | 'retry_scheduled' | 'retry_exhausted';
};

/** Every publication state write for execution lives here (spec §5, I1/I4). */
@Injectable()
export class PublicationLedger {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    @Inject(PUBLISHING_CONFIG) private readonly config: PublishingConfig,
  ) {}

  claim(request: ClaimRequest): Promise<ClaimedAttempt | null> {
    return this.db.transaction(async (tx) => {
      const now = new Date();
      const [claimed] = await tx
        .update(sp)
        .set({
          status: 'publishing',
          attemptCount: sql`${sp.attemptCount} + 1`,
          leaseExpiresAt: new Date(now.getTime() + this.config.leaseMs),
          nextAttemptAt: null,
        })
        .where(
          and(
            eq(sp.id, request.publicationId),
            eq(sp.status, 'scheduled'),
            isNull(sp.activeAttemptId),
            request.expectedDispatchGeneration === undefined
              ? // Versions travel as ISO strings (ms precision); rows written by
                // the column default carry microseconds, so compare truncated.
                sql`date_trunc('milliseconds', ${sp.updatedAt}) = ${new Date(request.expectedVersion).toISOString()}::timestamp`
              : eq(sp.dispatchGeneration, request.expectedDispatchGeneration),
          ),
        )
        .returning({
          attemptCount: sp.attemptCount,
          dispatchGeneration: sp.dispatchGeneration,
        });
      if (!claimed) return null;

      // The update above holds the row lock, so max+1 cannot race.
      const [{ next }] = await tx
        .select({
          next: sql<number>`coalesce(max(${pj.attemptNumber}), 0) + 1`,
        })
        .from(pj)
        .where(eq(pj.scheduledPublicationId, request.publicationId));
      const attemptNumber = Number(next);
      const [attempt] = await tx
        .insert(pj)
        .values({
          scheduledPublicationId: request.publicationId,
          status: 'processing',
          attempts: claimed.attemptCount,
          attemptNumber,
          lastAttemptAt: now,
        })
        .returning({ id: pj.id });
      await tx
        .update(sp)
        .set({ activeAttemptId: attempt.id })
        .where(eq(sp.id, request.publicationId));

      return {
        publicationId: request.publicationId,
        attemptId: attempt.id,
        attemptNumber,
        attemptCount: claimed.attemptCount,
        dispatchGeneration: claimed.dispatchGeneration,
      };
    });
  }

  /** Spec §5 step 4: durable marker, only while this attempt still holds the lease. */
  async markSideEffect(
    claim: ClaimedAttempt,
    checkpoint: ProviderCheckpoint,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const now = new Date();
      const [owned] = await tx
        .update(sp)
        .set({ leaseExpiresAt: new Date(now.getTime() + this.config.leaseMs) })
        .where(
          and(
            eq(sp.id, claim.publicationId),
            eq(sp.status, 'publishing'),
            eq(sp.activeAttemptId, claim.attemptId),
            gt(sp.leaseExpiresAt, now),
          ),
        )
        .returning({ id: sp.id });
      if (!owned)
        throw new LeaseLostError(claim.publicationId, claim.attemptId);

      await tx
        .update(pj)
        .set({
          providerRequestStartedAt: now,
          providerOperationType: checkpoint.operationType.slice(0, 80),
          providerOperationId: checkpoint.operationId?.slice(0, 255) ?? null,
          providerCheckpoint: checkpoint.data ?? null,
          updatedAt: now,
        })
        .where(and(eq(pj.id, claim.attemptId), eq(pj.status, 'processing')));
    });
  }

  recordSuccess(
    claim: ClaimedAttempt,
    result: PublishResult,
  ): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const now = new Date();
      // Lock order everywhere: publication row first, then the attempt row.
      const [published] = await tx
        .update(sp)
        .set({ status: 'published', leaseExpiresAt: null, updatedAt: now })
        .where(
          and(
            eq(sp.id, claim.publicationId),
            inArray(sp.status, ['publishing', 'unknown']),
            eq(sp.activeAttemptId, claim.attemptId),
          ),
        )
        .returning({
          contentItemId: sp.contentItemId,
          variantId: sp.variantId,
        });

      await tx.insert(pr).values({
        publicationJobId: claim.attemptId,
        platformPostId: result.postId,
        platformPostUrl: result.url ?? null,
      });
      // Only the owning attempt may complete (spec 3.3); a non-owner keeps its
      // status and only leaves the result row for operators.
      if (!published) return false;

      await tx
        .update(pj)
        .set({ status: 'completed', completedAt: now, updatedAt: now })
        .where(
          and(
            eq(pj.id, claim.attemptId),
            inArray(pj.status, ['processing', 'unknown']),
          ),
        );

      if (published.variantId) {
        await tx
          .update(schema.contentVariants)
          .set({ status: 'published', publishedAt: now, updatedAt: now })
          .where(eq(schema.contentVariants.id, published.variantId));
      }

      const siblings = await tx.query.scheduledPublications.findMany({
        where: eq(sp.contentItemId, published.contentItemId),
        columns: { id: true, status: true },
      });
      const allTerminallyPublished = siblings.every(
        (sibling) =>
          sibling.id === claim.publicationId ||
          ['published', 'cancelled'].includes(sibling.status),
      );
      if (allTerminallyPublished) {
        await tx
          .update(schema.contentItems)
          .set({ status: 'published', updatedAt: now })
          .where(eq(schema.contentItems.id, published.contentItemId));
      }
      return true;
    });
  }

  recordFailure(
    claim: ClaimedAttempt,
    kind: 'retry' | 'terminal' | 'unknown',
    errorClass: ProviderErrorClass,
    message: string,
  ): Promise<FailureRecord> {
    return this.db.transaction(async (tx) => {
      const now = new Date();
      const [current] = await tx
        .select({
          status: sp.status,
          activeAttemptId: sp.activeAttemptId,
          attemptCount: sp.attemptCount,
        })
        .from(sp)
        .where(eq(sp.id, claim.publicationId))
        .for('update');
      await tx.insert(pr).values({
        publicationJobId: claim.attemptId,
        errorType: errorClass,
        errorMessage: message.slice(0, 1500),
      });

      if (
        !current ||
        current.status !== 'publishing' ||
        current.activeAttemptId !== claim.attemptId
      ) {
        // Late outcome from a non-owner: the result row is the only record (spec §5 step 5).
        return 'ownership_lost';
      }

      if (kind === 'unknown') {
        await tx
          .update(pj)
          .set({
            status: 'unknown',
            errorClass,
            completedAt: now,
            updatedAt: now,
          })
          .where(eq(pj.id, claim.attemptId));
        await tx
          .update(sp)
          .set({ status: 'unknown', leaseExpiresAt: null, updatedAt: now })
          .where(eq(sp.id, claim.publicationId));
        return 'unknown';
      }

      await tx
        .update(pj)
        .set({ status: 'failed', errorClass, completedAt: now, updatedAt: now })
        .where(eq(pj.id, claim.attemptId));

      if (kind === 'terminal') {
        await tx
          .update(sp)
          .set({ status: 'failed', leaseExpiresAt: null, updatedAt: now })
          .where(eq(sp.id, claim.publicationId));
        return 'failed';
      }

      if (current.attemptCount >= this.config.maxAttempts) {
        await tx.insert(pr).values({
          publicationJobId: claim.attemptId,
          errorType: 'retry_exhausted',
          errorMessage: `Stopped after ${current.attemptCount} attempt(s)`,
        });
        await tx
          .update(sp)
          .set({ status: 'failed', leaseExpiresAt: null, updatedAt: now })
          .where(eq(sp.id, claim.publicationId));
        return 'retry_exhausted';
      }

      await tx
        .update(sp)
        .set(
          rearmSet(
            now,
            new Date(now.getTime() + retryDelayMs(current.attemptCount)),
          ),
        )
        .where(eq(sp.id, claim.publicationId));
      return 'retry_scheduled';
    });
  }

  /** Spec §5.1. Each row is re-checked under its lock before any write (I4). */
  async sweepExpiredLeases(limit = 50): Promise<SweepDecision[]> {
    const candidates = await this.db
      .select({ id: sp.id, activeAttemptId: sp.activeAttemptId })
      .from(sp)
      .where(
        and(
          eq(sp.status, 'publishing'),
          isNotNull(sp.activeAttemptId),
          lte(sp.leaseExpiresAt, new Date()),
        ),
      )
      .limit(limit);

    const decisions: SweepDecision[] = [];
    for (const candidate of candidates) {
      const decision = await this.db.transaction(
        async (tx): Promise<SweepDecision | null> => {
          const now = new Date();
          const [row] = await tx
            .select({
              workspaceId: sp.workspaceId,
              activeAttemptId: sp.activeAttemptId,
              attemptCount: sp.attemptCount,
            })
            .from(sp)
            .where(
              and(
                eq(sp.id, candidate.id),
                eq(sp.status, 'publishing'),
                eq(sp.activeAttemptId, candidate.activeAttemptId!),
                lte(sp.leaseExpiresAt, now),
              ),
            )
            .for('update');
          if (!row) return null;

          const attempt =
            row.activeAttemptId === null
              ? undefined
              : await tx.query.publicationJobs.findFirst({
                  where: eq(pj.id, row.activeAttemptId),
                });
          const base = {
            publicationId: candidate.id,
            workspaceId: row.workspaceId,
            attemptId: attempt?.id ?? null,
          };

          if (attempt?.providerRequestStartedAt) {
            await tx
              .update(pj)
              .set({
                status: 'unknown',
                errorClass: 'unknown_outcome',
                completedAt: now,
                updatedAt: now,
              })
              .where(and(eq(pj.id, attempt.id), eq(pj.status, 'processing')));
            await tx.insert(pr).values({
              publicationJobId: attempt.id,
              errorType: 'unknown_outcome',
              errorMessage:
                'Lease expired after the provider request started; the outcome is unconfirmed.',
            });
            await tx
              .update(sp)
              .set({ status: 'unknown', leaseExpiresAt: null, updatedAt: now })
              .where(eq(sp.id, candidate.id));
            return { ...base, outcome: 'unknown' };
          }

          if (attempt) {
            await tx
              .update(pj)
              .set({
                status: 'abandoned',
                errorClass: 'internal',
                completedAt: now,
                updatedAt: now,
              })
              .where(and(eq(pj.id, attempt.id), eq(pj.status, 'processing')));
            await tx.insert(pr).values({
              publicationJobId: attempt.id,
              errorType: 'lease_expired_before_request',
              errorMessage:
                'Lease expired before the provider request started.',
            });
          }

          if (row.attemptCount >= this.config.maxAttempts) {
            if (attempt) {
              await tx.insert(pr).values({
                publicationJobId: attempt.id,
                errorType: 'retry_exhausted',
                errorMessage: `Stopped after ${row.attemptCount} attempt(s)`,
              });
            }
            await tx
              .update(sp)
              .set({ status: 'failed', leaseExpiresAt: null, updatedAt: now })
              .where(eq(sp.id, candidate.id));
            return { ...base, outcome: 'retry_exhausted' };
          }

          await tx
            .update(sp)
            .set(
              rearmSet(
                now,
                new Date(now.getTime() + retryDelayMs(row.attemptCount)),
              ),
            )
            .where(eq(sp.id, candidate.id));
          return { ...base, outcome: 'retry_scheduled' };
        },
      );
      if (decision) decisions.push(decision);
    }
    return decisions;
  }
}
