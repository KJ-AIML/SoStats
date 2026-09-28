import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import * as schema from '../../db/schema.js';
import { DRIZZLE } from '../../db/db.module.js';
import { IntegrationRegistry } from './adapters/integration.registry.js';

@Injectable()
export class IntegrationsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly integrationRegistry: IntegrationRegistry,
  ) {}

  async findAll(workspaceId: number) {
    return this.db.query.integrations.findMany({
      where: eq(schema.integrations.workspaceId, workspaceId),
    });
  }

  async findOne(id: number) {
    const integration = await this.db.query.integrations.findFirst({
      where: eq(schema.integrations.id, id),
    });

    if (!integration) {
      throw new NotFoundException(`Integration with id ${id} not found`);
    }

    return integration;
  }

  async create(workspaceId: number, data: { type: string; config: any }) {
    // Validate adapter exists
    this.integrationRegistry.getAdapter(data.type);

    const [newIntegration] = await this.db
      .insert(schema.integrations)
      .values({
        workspaceId,
        type: data.type,
        config: data.config,
        status: 'active',
      })
      .returning();

    return newIntegration;
  }

  async update(id: number, data: { config?: any; status?: string }) {
    await this.findOne(id); // ensure exists

    const [updatedIntegration] = await this.db
      .update(schema.integrations)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(schema.integrations.id, id))
      .returning();

    return updatedIntegration;
  }

  async remove(id: number) {
    await this.findOne(id);

    await this.db
      .delete(schema.integrations)
      .where(eq(schema.integrations.id, id));

    return { success: true };
  }

  async syncIntegration(id: number) {
    const integration = await this.findOne(id);
    const adapter = this.integrationRegistry.getAdapter(integration.type);

    await adapter.connect(integration.config);
    if (adapter.fetchData) {
      await adapter.fetchData({});
    }

    return { success: true, message: 'Sync complete' };
  }
}
