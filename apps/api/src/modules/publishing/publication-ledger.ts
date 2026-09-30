import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq, gt, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  AuditLogService,
  type AuditActor,
} from '../../common/audit/audit-log.service.js';
import { DRIZZLE } from '../../db/db.module.js';
import * as schema from '../../db/schema.js';
import type {
  ProviderCheckpoint,
  ProviderErrorClass,
  PublishResult,
} from '../channels/ports/SocialPublisherPort.js';
import { LeaseLostError } from './publication-outcome.js';
import {
  appendReconciliation,
  loadLocalEvidence,
  reuseOrInsertResult,
  SYSTEM_ACTOR,
  type ReconcileEvidence,
  type ResolutionAction,
} from './publication-resolution.js';
import {
  rollupCancelled,
  rollupPublished,
  rollupRearmed,
  type Tx,
} from './publication-rollup.js';
import {
  isStatusIn,
  rearmSet,
  sameReconcileAfter,
  sameVersion,
} from './publication-state.js';
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

/** A provider-confirmed post that could not be recorded as published (spec §5 step 5). */
export type ConfirmedPostEvidence = {
  platformPostId: string;
  platformPostUrl?: string | null;
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
  attemptNumber: number | null;
  attemptCount: number;
  dispatchGeneration: number;
  socialAccountId: number;
  markerSet: boolean;
  errorClass: ProviderErrorClass | null;
  outcome: 'unknown' | 'retry_scheduled' | 'retry_exhausted';
};

export type ReconcileObservation = {
  publicationId: number;
  status: 'unknown' | 'needs_review';
  reconcileAfter: Date | null;
  activeAttemptId: number | null;
};

export type ReconcileResult = {
  reconciliationId: number;
  workspaceId: number;
  status: 'published' | 'needs_review';
};

export type ResolveRequest = {
  publicationId: number;
  workspaceId: number;
  actor: AuditActor;
  resolution: ResolutionAction;
};

export type ResolveResult =
  | { kind: 'resolved'; reconciliationId: number; attemptId: number | null }
  | { kind: 'not_found' }
  | { kind: 'status_conflict'; status: string }
  | { kind: 'channel_unusable' };

