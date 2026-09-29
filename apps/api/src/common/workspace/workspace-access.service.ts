import {
  ForbiddenException,
  Injectable,
  NotFoundException,
  Inject,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DRIZZLE } from '../../db/db.module.js';
import * as schema from '../../db/schema.js';

export type WorkspaceRole = 'owner' | 'admin' | 'member';

export const WORKSPACE_ROLES: readonly WorkspaceRole[] = [
  'owner',
  'admin',
  'member',
];

export function isWorkspaceRole(value: string): value is WorkspaceRole {
  return WORKSPACE_ROLES.includes(value as WorkspaceRole);
}

@Injectable()
export class WorkspaceAccessService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  async requireMembership(
    userId: number,
    workspaceId: number,
    allowedRoles?: readonly WorkspaceRole[],
  ) {
    const membership = await this.db.query.workspaceMembers.findFirst({
      where: and(
        eq(schema.workspaceMembers.userId, userId),
        eq(schema.workspaceMembers.workspaceId, workspaceId),
      ),
    });

    if (!membership) throw new NotFoundException('Workspace not found');

    if (
      !isWorkspaceRole(membership.role) ||
      (allowedRoles && !allowedRoles.includes(membership.role))
    ) {
      throw new ForbiddenException('Insufficient workspace permissions');
    }

    return {
      ...membership,
      role: membership.role as WorkspaceRole,
    };
  }

  requireOwner(userId: number, workspaceId: number) {
    return this.requireMembership(userId, workspaceId, ['owner']);
  }

  requireManager(userId: number, workspaceId: number) {
    return this.requireMembership(userId, workspaceId, ['owner', 'admin']);
  }
}
