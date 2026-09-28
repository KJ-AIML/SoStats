import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import * as schema from '../../db/schema.js';
import { DRIZZLE } from '../../db/db.module.js';
import * as crypto from 'crypto';

@Injectable()
export class WebhooksService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  async findAll(workspaceId: number) {
    return this.db.query.webhookEndpoints.findMany({
      where: eq(schema.webhookEndpoints.workspaceId, workspaceId),
    });
  }

  async findOne(id: number) {
    const endpoint = await this.db.query.webhookEndpoints.findFirst({
      where: eq(schema.webhookEndpoints.id, id),
    });

    if (!endpoint) {
      throw new NotFoundException(`Webhook endpoint with id ${id} not found`);
    }

    return endpoint;
  }

  async create(workspaceId: number, data: { url: string; events: string[] }) {
    const secret = crypto.randomBytes(32).toString('hex');

    const [newEndpoint] = await this.db
      .insert(schema.webhookEndpoints)
      .values({
        workspaceId,
        url: data.url,
        events: data.events,
        secret,
        active: true,
      })
      .returning();

    return newEndpoint;
  }

  async update(
    id: number,
    data: { url?: string; events?: string[]; active?: boolean },
  ) {
    await this.findOne(id); // ensure exists

    const [updatedEndpoint] = await this.db
      .update(schema.webhookEndpoints)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(schema.webhookEndpoints.id, id))
      .returning();

    return updatedEndpoint;
  }

  async remove(id: number) {
    await this.findOne(id);

    await this.db
      .delete(schema.webhookEndpoints)
      .where(eq(schema.webhookEndpoints.id, id));

    return { success: true };
  }

  async logDelivery(
    endpointId: number,
    data: {
      event: string;
      payload: any;
      statusCode?: number;
      success: boolean;
      durationMs?: number;
      requestHeaders?: any;
      responseHeaders?: any;
      responseBody?: string;
    },
  ) {
    const [delivery] = await this.db
      .insert(schema.webhookDeliveries)
      .values({
        endpointId,
        ...data,
      })
      .returning();

    return delivery;
  }
}
