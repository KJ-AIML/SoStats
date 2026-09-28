import { Injectable, Inject } from '@nestjs/common';
import { DRIZZLE } from '../../db/db.module.js';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema.js';
import { eq, and, gte, lte } from 'drizzle-orm';
import {
  CreateScheduleDto,
  UpdateScheduleDto,
  GetCalendarDto,
} from './scheduling.dto.js';

@Injectable()
export class SchedulingService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  async getCalendar(query: GetCalendarDto) {
    const { workspaceId, startDate, endDate } = query;
    const conditions = [
      eq(schema.scheduledPublications.workspaceId, workspaceId),
    ];

    if (startDate) {
      conditions.push(
        gte(schema.scheduledPublications.scheduledAt, new Date(startDate)),
      );
    }
    if (endDate) {
      conditions.push(
        lte(schema.scheduledPublications.scheduledAt, new Date(endDate)),
      );
    }

    const records = await this.db.query.scheduledPublications.findMany({
      where: and(...conditions),
      with: {
        contentItem: true,
        variant: true,
        socialAccount: true,
      },
    });

    return records;
  }

  async createSchedule(data: CreateScheduleDto) {
    const [record] = await this.db
      .insert(schema.scheduledPublications)
      .values({
        workspaceId: data.workspaceId,
        contentItemId: data.contentItemId,
        variantId: data.variantId,
        socialAccountId: data.socialAccountId,
        scheduledAt: new Date(data.scheduledAt),
        status: 'scheduled',
      })
      .returning();

    return record;
  }

  async updateSchedule(id: number, data: UpdateScheduleDto) {
    const updateData: any = {};
    if (data.scheduledAt) updateData.scheduledAt = new Date(data.scheduledAt);
    if (data.status) updateData.status = data.status;
    updateData.updatedAt = new Date();

    const [record] = await this.db
      .update(schema.scheduledPublications)
      .set(updateData)
      .where(eq(schema.scheduledPublications.id, id))
      .returning();

    return record;
  }
}
