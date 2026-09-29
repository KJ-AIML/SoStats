import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Inject,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DRIZZLE } from '../../db/db.module.js';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema.js';
import { and, eq } from 'drizzle-orm';
import { WorkspaceAccessService } from '../../common/workspace/workspace-access.service.js';
import { WorkspaceInvitationsService } from './workspace-invitations.service.js';

function slugify(name: string) {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  return (base || 'workspace') + '-' + randomUUID().slice(0, 8);
}

function validateWorkspaceName(value: unknown) {
  const name = String(value || '').trim().slice(0, 255);
  if (!name) throw new BadRequestException('Workspace name is required');
  return name;
}

function validateTimezone(value: unknown) {
  const timezone = String(value || '').trim();
  if (!timezone || timezone.length > 100) {
    throw new BadRequestException('Timezone is required');
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
  } catch {
    throw new BadRequestException('Timezone must be a valid IANA timezone');
  }
  return timezone;
}

@Injectable()
export class WorkspacesService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly access: WorkspaceAccessService,
    private readonly invitations: WorkspaceInvitationsService,
  ) {}

  async create(name: string, userId: number) {
    const [workspace] = await this.db
      .insert(schema.workspaces)
      .values({ name: validateWorkspaceName(name), slug: slugify(name) })
      .returning();

    await this.db.insert(schema.workspaceMembers).values({
      workspaceId: workspace.id,
      userId,
      role: 'owner',
    });

    return workspace;
  }

  async findAllForUser(userId: number) {
    const memberships = await this.db.query.workspaceMembers.findMany({
      where: eq(schema.workspaceMembers.userId, userId),
      with: { workspace: true },
    });

    return memberships.map((membership) => ({
      ...membership.workspace,
      role: membership.role,
    }));
  }

  async findOneForUser(id: number, userId: number) {
    const membership = await this.db.query.workspaceMembers.findFirst({
      where: and(
        eq(schema.workspaceMembers.workspaceId, id),
        eq(schema.workspaceMembers.userId, userId),
      ),
      with: { workspace: true },
    });

    if (!membership) throw new NotFoundException('Workspace not found');
    return { ...membership.workspace, role: membership.role };
  }

  async settings(id: number, userId: number) {
    const membership = await this.access.requireMembership(userId, id);
    const workspace = await this.db.query.workspaces.findFirst({
      where: eq(schema.workspaces.id, id),
      with: {
        members: {
          with: {
            user: true,
          },
          orderBy: (fields, { asc }) => [asc(fields.createdAt)],
        },
      },
    });
    if (!workspace) throw new NotFoundException('Workspace not found');

    const invitations =
      membership.role === 'owner'
        ? await this.invitations.listForWorkspace(id, userId)
        : [];

    return {
      workspace: {
        id: workspace.id,
        name: workspace.name,
        slug: workspace.slug,
        timezone: workspace.timezone,
        role: membership.role,
        createdAt: workspace.createdAt,
        updatedAt: workspace.updatedAt,
      },
      members: workspace.members.map((member) => ({
        id: member.id,
        userId: member.userId,
        name: member.user?.name || null,
        email: member.user?.email || null,
        role: member.role,
        createdAt: member.createdAt,
        updatedAt: member.updatedAt,
        isCurrentUser: member.userId === userId,
      })),
      invitations,
      permissions: {
        canManageWorkspace: ['owner', 'admin'].includes(membership.role),
        canManageMembers: membership.role === 'owner',
        canManageInvitations: membership.role === 'owner',
        canDeleteWorkspace: membership.role === 'owner',
      },
      security: {
        authMode:
          process.env.AUTH_DEV_BYPASS === 'true' &&
          process.env.NODE_ENV !== 'production'
            ? 'development_bypass'
            : 'bearer_jwt',
        developmentBypassEnabled:
          process.env.AUTH_DEV_BYPASS === 'true' &&
          process.env.NODE_ENV !== 'production',
        jwtIssuerConfigured: Boolean(process.env.AUTH_JWT_ISSUER),
        jwtAudienceConfigured: Boolean(process.env.AUTH_JWT_AUDIENCE),
        productionRequiresBearerToken: true,
      },
      productCapabilities: {
        teamRoles: true,
        workspaceTimezone: true,
        invitations: true,
        invitationEmailDelivery: false,
        apiKeys: false,
        notificationPreferences: false,
        auditLog: false,
        workspacePublishPolicy: false,
      },
    };
  }

  async updateSettings(
    id: number,
    userId: number,
    input: { name?: string; timezone?: string },
  ) {
    await this.access.requireMembership(userId, id, ['owner', 'admin']);

    const values: Partial<typeof schema.workspaces.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (input.name !== undefined) values.name = validateWorkspaceName(input.name);
    if (input.timezone !== undefined) {
      values.timezone = validateTimezone(input.timezone);
    }

    const [workspace] = await this.db
      .update(schema.workspaces)
      .set(values)
      .where(eq(schema.workspaces.id, id))
      .returning();

    if (!workspace) throw new NotFoundException('Workspace not found');
    return workspace;
  }

  async updateMemberRole(
    workspaceId: number,
    actorUserId: number,
    memberId: number,
    role: string,
  ) {
    await this.access.requireMembership(actorUserId, workspaceId, ['owner']);

    if (!['admin', 'member'].includes(role)) {
      throw new BadRequestException(
        'Role must be admin or member. Ownership transfer is not implemented.',
      );
    }

    const member = await this.db.query.workspaceMembers.findFirst({
      where: and(
        eq(schema.workspaceMembers.id, memberId),
        eq(schema.workspaceMembers.workspaceId, workspaceId),
      ),
    });
    if (!member) throw new NotFoundException('Workspace member not found');
    if (member.role === 'owner') {
      throw new ForbiddenException(
        'Owner role cannot be changed without an ownership-transfer flow',
      );
    }

    const [updated] = await this.db
      .update(schema.workspaceMembers)
      .set({ role, updatedAt: new Date() })
      .where(eq(schema.workspaceMembers.id, memberId))
      .returning();

    return updated;
  }

  async removeMember(
    workspaceId: number,
    actorUserId: number,
    memberId: number,
  ) {
    await this.access.requireMembership(actorUserId, workspaceId, ['owner']);

    const member = await this.db.query.workspaceMembers.findFirst({
      where: and(
        eq(schema.workspaceMembers.id, memberId),
        eq(schema.workspaceMembers.workspaceId, workspaceId),
      ),
    });
    if (!member) throw new NotFoundException('Workspace member not found');
    if (member.role === 'owner') {
      throw new ForbiddenException(
        'Workspace owners cannot be removed without an ownership-transfer flow',
      );
    }

    await this.db
      .delete(schema.workspaceMembers)
      .where(eq(schema.workspaceMembers.id, memberId));

    return { success: true, id: memberId };
  }

  async update(id: number, userId: number, name: string) {
    await this.access.requireMembership(userId, id, ['owner', 'admin']);

    const [workspace] = await this.db
      .update(schema.workspaces)
      .set({ name: validateWorkspaceName(name), updatedAt: new Date() })
      .where(eq(schema.workspaces.id, id))
      .returning();

    if (!workspace) throw new NotFoundException('Workspace not found');
    return workspace;
  }

  async remove(id: number, userId: number) {
    await this.access.requireMembership(userId, id, ['owner']);

    const [workspace] = await this.db
      .delete(schema.workspaces)
      .where(eq(schema.workspaces.id, id))
      .returning();

    if (!workspace) throw new NotFoundException('Workspace not found');
    return workspace;
  }
}
