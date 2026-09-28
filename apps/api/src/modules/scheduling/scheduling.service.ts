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

function normalizeProvider(value?: string | null) {
  const normalized = (value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (normalized === 'twitter') return 'x';
  return normalized;
}

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
        jobs: { with: { results: true } },
      },
      orderBy: (fields, { asc }) => [asc(fields.scheduledAt)],
    });
  }

  async createSchedule(workspaceId: number, data: CreateScheduleDto) {
    const scheduledAt = new Date(data.scheduledAt);
    if (Number.isNaN(scheduledAt.getTime())) {
      throw new BadRequestException('scheduledAt must be a valid date');
    }

    const contentItem = await this.db.query.contentItems.findFirst({
      where: and(
        eq(schema.contentItems.id, data.contentItemId),
        eq(schema.contentItems.workspaceId, workspaceId),
      ),
    });
    if (!contentItem) throw new NotFoundException('Content item not found');

    if (!['in_review', 'approved'].includes(contentItem.status)) {
      throw new BadRequestException(
        'Content must be in review or approved before scheduling',
      );
    }

    const socialAccount = await this.db.query.socialAccounts.findFirst({
      where: and(
        eq(schema.socialAccounts.id, data.socialAccountId),
        eq(schema.socialAccounts.workspaceId, workspaceId),
      ),
    });
    if (!socialAccount) throw new NotFoundException('Social account not found');
    if (socialAccount.status !== 'active' || !socialAccount.accessToken) {
      throw new BadRequestException('Social account is not ready to publish');
    }

    let variant:
      | typeof schema.contentVariants.$inferSelect
      | undefined;

    if (data.variantId) {
      variant = await this.db.query.contentVariants.findFirst({
        where: and(
          eq(schema.contentVariants.id, data.variantId),
          eq(schema.contentVariants.contentItemId, data.contentItemId),
        ),
      });
      if (!variant) {
        throw new BadRequestException('Variant does not belong to content item');
      }

      if (
        variant.platform &&
        normalizeProvider(variant.platform) !==
          normalizeProvider(socialAccount.provider)
      ) {
        throw new BadRequestException(
          'Selected variant does not match the publishing channel',
        );
      }
    }

    return this.db.transaction(async (tx) => {
      const [record] = await tx
        .insert(schema.scheduledPublications)
        .values({
          workspaceId,
          contentItemId: data.contentItemId,
          variantId: data.variantId,
          socialAccountId: data.socialAccountId,
          scheduledAt,
          status: 'scheduled',
        })
        .returning();

      await tx
        .update(schema.contentItems)
        .set({ status: 'scheduled', updatedAt: new Date() })
        .where(eq(schema.contentItems.id, data.contentItemId));

      if (variant) {
        await tx
          .update(schema.contentVariants)
          .set({
            status: 'scheduled',
            scheduledAt,
            updatedAt: new Date(),
          })
          .where(eq(schema.contentVariants.id, variant.id));
      }

      return record;
    });
  }

  async updateSchedule(
    workspaceId: number,
    id: number,
    data: UpdateScheduleDto,
  ) {
    const current = await this.db.query.scheduledPublications.findFirst({
      where: and(
        eq(schema.scheduledPublications.id, id),
        eq(schema.scheduledPublications.workspaceId, workspaceId),
      ),
    });
    if (!current) throw new NotFoundException('Scheduled publication not found');

    if (
      data.scheduledAt &&
      ['published', 'cancelled'].includes(current.status)
    ) {
      throw new BadRequestException(
        'Published or cancelled publications cannot be rescheduled',
      );
    }

    const updateData: {
      scheduledAt?: Date;
      status?: string;
      updatedAt: Date;
    } = { updatedAt: new Date() };

    if (data.scheduledAt) {
      const scheduledAt = new Date(data.scheduledAt);
      if (Number.isNaN(scheduledAt.getTime())) {
        throw new BadRequestException('scheduledAt must be a valid date');
      }
      updateData.scheduledAt = scheduledAt;
      updateData.status = 'scheduled';
    }

    if (data.status) {
      if (!['scheduled', 'cancelled'].includes(data.status)) {
        throw new BadRequestException(
          'Schedule status can only be set to scheduled or cancelled manually',
        );
      }
      updateData.status = data.status;
    }

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

    return record;
  }
}
