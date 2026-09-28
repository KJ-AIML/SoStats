import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { and, eq } from 'drizzle-orm';
import * as schema from '../../db/schema.js';
import { DRIZZLE } from '../../db/db.module.js';
import { randomBytes } from 'crypto';
import { encrypt } from '../../utils/encryption.util.js';

function redactSecret<T extends { secret: string }>(endpoint: T) {
  const { secret: _secret, ...safe } = endpoint;
  return safe;
}

@Injectable()
export class WebhooksService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  async findAll(workspaceId: number) {
    const endpoints = await this.db.query.webhookEndpoints.findMany({
      where: eq(schema.webhookEndpoints.workspaceId, workspaceId),
    });
    return endpoints.map(redactSecret);
  }

  async findOne(workspaceId: number, id: number) {
    const endpoint = await this.db.query.webhookEndpoints.findFirst({
      where: and(
        eq(schema.webhookEndpoints.id, id),
        eq(schema.webhookEndpoints.workspaceId, workspaceId),
      ),
    });

    if (!endpoint) throw new NotFoundException('Webhook endpoint not found');
    return redactSecret(endpoint);
  }

  async create(workspaceId: number, data: { url: string; events: string[] }) {
    const secret = randomBytes(32).toString('base64url');

    const [endpoint] = await this.db
      .insert(schema.webhookEndpoints)
      .values({
        workspaceId,
        url: data.url,
        events: data.events,
        secret: encrypt(secret),
        active: true,
      })
      .returning();

    return { endpoint: redactSecret(endpoint), secret };
  }

  async update(
    workspaceId: number,
    id: number,
    data: { url?: string; events?: string[]; active?: boolean },
  ) {
    await this.findOne(workspaceId, id);

    const [updated] = await this.db
      .update(schema.webhookEndpoints)
      .set({ ...data, updatedAt: new Date() })
      .where(
        and(
          eq(schema.webhookEndpoints.id, id),
          eq(schema.webhookEndpoints.workspaceId, workspaceId),
        ),
      )
      .returning();

    return redactSecret(updated);
  }

  async remove(workspaceId: number, id: number) {
    await this.findOne(workspaceId, id);

    await this.db
      .delete(schema.webhookEndpoints)
      .where(
        and(
          eq(schema.webhookEndpoints.id, id),
          eq(schema.webhookEndpoints.workspaceId, workspaceId),
        ),
      );

    return { success: true };
  }

  async logDelivery(
    endpointId: number,
    data: {
      event: string;
      payload: Record<string, unknown>;
      statusCode?: number;
      success: boolean;
      durationMs?: number;
      requestHeaders?: Record<string, unknown>;
      responseHeaders?: Record<string, unknown>;
      responseBody?: string;
    },
  ) {
    const [delivery] = await this.db
      .insert(schema.webhookDeliveries)
      .values({ endpointId, ...data })
      .returning();

    return delivery;
  }
}
