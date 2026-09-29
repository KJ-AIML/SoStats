import { Injectable, Inject } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DRIZZLE } from '../../db/db.module.js';
import * as schema from '../../db/schema.js';
import { WorkspaceAccessService } from '../workspace/workspace-access.service.js';

type PreferenceInput = {
  securityEvents?: unknown;
  publishingFailures?: unknown;
  automationFailures?: unknown;
  weeklyDigest?: unknown;
};

function preferenceBoolean(value: unknown, fallback: boolean) {
  return typeof value === 'boolean' ? value : fallback;
}

@Injectable()
export class NotificationPreferencesService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly access: WorkspaceAccessService,
  ) {}

  async get(workspaceId: number, userId: number) {
    await this.access.requireMembership(userId, workspaceId);

    const existing =
      await this.db.query.workspaceNotificationPreferences.findFirst({
        where: and(
          eq(schema.workspaceNotificationPreferences.workspaceId, workspaceId),
          eq(schema.workspaceNotificationPreferences.userId, userId),
        ),
      });

    return {
      workspaceId,
      userId,
      securityEvents: existing?.securityEvents ?? true,
      publishingFailures: existing?.publishingFailures ?? true,
      automationFailures: existing?.automationFailures ?? true,
      weeklyDigest: existing?.weeklyDigest ?? false,
      updatedAt: existing?.updatedAt || null,
    };
  }

  async update(
    workspaceId: number,
    userId: number,
    input: PreferenceInput,
  ) {
    await this.access.requireMembership(userId, workspaceId);
    const current = await this.get(workspaceId, userId);

    const values = {
      securityEvents: preferenceBoolean(
        input.securityEvents,
        current.securityEvents,
      ),
      publishingFailures: preferenceBoolean(
        input.publishingFailures,
        current.publishingFailures,
      ),
      automationFailures: preferenceBoolean(
        input.automationFailures,
        current.automationFailures,
      ),
      weeklyDigest: preferenceBoolean(
        input.weeklyDigest,
        current.weeklyDigest,
      ),
      updatedAt: new Date(),
    };

    const [saved] = await this.db
      .insert(schema.workspaceNotificationPreferences)
      .values({
        workspaceId,
        userId,
        ...values,
      })
      .onConflictDoUpdate({
        target: [
          schema.workspaceNotificationPreferences.workspaceId,
          schema.workspaceNotificationPreferences.userId,
        ],
        set: values,
      })
      .returning();

    return {
      workspaceId,
      userId,
      securityEvents: saved.securityEvents,
      publishingFailures: saved.publishingFailures,
      automationFailures: saved.automationFailures,
      weeklyDigest: saved.weeklyDigest,
      updatedAt: saved.updatedAt,
    };
  }
}
