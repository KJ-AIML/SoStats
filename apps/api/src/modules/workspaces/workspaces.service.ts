import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DRIZZLE } from '../../db/db.module.js';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema.js';
import { and, eq } from 'drizzle-orm';
import { WorkspaceAccessService } from '../../common/workspace/workspace-access.service.js';

function slugify(name: string) {
  const base = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  return (base || 'workspace') + '-' + randomUUID().slice(0, 8);
}

@Injectable()
export class WorkspacesService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly access: WorkspaceAccessService,
  ) {}

  async create(name: string, userId: number) {
    const [workspace] = await this.db
      .insert(schema.workspaces)
      .values({ name, slug: slugify(name) })
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

  async update(id: number, userId: number, name: string) {
    await this.access.requireMembership(userId, id, ['owner', 'admin']);

    const [workspace] = await this.db
      .update(schema.workspaces)
      .set({ name, updatedAt: new Date() })
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
