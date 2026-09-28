import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { DRIZZLE } from '../../db/db.module.js';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema.js';
import { eq } from 'drizzle-orm';

@Injectable()
export class WorkspacesService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  async create(name: string, userId: number) {
    const [workspace] = await this.db
      .insert(schema.workspaces)
      .values({
        name,
      })
      .returning();

    await this.db.insert(schema.workspaceMembers).values({
      workspaceId: workspace.id,
      userId,
      role: 'owner',
    });

    return workspace;
  }

  async findAllForUser(userId: number) {
    const userWorkspaces = await this.db.query.workspaceMembers.findMany({
      where: eq(schema.workspaceMembers.userId, userId),
      with: {
        workspace: true,
      },
    });
    return userWorkspaces.map((wm) => wm.workspace);
  }

  async findOne(id: number) {
    const workspace = await this.db.query.workspaces.findFirst({
      where: eq(schema.workspaces.id, id),
    });
    if (!workspace) throw new NotFoundException('Workspace not found');
    return workspace;
  }

  async update(id: number, name: string) {
    const [workspace] = await this.db
      .update(schema.workspaces)
      .set({ name, updatedAt: new Date() })
      .where(eq(schema.workspaces.id, id))
      .returning();
    if (!workspace) throw new NotFoundException('Workspace not found');
    return workspace;
  }

  async remove(id: number) {
    const [workspace] = await this.db
      .delete(schema.workspaces)
      .where(eq(schema.workspaces.id, id))
      .returning();
    if (!workspace) throw new NotFoundException('Workspace not found');
    return workspace;
  }
}
