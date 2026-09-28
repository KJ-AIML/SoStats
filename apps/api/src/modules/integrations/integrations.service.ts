import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { and, eq } from 'drizzle-orm';
import * as schema from '../../db/schema.js';
import { DRIZZLE } from '../../db/db.module.js';
import { IntegrationRegistry } from './adapters/integration.registry.js';

@Injectable()
export class IntegrationsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly integrationRegistry: IntegrationRegistry,
  ) {}

  findAll(workspaceId: number) {
    return this.db.query.integrations.findMany({
      where: eq(schema.integrations.workspaceId, workspaceId),
    });
  }

  async findOne(workspaceId: number, id: number) {
    const integration = await this.db.query.integrations.findFirst({
      where: and(
        eq(schema.integrations.id, id),
        eq(schema.integrations.workspaceId, workspaceId),
      ),
    });

    if (!integration) throw new NotFoundException('Integration not found');
    return integration;
  }

  async create(
    workspaceId: number,
    data: { type: string; config: Record<string, unknown> },
  ) {
    this.integrationRegistry.getAdapter(data.type);

    const [created] = await this.db
      .insert(schema.integrations)
      .values({
        workspaceId,
        type: data.type,
        config: data.config,
        status: 'active',
      })
      .returning();

    return created;
  }

  async update(
    workspaceId: number,
    id: number,
    data: { config?: Record<string, unknown>; status?: string },
  ) {
    await this.findOne(workspaceId, id);

    const [updated] = await this.db
      .update(schema.integrations)
      .set({ ...data, updatedAt: new Date() })
      .where(
        and(
          eq(schema.integrations.id, id),
          eq(schema.integrations.workspaceId, workspaceId),
        ),
      )
      .returning();

    return updated;
  }

  async remove(workspaceId: number, id: number) {
    await this.findOne(workspaceId, id);
    await this.db
      .delete(schema.integrations)
      .where(
        and(
          eq(schema.integrations.id, id),
          eq(schema.integrations.workspaceId, workspaceId),
        ),
      );

    return { success: true };
  }

  async syncIntegration(workspaceId: number, id: number) {
    const integration = await this.findOne(workspaceId, id);
    const adapter = this.integrationRegistry.getAdapter(integration.type);

    await adapter.connect(integration.config);
    if (adapter.fetchData) await adapter.fetchData({});

    return { success: true, message: 'Sync complete' };
  }
}
