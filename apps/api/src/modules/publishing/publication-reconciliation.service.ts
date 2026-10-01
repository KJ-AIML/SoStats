import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, eq, isNull, lte, or, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DRIZZLE } from '../../db/db.module.js';
import * as schema from '../../db/schema.js';
import { ChannelCredentialService } from '../channels/channel-credential.service.js';
import { ProviderRegistry } from '../channels/ProviderRegistry.js';
import type { SocialPublisherPort } from '../channels/ports/SocialPublisherPort.js';
import {
  PublicationLedger,
  type ReconcileObservation,
} from './publication-ledger.js';
import {
  loadLocalEvidence,
  type ReconcileEvidence,
} from './publication-resolution.js';
import {
  PUBLISHING_CONFIG,
  type PublishingConfig,
} from './publishing.config.js';

const sp = schema.scheduledPublications;

type DueRow = ReconcileObservation & {
  workspaceId: number;
  socialAccountId: number;
};

export type ReconcileDueItem = {
  publicationId: number;
  outcome: 'published' | 'needs_review' | 'lost' | 'error';
  evidenceType: string | null;
};

export type ReconcileDueSummary = {
  selected: number;
  results: ReconcileDueItem[];
};

/** 32B-1 §4: the API side of automatic reconciliation. The worker is only the clock. */
@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly ledger: PublicationLedger,
    private readonly providerRegistry: ProviderRegistry,
    private readonly credentials: ChannelCredentialService,
    @Inject(PUBLISHING_CONFIG) private readonly config: PublishingConfig,
  ) {}

  async reconcileDue(
    limit = this.config.reconcileBatchLimit,
  ): Promise<ReconcileDueSummary> {
    const now = new Date();
    const graceCutoff = new Date(now.getTime() - this.config.reconcileGraceMs);
    // §4.1 exact due predicate. No lock is held while selecting (§4.3 step 1).
    const rows = (await this.db
      .select({
        publicationId: sp.id,
        workspaceId: sp.workspaceId,
        status: sp.status,
        reconcileAfter: sp.reconcileAfter,
        activeAttemptId: sp.activeAttemptId,
        socialAccountId: sp.socialAccountId,
      })
      .from(sp)
      .where(
        or(
          and(
            eq(sp.status, 'unknown'),
            or(
              lte(sp.reconcileAfter, now),
              and(isNull(sp.reconcileAfter), lte(sp.updatedAt, graceCutoff)),
            ),
          ),
          and(eq(sp.status, 'needs_review'), lte(sp.reconcileAfter, now)),
        ),
      )
      .orderBy(sql`${sp.reconcileAfter} asc nulls first`, asc(sp.id))
      .limit(Math.min(20, Math.max(1, limit)))) as DueRow[];

    // Lookups run outside any transaction and concurrently (§4.3 step 2).
    const settled = await Promise.allSettled(
      rows.map((row) => this.reconcileRow(row)),
    );
    return {
      selected: rows.length,
      results: settled.map((outcome, index) =>
        outcome.status === 'fulfilled'
          ? outcome.value
          : this.failed(rows[index]!, outcome.reason),
      ),
    };
  }

  private async reconcileRow(row: DueRow): Promise<ReconcileDueItem> {
    const evidence =
      (await loadLocalEvidence(this.db, row.publicationId)) ??
      (await this.lookup(row));
    const result = await this.ledger.reconcile(row, evidence);
    if (!result) {
      this.logEvent('publication.reconciliation_lost', {
        workspace_id: row.workspaceId,
        publication_id: row.publicationId,
      });
      return { publicationId: row.publicationId, outcome: 'lost', evidenceType: null };
    }

    this.logEvent('publication.reconciliation', {
      workspace_id: row.workspaceId,
      publication_id: row.publicationId,
      reconciliation_id: result.reconciliationId,
      attempt_id: evidence.attemptId,
      source: 'automatic',
      previous_status: row.status,
      outcome: evidence.kind === 'confirmed' ? 'confirmed_published' : 'inconclusive',
      evidence_type: evidence.evidenceType,
      lookup_reason: evidence.kind === 'inconclusive' ? evidence.evidenceType : null,
      platform_post_id: evidence.kind === 'confirmed' ? evidence.platformPostId : null,
    });
    return {
      publicationId: row.publicationId,
      outcome: result.status,
      evidenceType: evidence.evidenceType,
    };
  }

  /** §4.2 source 3. Every failure is inconclusive (R1) and nothing is thrown. */
  private async lookup(row: DueRow): Promise<ReconcileEvidence> {
    const inconclusive = (reason: string): ReconcileEvidence => ({
      kind: 'inconclusive',
      evidenceType: reason.slice(0, 60),
      attemptId: row.activeAttemptId,
    });
    if (row.activeAttemptId === null) return inconclusive('lookup_unavailable');

    const attempt = await this.db.query.publicationJobs.findFirst({
      where: eq(schema.publicationJobs.id, row.activeAttemptId),
      columns: { id: true, providerOperationType: true, providerOperationId: true },
    });
    const account = await this.db.query.socialAccounts.findFirst({
      where: eq(schema.socialAccounts.id, row.socialAccountId),
    });
    if (!attempt?.providerOperationType || !account) {
      return inconclusive('lookup_unavailable');
    }

    let adapter: SocialPublisherPort;
    try {
      adapter = this.providerRegistry.getProvider(account.provider);
    } catch {
      return inconclusive('lookup_unavailable');
    }
    if (!adapter.lookupPublication) return inconclusive('lookup_unavailable');

    let accessToken: string;
    try {
      accessToken = await this.credentials.getValidAccessToken(account, adapter);
    } catch {
      return inconclusive('credentials_unavailable');
    }

    try {
      const found = await adapter.lookupPublication(
        {
          operationType: attempt.providerOperationType,
          operationId: attempt.providerOperationId,
        },
        accessToken,
        AbortSignal.timeout(this.config.reconcileLookupBudgetMs),
      );
      if (found.kind === 'inconclusive') return inconclusive(found.reason);
      return {
        kind: 'confirmed',
        evidenceType: found.evidenceType.slice(0, 60),
        attemptId: attempt.id,
        platformPostId: found.platformPostId ?? null,
        platformPostUrl: found.platformPostUrl ?? null,
        duplicatePlatformPostIds: [],
      };
    } catch {
      return inconclusive('lookup_failed');
    }
  }

  private failed(row: DueRow, error: unknown): ReconcileDueItem {
    this.logEvent(
      'publication.reconciliation_failed',
      {
        workspace_id: row.workspaceId,
        publication_id: row.publicationId,
        error: error instanceof Error ? error.name : 'unknown',
      },
      'error',
    );
    return { publicationId: row.publicationId, outcome: 'error', evidenceType: null };
  }

  private logEvent(
    event: string,
    fields: Record<string, unknown>,
    level: 'log' | 'error' = 'log',
  ) {
    this.logger[level](JSON.stringify({ event, ...fields }));
  }
}
