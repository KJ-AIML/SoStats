import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DRIZZLE } from '../../db/db.module.js';
import * as schema from '../../db/schema.js';
import { isUniqueViolation } from '../../db/pg-errors.js';
import { actorFromUser } from '../../common/audit/audit-log.service.js';
import type { AuthenticatedUser } from '../../common/auth/auth.types.js';
import { WorkspaceAccessService } from '../../common/workspace/workspace-access.service.js';
import {
  PublicationLedger,
  type ResolveResult,
} from '../publishing/publication-ledger.js';
import type { ResolutionAction } from '../publishing/publication-resolution.js';
import { ACTIVE_IDENTITY_INDEX } from '../publishing/publication-state.js';
import { SchedulingService } from './scheduling.service.js';

const sp = schema.scheduledPublications;
const ISO_WITH_ZONE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})$/;

/** Calendar-valid, Postgres-safe (year 2000-9999); JS Date.parse rolls Feb 30 over. */
function isValidScheduledAt(raw: unknown): raw is string {
  if (typeof raw !== 'string') return false;
  const m = ISO_WITH_ZONE.exec(raw);
  if (!m) return false;
  const [year, month, day, hour, minute, second] = m
    .slice(1, 7)
    .map((part) => Number(part ?? 0));
  if (year < 2000 || month < 1 || month > 12) return false;
  if (day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) {
    return false;
  }
  if (hour > 23 || minute > 59 || second > 59) return false;
  return !Number.isNaN(Date.parse(raw));
}
const OPERATOR_OUTCOME = {
  mark_published: 'confirmed_published',
  confirm_absent: 'confirmed_absent',
  cancel: 'cancelled',
} as const;

function optionalText(value: unknown, field: string, max: number) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw new BadRequestException(`${field} must be a string`);
  }
  const trimmed = value.trim();
  if (trimmed.length > max) {
    throw new BadRequestException(`${field} must be at most ${max} characters`);
  }
  return trimmed || undefined;
}

function optionalHttpsUrl(value: unknown) {
  const url = optionalText(value, 'platformPostUrl', 1024);
  if (url === undefined) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new BadRequestException('platformPostUrl must be an https URL');
  }
  if (parsed.protocol !== 'https:') {
    throw new BadRequestException('platformPostUrl must be an https URL');
  }
  return url;
}

/** 32B-1 §7.1. Pure validation (no reads). Invalid input is a 400. */
export function parseResolutionBody(body: unknown): ResolutionAction {
  const input = (body && typeof body === 'object' ? body : {}) as Record<
    string,
    unknown
  >;
  const note = optionalText(input.note, 'note', 500);
  switch (input.action) {
    case 'mark_published':
      return {
        action: 'mark_published',
        platformPostId: optionalText(input.platformPostId, 'platformPostId', 255),
        platformPostUrl: optionalHttpsUrl(input.platformPostUrl),
        note,
      };
    case 'confirm_absent': {
      const raw = input.scheduledAt;
      if (!isValidScheduledAt(raw)) {
        throw new BadRequestException(
          'scheduledAt must be an ISO timestamp with a timezone',
        );
      }
      return { action: 'confirm_absent', scheduledAt: new Date(raw), note };
    }
    case 'cancel':
      return { action: 'cancel', note };
    default:
      throw new BadRequestException(
        'action must be mark_published, confirm_absent or cancel',
      );
  }
}

@Injectable()
export class ScheduleResolutionService {
  private readonly logger = new Logger(ScheduleResolutionService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly access: WorkspaceAccessService,
    private readonly ledger: PublicationLedger,
    private readonly scheduling: SchedulingService,
  ) {}

  async resolve(
    workspaceId: number,
    scheduleId: number,
    user: AuthenticatedUser,
    resolution: ResolutionAction,
  ) {
    // §7.1: owners and admins only. A member gets 403 before the row is read.
    await this.access.requireManager(user.id, workspaceId);

    let result: ResolveResult;
    try {
      result = await this.ledger.resolve({
        publicationId: scheduleId,
        workspaceId,
        actor: actorFromUser(user),
        resolution,
      });
    } catch (error) {
      if (
        resolution.action === 'confirm_absent' &&
        isUniqueViolation(error, ACTIVE_IDENTITY_INDEX)
      ) {
        throw await this.identityConflict(
          workspaceId,
          scheduleId,
          resolution.scheduledAt,
          error,
        );
      }
      throw error;
    }

    switch (result.kind) {
      case 'not_found':
        throw new NotFoundException('Scheduled publication not found');
      case 'status_conflict':
        this.logEvent('publication.reconciliation_lost', {
          workspace_id: workspaceId,
          publication_id: scheduleId,
          source: 'operator',
        });
        throw new ConflictException({
          message:
            result.status === 'unknown'
              ? 'SoStats is still checking this publication'
              : `Only publications that need review can be resolved (status: ${result.status})`,
          status: result.status,
        });
      case 'channel_unusable':
        throw new ConflictException('Reconnect the channel before retrying');
      case 'resolved':
        this.logEvent('publication.reconciliation', {
          workspace_id: workspaceId,
          publication_id: scheduleId,
          reconciliation_id: result.reconciliationId,
          attempt_id: result.attemptId,
          source: 'operator',
          previous_status: 'needs_review',
          outcome: OPERATOR_OUTCOME[resolution.action],
          evidence_type: 'operator_attested',
          lookup_reason: null,
          platform_post_id:
            resolution.action === 'mark_published'
              ? (resolution.platformPostId ?? null)
              : null,
        });
        return this.scheduling.getSchedule(workspaceId, scheduleId);
    }
  }

  private async identityConflict(
    workspaceId: number,
    scheduleId: number,
    scheduledAt: Date,
    cause: unknown,
  ) {
    const row = await this.db.query.scheduledPublications.findFirst({
      where: and(eq(sp.id, scheduleId), eq(sp.workspaceId, workspaceId)),
      columns: { contentItemId: true, socialAccountId: true },
    });
    return row
      ? this.scheduling.identityConflict(
          workspaceId,
          row.contentItemId,
          row.socialAccountId,
          scheduledAt,
        )
      : cause;
  }

  private logEvent(event: string, fields: Record<string, unknown>) {
    this.logger.log(JSON.stringify({ event, ...fields }));
  }
}
