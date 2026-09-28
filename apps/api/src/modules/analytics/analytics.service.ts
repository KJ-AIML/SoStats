import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { DRIZZLE } from '../../db/db.module.js';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema.js';
import { and, eq } from 'drizzle-orm';

@Injectable()
export class AnalyticsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  async getOverview(workspaceId: number) {
    const rows = await this.db.query.analyticsDaily.findMany({
      where: eq(schema.analyticsDaily.workspaceId, workspaceId),
      orderBy: (fields, { desc }) => [desc(fields.date)],
      limit: 30,
    });

    const totals = rows.reduce<Record<string, number>>((acc, row) => {
      const metrics = (row.metrics ?? {}) as Record<string, unknown>;
      for (const [key, value] of Object.entries(metrics)) {
        if (typeof value === 'number') acc[key] = (acc[key] ?? 0) + value;
      }
      return acc;
    }, {});

    return {
      workspaceId,
      totals,
      daily: rows,
      hasData: rows.length > 0,
    };
  }

  async getContentAnalytics(workspaceId: number, contentId: number) {
    const content = await this.db.query.contentItems.findFirst({
      where: and(
        eq(schema.contentItems.id, contentId),
        eq(schema.contentItems.workspaceId, workspaceId),
      ),
    });

    if (!content) throw new NotFoundException('Content item not found');

    const snapshots = await this.db.query.metricSnapshots.findMany({
      where: eq(schema.metricSnapshots.contentItemId, contentId),
      orderBy: (fields, { desc }) => [desc(fields.snapshotAt)],
    });

    return {
      contentId,
      latest: snapshots[0]?.metrics ?? null,
      snapshots,
      hasData: snapshots.length > 0,
    };
  }
}
