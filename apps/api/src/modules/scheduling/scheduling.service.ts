import {
  BadRequestException,
  Injectable,
  Inject,
  NotFoundException,
} from '@nestjs/common';
import { DRIZZLE } from '../../db/db.module.js';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema.js';
import { and, eq, gte, lte } from 'drizzle-orm';
import {
  CreateScheduleDto,
  GetCalendarDto,
  UpdateScheduleDto,
} from './scheduling.dto.js';

@Injectable()
export class SchedulingService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  getCalendar(workspaceId: number, query: GetCalendarDto) {
    const conditions = [
      eq(schema.scheduledPublications.workspaceId, workspaceId),
    ];

    if (query.startDate) {
      conditions.push(
        gte(schema.scheduledPublications.scheduledAt, new Date(query.startDate)),
      );
    }
    if (query.endDate) {
      conditions.push(
        lte(schema.scheduledPublications.scheduledAt, new Date(query.endDate)),
      );
    }

    return this.db.query.scheduledPublications.findMany({
      where: and(...conditions),
      with: {
        contentItem: true,
        variant: true,
        socialAccount: true,
      },
    });
  }

  async createSchedule(workspaceId: number, data: CreateScheduleDto) {
    const contentItem = await this.db.query.contentItems.findFirst({
      where: and(
        eq(schema.contentItems.id, data.contentItemId),
        eq(schema.contentItems.workspaceId, workspaceId),
      ),
    });
    if (!contentItem) throw new NotFoundException('Content item not found');

    const socialAccount = await this.db.query.socialAccounts.findFirst({
      where: and(
        eq(schema.socialAccounts.id, data.socialAccountId),
        eq(schema.socialAccounts.workspaceId, workspaceId),
      ),
    });
    if (!socialAccount) throw new NotFoundException('Social account not found');

    if (data.variantId) {
      const variant = await this.db.query.contentVariants.findFirst({
        where: and(
          eq(schema.contentVariants.id, data.variantId),
          eq(schema.contentVariants.contentItemId, data.contentItemId),
        ),
      });
      if (!variant) {
        throw new BadRequestException('Variant does not belong to content item');
      }
    }

    const [record] = await this.db
      .insert(schema.scheduledPublications)
      .values({
        workspaceId,
        contentItemId: data.contentItemId,
        variantId: data.variantId,
        socialAccountId: data.socialAccountId,
        scheduledAt: new Date(data.scheduledAt),
        status: 'scheduled',
      })
      .returning();

    return record;
  }

  async updateSchedule(
    workspaceId: number,
    id: number,
    data: UpdateScheduleDto,
  ) {
    const updateData: {
      scheduledAt?: Date;
      status?: string;
      updatedAt: Date;
    } = { updatedAt: new Date() };

    if (data.scheduledAt) updateData.scheduledAt = new Date(data.scheduledAt);
    if (data.status) updateData.status = data.status;

    const [record] = await this.db
      .update(schema.scheduledPublications)
      .set(updateData)
      .where(
        and(
          eq(schema.scheduledPublications.id, id),
          eq(schema.scheduledPublications.workspaceId, workspaceId),
        ),
      )
      .returning();

    if (!record) throw new NotFoundException('Scheduled publication not found');
    return record;
  }
}
