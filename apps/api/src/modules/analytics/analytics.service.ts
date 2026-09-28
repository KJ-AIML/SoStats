import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Inject,
  NotFoundException,
} from '@nestjs/common';
import { DRIZZLE } from '../../db/db.module.js';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema.js';
import { and, eq } from 'drizzle-orm';
import { BrandContextService } from '../brands/brand-context.service.js';

interface AiInsightResponse {
  insights: Array<{
    finding: string;
    recommendation: string;
    impact_estimate: string;
  }>;
  summary: string;
}

@Injectable()
export class AnalyticsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly brandContext: BrandContextService,
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

  async generateInsights(workspaceId: number, brandId?: number) {
    const rows = await this.db.query.analyticsDaily.findMany({
      where: eq(schema.analyticsDaily.workspaceId, workspaceId),
      with: { socialAccount: true },
      orderBy: (fields, { desc }) => [desc(fields.date)],
      limit: 30,
    });

    const metrics = rows.flatMap((row) => {
      const values = (row.metrics ?? {}) as Record<string, unknown>;
      return Object.entries(values)
        .filter((entry): entry is [string, number] => typeof entry[1] === 'number')
        .map(([metricType, value]) => ({
          platform: row.socialAccount?.provider || 'all',
          metric_type: metricType,
          value,
          period: row.date.toISOString().slice(0, 10),
        }));
    });

    if (!metrics.length) {
      throw new BadRequestException(
        'Analytics data is required before generating AI insights',
      );
    }

    const brand = await this.brandContext.get(workspaceId, brandId);
    const baseUrl = process.env.AI_SERVICE_URL || 'http://localhost:8000';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);

    try {
      const response = await fetch(baseUrl + '/v1/insights/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          metrics,
          brand_context: this.brandContext.serialize(brand),
        }),
      });

      if (!response.ok) {
        throw new BadGatewayException(
          `AI service returned HTTP ${response.status}`,
        );
      }

      return (await response.json()) as AiInsightResponse;
    } catch (error) {
      if (error instanceof BadGatewayException) throw error;
      throw new BadGatewayException('AI insight service unavailable');
    } finally {
      clearTimeout(timer);
    }
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