/** Every publication state write for execution lives here (spec §5, I1/I4). */
@Injectable()
export class PublicationLedger {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    @Inject(PUBLISHING_CONFIG) private readonly config: PublishingConfig,
    private readonly audit: AuditLogService,
  ) {}

  /** 32B-1 §4.1: known proof is due now; anything else waits for the grace period. */
  private async reconcileAfterOnUnknown(tx: Tx, publicationId: number, now: Date) {
    return (await loadLocalEvidence(tx, publicationId))
      ? now
      : new Date(now.getTime() + this.config.reconcileGraceMs);
  }

  /** 32A §3.3: the owning attempt's own call returned success. */
  private completeAttempt(tx: Tx, attemptId: number, now: Date) {
    return tx
      .update(pj)
      .set({ status: 'completed', completedAt: now, updatedAt: now })
      .where(and(eq(pj.id, attemptId), inArray(pj.status, ['processing', 'unknown'])));
  }

  claim(request: ClaimRequest): Promise<ClaimedAttempt | null> {
    return this.db.transaction(async (tx) => {
      const now = new Date();
      // `scheduled` + generation (or version) is the ownership gate. A stale
      // active_attempt_id (e.g. rollback residue) is overwritten below, which
      // fences that attempt out of every later CAS write.
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
            request.expectedDispatchGeneration === undefined
              ? sameVersion(sp.updatedAt, request.expectedVersion)
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

  /**
   * 32A §3.3 and 32B-1 §6: only the owning attempt completes. From `unknown` or
   * `needs_review` the same transaction records the late confirmation.
   */
  recordSuccess(
    claim: ClaimedAttempt,
    result: PublishResult,
  ): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const now = new Date();
      // Lock order everywhere: publication row, then attempt, then content.
      const [current] = await tx
        .select({
          status: sp.status,
          activeAttemptId: sp.activeAttemptId,
          workspaceId: sp.workspaceId,
          contentItemId: sp.contentItemId,
          variantId: sp.variantId,
        })
        .from(sp)
        .where(eq(sp.id, claim.publicationId))
        .for('update');

      // Under the publication lock, so a reconciler that already materialized
      // this post id is seen: at most one result row per publication and id.
      await reuseOrInsertResult(
        tx,
        claim.publicationId,
        claim.attemptId,
        result.postId,
        result.url ?? null,
      );
      // A non-owner keeps its status and only leaves the result row as evidence.
      if (!current || current.activeAttemptId !== claim.attemptId) return false;

      if (current.status === 'published') {
        // Reconciliation or an operator already published this attempt's post.
        // Its own call did succeed, so the attempt completes; the state,
        // history and audit are already recorded.
        await this.completeAttempt(tx, claim.attemptId, now);
        return true;
      }
      if (!isStatusIn(current.status, ['publishing', 'unknown', 'needs_review'])) {
        return false;
      }

      await tx
        .update(sp)
        .set({
          status: 'published',
          leaseExpiresAt: null,
          reconcileAfter: null,
          updatedAt: now,
        })
        .where(eq(sp.id, claim.publicationId));
      await this.completeAttempt(tx, claim.attemptId, now);
      await rollupPublished(
        tx,
        {
          id: claim.publicationId,
          contentItemId: current.contentItemId,
          variantId: current.variantId,
        },
        now,
      );

      if (current.status !== 'publishing') {
        await appendReconciliation(tx, this.audit, {
          publicationId: claim.publicationId,
          workspaceId: current.workspaceId,
          attemptId: claim.attemptId,
          source: 'automatic',
          outcome: 'confirmed_published',
          evidenceType: 'late_confirmed_post_id',
          previousStatus: current.status,
          platformPostId: result.postId,
          platformPostUrl: result.url ?? null,
          actor: SYSTEM_ACTOR,
          auditAction: 'publication.reconciled_published',
        });
      }
      return true;
    });
  }

  /**
   * `evidence` (kind `unknown` only) is a provider-confirmed post that could not
   * be recorded as published. It is merged into the attempt's checkpoint, never
   * into `publication_results.platform_post_id` (which analytics ingests), and
   * is kept even when this attempt no longer owns the publication.
   */
  recordFailure(
    claim: ClaimedAttempt,
    kind: 'retry' | 'terminal' | 'unknown',
    errorClass: ProviderErrorClass,
    message: string,
    evidence?: ConfirmedPostEvidence,
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
      if (kind === 'unknown' && evidence) {
        const confirmed = {
          confirmedPlatformPostId: evidence.platformPostId,
          confirmedPlatformPostUrl: evidence.platformPostUrl ?? null,
        };
        await tx
          .update(pj)
          .set({
            providerCheckpoint: sql`coalesce(${pj.providerCheckpoint}, '{}'::jsonb) || ${JSON.stringify(confirmed)}::jsonb`,
            updatedAt: now,
          })
          .where(eq(pj.id, claim.attemptId));
      }

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
          .set({
            status: 'unknown',
            leaseExpiresAt: null,
            reconcileAfter: await this.reconcileAfterOnUnknown(
              tx,
              claim.publicationId,
              now,
            ),
            updatedAt: now,
          })
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
              dispatchGeneration: sp.dispatchGeneration,
              socialAccountId: sp.socialAccountId,
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
            attemptNumber: attempt?.attemptNumber ?? null,
            attemptCount: row.attemptCount,
            dispatchGeneration: row.dispatchGeneration,
            socialAccountId: row.socialAccountId,
            markerSet: Boolean(attempt?.providerRequestStartedAt),
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
              .set({
                status: 'unknown',
                leaseExpiresAt: null,
                reconcileAfter: await this.reconcileAfterOnUnknown(
                  tx,
                  candidate.id,
                  now,
                ),
                updatedAt: now,
              })
              .where(eq(sp.id, candidate.id));
            return {
              ...base,
              errorClass: 'unknown_outcome',
              outcome: 'unknown',
            };
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
            return {
              ...base,
              errorClass: attempt ? 'internal' : null,
              outcome: 'retry_exhausted',
            };
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
          return {
            ...base,
            errorClass: attempt ? 'internal' : null,
            outcome: 'retry_scheduled',
          };
        },
      );
      if (decision) decisions.push(decision);
    }
    return decisions;
  }

  /**
   * 32B-1 §4.3 step 3. Exactly one accepted transition per observed state (R2).
   * Every accepted pass clears `reconcile_after` (R7); a lost CAS writes nothing.
   */
  reconcile(
    observed: ReconcileObservation,
    evidence: ReconcileEvidence,
  ): Promise<ReconcileResult | null> {
    return this.db.transaction(async (tx) => {
      const now = new Date();
      const confirmed = evidence.kind === 'confirmed';
      const [row] = await tx
        .update(sp)
        .set(
          confirmed
            ? { status: 'published', leaseExpiresAt: null, reconcileAfter: null, updatedAt: now }
            : { status: 'needs_review', reconcileAfter: null, updatedAt: now },
        )
        .where(
          and(
            eq(sp.id, observed.publicationId),
            eq(sp.status, observed.status),
            sameReconcileAfter(observed.reconcileAfter),
            confirmed
              ? observed.activeAttemptId === null
                ? isNull(sp.activeAttemptId)
                : eq(sp.activeAttemptId, observed.activeAttemptId)
              : undefined,
          ),
        )
        .returning({
          workspaceId: sp.workspaceId,
          contentItemId: sp.contentItemId,
          variantId: sp.variantId,
        });
      if (!row) return null;

      if (evidence.kind === 'confirmed') {
        if (evidence.platformPostId) {
          await reuseOrInsertResult(
            tx,
            observed.publicationId,
            evidence.attemptId,
            evidence.platformPostId,
            evidence.platformPostUrl,
          );
        }
        await rollupPublished(
          tx,
          {
            id: observed.publicationId,
            contentItemId: row.contentItemId,
            variantId: row.variantId,
          },
          now,
        );
      }

      const reconciliationId = await appendReconciliation(tx, this.audit, {
        publicationId: observed.publicationId,
        workspaceId: row.workspaceId,
        attemptId: evidence.attemptId,
        source: 'automatic',
        outcome: confirmed ? 'confirmed_published' : 'inconclusive',
        evidenceType: evidence.evidenceType,
        previousStatus: observed.status,
        ...(evidence.kind === 'confirmed'
          ? {
              platformPostId: evidence.platformPostId,
              platformPostUrl: evidence.platformPostUrl,
              duplicatePlatformPostIds: evidence.duplicatePlatformPostIds,
            }
          : {}),
        actor: SYSTEM_ACTOR,
        auditAction: confirmed
          ? 'publication.reconciled_published'
          : observed.status === 'unknown'
            ? 'publication.reconciliation_escalated'
            : 'publication.reconciliation_inconclusive',
      });
      return {
        reconciliationId,
        workspaceId: row.workspaceId,
        status: confirmed ? 'published' : 'needs_review',
      };
    });
  }

  /**
   * 32B-1 §7.2. One transaction per action: the CAS on `needs_review` under the
   * row lock, the history row, any result, the rollup and the audit (R2, R5).
   */
  resolve(request: ResolveRequest): Promise<ResolveResult> {
    const { publicationId, workspaceId, resolution } = request;
    return this.db.transaction(async (tx): Promise<ResolveResult> => {
      const now = new Date();
      const [current] = await tx
        .select({
          id: sp.id,
          status: sp.status,
          activeAttemptId: sp.activeAttemptId,
          contentItemId: sp.contentItemId,
          variantId: sp.variantId,
          socialAccountId: sp.socialAccountId,
        })
        .from(sp)
        .where(and(eq(sp.id, publicationId), eq(sp.workspaceId, workspaceId)))
        .for('update');
      if (!current) return { kind: 'not_found' };
      if (current.status !== 'needs_review') {
        return { kind: 'status_conflict', status: current.status };
      }

      const [latest] =
        current.activeAttemptId === null
          ? await tx
              .select({ id: pj.id })
              .from(pj)
              .where(eq(pj.scheduledPublicationId, publicationId))
              .orderBy(desc(pj.createdAt), desc(pj.id))
              .limit(1)
          : [{ id: current.activeAttemptId }];
      const attemptId = latest?.id ?? null;
      const base = {
        publicationId,
        workspaceId,
        attemptId,
        source: 'operator' as const,
        evidenceType: 'operator_attested',
        previousStatus: current.status,
        actor: request.actor,
        note: resolution.note ?? null,
      };

      if (resolution.action === 'mark_published') {
        await tx
          .update(sp)
          .set({ status: 'published', leaseExpiresAt: null, reconcileAfter: null, updatedAt: now })
          .where(eq(sp.id, publicationId));
        if (resolution.platformPostId && attemptId !== null) {
          await reuseOrInsertResult(
            tx,
            publicationId,
            attemptId,
            resolution.platformPostId,
            resolution.platformPostUrl ?? null,
          );
        }
        await rollupPublished(tx, current, now);
        const reconciliationId = await appendReconciliation(tx, this.audit, {
          ...base,
          outcome: 'confirmed_published',
          platformPostId: resolution.platformPostId ?? null,
          platformPostUrl: resolution.platformPostUrl ?? null,
          auditAction: 'publication.resolution_marked_published',
        });
        return { kind: 'resolved', reconciliationId, attemptId };
      }

      if (resolution.action === 'confirm_absent') {
        const [account] = await tx
          .select({
            status: schema.socialAccounts.status,
            hasToken: sql<boolean>`${schema.socialAccounts.accessToken} is not null`,
          })
          .from(schema.socialAccounts)
          .where(eq(schema.socialAccounts.id, current.socialAccountId));
        if (account?.status !== 'active' || !account.hasToken) {
          return { kind: 'channel_unusable' };
        }
        // R4: 32A's rearmSet plus the resolution fields; the identity index may reject it.
        await tx
          .update(sp)
          .set({
            ...rearmSet(now, null),
            attemptCount: 0,
            scheduledAt: resolution.scheduledAt,
            reconcileAfter: null,
          })
          .where(eq(sp.id, publicationId));
        await rollupRearmed(tx, current, resolution.scheduledAt, now);
        const reconciliationId = await appendReconciliation(tx, this.audit, {
          ...base,
          outcome: 'confirmed_absent',
          scheduledAt: resolution.scheduledAt,
          auditAction: 'publication.resolution_confirmed_absent',
        });
        return { kind: 'resolved', reconciliationId, attemptId };
      }

      await tx
        .update(sp)
        .set({ status: 'cancelled', leaseExpiresAt: null, reconcileAfter: null, updatedAt: now })
        .where(eq(sp.id, publicationId));
      await rollupCancelled(tx, current, now);
      const reconciliationId = await appendReconciliation(tx, this.audit, {
        ...base,
        outcome: 'cancelled',
        auditAction: 'publication.resolution_cancelled',
      });
      return { kind: 'resolved', reconciliationId, attemptId };
    });
  }
}
