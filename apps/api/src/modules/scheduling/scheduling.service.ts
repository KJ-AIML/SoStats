import {
  BadRequestException,
  ConflictException,
  Injectable,
  Inject,
  NotFoundException,
} from '@nestjs/common';
import { DRIZZLE } from '../../db/db.module.js';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema.js';
import { and, eq, gte, inArray, lte } from 'drizzle-orm';
import {
  CreateScheduleDto,
  GetCalendarDto,
  UpdateScheduleDto,
} from './scheduling.dto.js';
import { ProviderRegistry } from '../channels/ProviderRegistry.js';
import { MediaService } from '../media/media.service.js';
import { isUniqueViolation } from '../../db/pg-errors.js';
import {
  ACTIVE_IDENTITY_INDEX,
  ACTIVE_PUBLICATION_STATUSES,
  isStatusIn,
  rearmSet,
  sameVersion,
  USER_MUTABLE_PUBLICATION_STATUSES,
} from '../publishing/publication-state.js';

export class ScheduleIdentityConflict extends ConflictException {
  constructor(readonly existingScheduleId: number | null) {
    super({
      message:
        'An active publication already exists for this content, channel and time',
      existingScheduleId,
    });
  }
}

function normalizeProvider(value?: string | null) {
  const normalized = (value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (normalized === 'twitter') return 'x';
  return normalized;
}

@Injectable()
export class SchedulingService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly providerRegistry: ProviderRegistry,
    private readonly mediaService: MediaService,
  ) {}

  private async identityConflict(
    workspaceId: number,
    contentItemId: number,
    socialAccountId: number,
    scheduledAt: Date,
  ) {
    const existing = await this.db.query.scheduledPublications.findFirst({
      where: and(
        eq(schema.scheduledPublications.workspaceId, workspaceId),
        eq(schema.scheduledPublications.contentItemId, contentItemId),
        eq(schema.scheduledPublications.socialAccountId, socialAccountId),
        eq(schema.scheduledPublications.scheduledAt, scheduledAt),
        inArray(schema.scheduledPublications.status, [
          ...ACTIVE_PUBLICATION_STATUSES,
        ]),
      ),
      columns: { id: true },
    });
    return new ScheduleIdentityConflict(existing?.id ?? null);
  }

  getCalendar(workspaceId: number, query: GetCalendarDto) {
    const conditions = [
      eq(schema.scheduledPublications.workspaceId, workspaceId),
    ];

    if (query.startDate) {
      const startDate = new Date(query.startDate);
      if (Number.isNaN(startDate.getTime())) {
        throw new BadRequestException('startDate must be a valid date');
      }
      conditions.push(gte(schema.scheduledPublications.scheduledAt, startDate));
    }

    if (query.endDate) {
      const endDate = new Date(query.endDate);
      if (Number.isNaN(endDate.getTime())) {
        throw new BadRequestException('endDate must be a valid date');
      }
      conditions.push(lte(schema.scheduledPublications.scheduledAt, endDate));
    }

    return this.db.query.scheduledPublications.findMany({
      where: and(...conditions),
      with: {
        contentItem: { with: { campaign: true } },
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
      // A concurrent identical create commits content=scheduled with its
      // insert; surface that as the identity conflict, not a product 400.
      const conflict = await this.identityConflict(
        workspaceId,
        data.contentItemId,
        data.socialAccountId,
        scheduledAt,
      );
      if (conflict.existingScheduleId !== null) throw conflict;
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

    const provider = this.providerRegistry.describeProvider(
      socialAccount.provider,
    );
    if (!provider.supported || !provider.capabilities?.text) {
      throw new BadRequestException(
        'This channel does not have an enabled text publishing adapter',
      );
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

    if (
      provider.capabilities?.requiresMedia ||
      provider.capabilities?.mediaMimeTypes?.length
    ) {
      const media = await this.mediaService.listReadyContentMedia(
        workspaceId,
        data.contentItemId,
        data.variantId,
      );
      const accepted = provider.capabilities.mediaMimeTypes || [];

      if (provider.capabilities.requiresMedia && media.length === 0) {
        throw new BadRequestException(
          'This channel requires a ready media attachment before scheduling',
        );
      }

      if (
        provider.capabilities.maxMediaItems &&
        media.length > provider.capabilities.maxMediaItems
      ) {
        throw new BadRequestException(
          `This channel supports at most ${provider.capabilities.maxMediaItems} media attachment(s) per publication`,
        );
      }

      const unsupported = media.find(
        (asset) => accepted.length > 0 && !accepted.includes(asset.mimeType),
      );
      if (unsupported) {
        throw new BadRequestException(
          `This channel does not support attached media type ${unsupported.mimeType}. Accepted: ${accepted.join(', ')}`,
        );
      }
    }

    try {
      return await this.db.transaction(async (tx) => {
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
    } catch (error) {
      if (isUniqueViolation(error, ACTIVE_IDENTITY_INDEX)) {
        throw await this.identityConflict(
          workspaceId,
          data.contentItemId,
          data.socialAccountId,
          scheduledAt,
        );
      }
      throw error;
    }
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

    if (!isStatusIn(current.status, USER_MUTABLE_PUBLICATION_STATUSES)) {
      throw new ConflictException(
        current.status === 'publishing'
          ? 'A publication in progress cannot be changed'
          : isStatusIn(current.status, ['unknown', 'needs_review'])
            ? 'This publication may already be live and must be resolved before it can be changed'
            : 'Published or cancelled publications cannot be changed',
      );
    }

    if (data.status && data.status !== 'cancelled') {
      throw new BadRequestException(
        'Schedule status can only be cancelled manually',
      );
    }

    if (!data.scheduledAt && data.status !== 'cancelled') {
      throw new BadRequestException(
        'Provide scheduledAt to reschedule or status=cancelled to cancel',
      );
    }

    if (data.status === 'cancelled') {
      return this.cancelSchedule(workspaceId, current);
    }

    const scheduledAt = new Date(data.scheduledAt as string);
    if (Number.isNaN(scheduledAt.getTime())) {
      throw new BadRequestException('scheduledAt must be a valid date');
    }

    try {
      return await this.db.transaction(async (tx) => {
        const now = new Date();
        const [record] = await tx
          .update(schema.scheduledPublications)
          .set({ ...rearmSet(now, null), scheduledAt, attemptCount: 0 })
          .where(
            and(
              eq(schema.scheduledPublications.id, id),
              eq(schema.scheduledPublications.workspaceId, workspaceId),
              inArray(schema.scheduledPublications.status, [
                ...USER_MUTABLE_PUBLICATION_STATUSES,
              ]),
              sameVersion(
                schema.scheduledPublications.updatedAt,
                current.updatedAt,
              ),
            ),
          )
          .returning();
        if (!record) {
          throw new ConflictException(
            'This publication changed while you were editing it. Refresh and try again.',
          );
        }

        await tx
          .update(schema.contentItems)
          .set({ status: 'scheduled', updatedAt: now })
          .where(eq(schema.contentItems.id, current.contentItemId));

        if (current.variantId) {
          await tx
            .update(schema.contentVariants)
            .set({ status: 'scheduled', scheduledAt, updatedAt: now })
            .where(eq(schema.contentVariants.id, current.variantId));
        }

        return record;
      });
    } catch (error) {
      if (isUniqueViolation(error, ACTIVE_IDENTITY_INDEX)) {
        throw await this.identityConflict(
          workspaceId,
          current.contentItemId,
          current.socialAccountId,
          scheduledAt,
        );
      }
      throw error;
    }
  }

  private cancelSchedule(
    workspaceId: number,
    current: typeof schema.scheduledPublications.$inferSelect,
  ) {
    return this.db.transaction(async (tx) => {
      const [record] = await tx
        .update(schema.scheduledPublications)
        .set({ status: 'cancelled', updatedAt: new Date() })
        .where(
          and(
            eq(schema.scheduledPublications.id, current.id),
            eq(schema.scheduledPublications.workspaceId, workspaceId),
            inArray(schema.scheduledPublications.status, [
              ...USER_MUTABLE_PUBLICATION_STATUSES,
            ]),
            sameVersion(
              schema.scheduledPublications.updatedAt,
              current.updatedAt,
            ),
          ),
        )
        .returning();
      if (!record) {
        throw new ConflictException(
          'This publication changed while you were editing it. Refresh and try again.',
        );
      }

      const contentSchedules = await tx.query.scheduledPublications.findMany({
        where: eq(
          schema.scheduledPublications.contentItemId,
          current.contentItemId,
        ),
      });
      const activeContentSchedules = contentSchedules.filter((schedule) =>
        isStatusIn(schedule.status, ACTIVE_PUBLICATION_STATUSES),
      );
      const hasPublishedContentSchedule = contentSchedules.some(
        (schedule) => schedule.status === 'published',
      );

      await tx
        .update(schema.contentItems)
        .set({
          status: activeContentSchedules.length
            ? 'scheduled'
            : hasPublishedContentSchedule
              ? 'published'
              : 'in_review',
          updatedAt: new Date(),
        })
        .where(eq(schema.contentItems.id, current.contentItemId));

      if (current.variantId) {
        const variantSchedules = contentSchedules.filter(
          (schedule) => schedule.variantId === current.variantId,
        );
        const activeVariantSchedule = variantSchedules
          .filter((schedule) =>
            isStatusIn(schedule.status, ACTIVE_PUBLICATION_STATUSES),
          )
          .sort(
            (a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime(),
          )[0];
        const hasPublishedVariantSchedule = variantSchedules.some(
          (schedule) => schedule.status === 'published',
        );

        await tx
          .update(schema.contentVariants)
          .set({
            status: activeVariantSchedule
              ? 'scheduled'
              : hasPublishedVariantSchedule
                ? 'published'
                : 'draft',
            scheduledAt: activeVariantSchedule?.scheduledAt || null,
            updatedAt: new Date(),
          })
          .where(eq(schema.contentVariants.id, current.variantId));
      }

      return record;
    });
  }
}
