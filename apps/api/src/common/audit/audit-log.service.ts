import { Injectable, Inject } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DRIZZLE } from '../../db/db.module.js';
import * as schema from '../../db/schema.js';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { WorkspaceAccessService } from '../workspace/workspace-access.service.js';

export type AuditActor =
  | {
      userId: number;
      email?: string | null;
      authMethod: 'jwt' | 'development' | 'api_key' | 'system';
      apiKeyId?: number | null;
    }
  | {
      userId?: null;
      email?: string | null;
      authMethod: 'invitation_token' | 'system';
      apiKeyId?: null;
    };

export type AuditEventInput = {
  workspaceId: number;
  actor: AuditActor;
  action: string;
  targetType: string;
  targetId?: string | number | null;
  metadata?: Record<string, unknown>;
};

const SENSITIVE_KEY =
  /(secret|token|password|authorization|access[_-]?token|refresh[_-]?token|hash|credential|cookie)/i;

function sanitizeValue(value: unknown, depth = 0): unknown {
  if (depth > 5) return '[TRUNCATED]';
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') {
    return value.length > 1000 ? `${value.slice(0, 1000)}…` : value;
  }
  if (
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeValue(item, depth + 1));
  }

  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value).slice(0, 50)) {
      result[key] = SENSITIVE_KEY.test(key)
        ? '[REDACTED]'
        : sanitizeValue(nested, depth + 1);
    }
    return result;
  }

  return String(value);
}

export function sanitizeAuditMetadata(
  metadata?: Record<string, unknown>,
): Record<string, unknown> {
  return (sanitizeValue(metadata || {}) || {}) as Record<string, unknown>;
}

export function actorFromUser(user: AuthenticatedUser): AuditActor {
  return {
    userId: user.id,
    email: user.email,
    authMethod: user.authMethod || 'jwt',
    apiKeyId: user.apiKey?.id || null,
  };
}

@Injectable()
export class AuditLogService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly access: WorkspaceAccessService,
  ) {}

  async record(input: AuditEventInput) {
    const action = input.action.trim().slice(0, 120);
    const targetType = input.targetType.trim().slice(0, 80);
    const targetId =
      input.targetId === null || input.targetId === undefined
        ? null
        : String(input.targetId).slice(0, 120);

    const [event] = await this.db
      .insert(schema.workspaceAuditEvents)
      .values({
        workspaceId: input.workspaceId,
        actorUserId: input.actor.userId ?? null,
        actorEmail: input.actor.email?.slice(0, 255) || null,
        authMethod: input.actor.authMethod,
        apiKeyId: input.actor.apiKeyId ?? null,
        action,
        targetType,
        targetId,
        metadata: sanitizeAuditMetadata(input.metadata),
      })
      .returning();

    return event;
  }

  async listForWorkspace(
    workspaceId: number,
    actorUserId: number,
    options: {
      limit?: number;
      action?: string;
    } = {},
  ) {
    await this.access.requireOwner(actorUserId, workspaceId);

    const limit = Math.min(Math.max(options.limit || 50, 1), 200);
    const where = options.action
      ? and(
          eq(schema.workspaceAuditEvents.workspaceId, workspaceId),
          eq(schema.workspaceAuditEvents.action, options.action.slice(0, 120)),
        )
      : eq(schema.workspaceAuditEvents.workspaceId, workspaceId);

    return this.db.query.workspaceAuditEvents.findMany({
      where,
      orderBy: [desc(schema.workspaceAuditEvents.createdAt)],
      limit,
    });
  }
}
