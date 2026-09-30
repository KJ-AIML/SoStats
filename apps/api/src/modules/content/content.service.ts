import {
  BadRequestException,
  Injectable,
  Inject,
  NotFoundException,
} from '@nestjs/common';
import { DRIZZLE } from '../../db/db.module.js';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema.js';
import { and, eq } from 'drizzle-orm';
import { PUBLIC_SOCIAL_ACCOUNT_COLUMNS } from '../channels/social-account.projection.js';

export interface CreateContentInput {
  workspaceId: number;
  brandId?: number;
  title: string;
  description?: string;
  status?: string;
}

export interface UpdateContentInput {
  title?: string;
  description?: string;
}

export interface UpdateContentStatusInput {
  status: string;
}

export interface UpdateContentVariantInput {
  content: string;
}

const MANUAL_CONTENT_STATUSES = new Set([
  'idea',
  'draft',
  'in_review',
  'approved',
  'archived',
]);

function cleanText(value?: string) {
  return typeof value === 'string' ? value.trim() : undefined;
}

@Injectable()
export class ContentService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  private async requireContent(workspaceId: number, id: number) {
    const contentItem = await this.db.query.contentItems.findFirst({
      where: and(
        eq(schema.contentItems.id, id),
        eq(schema.contentItems.workspaceId, workspaceId),
      ),
    });

    if (!contentItem) throw new NotFoundException('Content item not found');
    return contentItem;
  }

  async create(data: CreateContentInput) {
    const title = cleanText(data.title);
    if (!title) throw new BadRequestException('title is required');

    if (data.brandId) {
      const brand = await this.db.query.brands.findFirst({
        where: and(
          eq(schema.brands.id, data.brandId),
          eq(schema.brands.workspaceId, data.workspaceId),
        ),
      });
      if (!brand) throw new NotFoundException('Brand not found');
    }

    const status = data.status || 'draft';
    if (!MANUAL_CONTENT_STATUSES.has(status)) {
      throw new BadRequestException('Unsupported initial content status');
    }

    const [contentItem] = await this.db
      .insert(schema.contentItems)
      .values({
        workspaceId: data.workspaceId,
        brandId: data.brandId,
        title,
        description: cleanText(data.description),
        status,
      })
      .returning();

    return this.findOne(data.workspaceId, contentItem.id);
  }

  findAllForWorkspace(workspaceId: number) {
    return this.db.query.contentItems.findMany({
      where: eq(schema.contentItems.workspaceId, workspaceId),
      with: {
        campaign: true,
        variants: true,
        tags: { with: { tag: true } },
        scheduledPublications: {
          with: {
            variant: true,
            socialAccount: { columns: PUBLIC_SOCIAL_ACCOUNT_COLUMNS },
          },
        },
      },
      orderBy: (fields, { desc }) => [desc(fields.updatedAt)],
    });
  }

  async findOne(workspaceId: number, id: number) {
    const contentItem = await this.db.query.contentItems.findFirst({
      where: and(
        eq(schema.contentItems.id, id),
        eq(schema.contentItems.workspaceId, workspaceId),
      ),
      with: {
        campaign: true,
        variants: true,
        tags: { with: { tag: true } },
        assets: { with: { asset: true } },
        approvalRequests: true,
        scheduledPublications: {
          with: {
            variant: true,
            socialAccount: { columns: PUBLIC_SOCIAL_ACCOUNT_COLUMNS },
          },
        },
      },
    });

    if (!contentItem) throw new NotFoundException('Content item not found');
    return contentItem;
  }

  async update(
    workspaceId: number,
    id: number,
    data: UpdateContentInput,
  ) {
    const current = await this.requireContent(workspaceId, id);
    if (['scheduled', 'published'].includes(current.status)) {
      throw new BadRequestException(
        'Scheduled or published content copy cannot be edited here',
      );
    }

    const title = cleanText(data.title);
    const description =
      typeof data.description === 'string' ? data.description.trim() : undefined;

    if (typeof data.title === 'string' && !title) {
      throw new BadRequestException('title cannot be empty');
    }

    const [contentItem] = await this.db
      .update(schema.contentItems)
      .set({
        ...(title !== undefined ? { title } : {}),
        ...(description !== undefined ? { description } : {}),
        ...(['in_review', 'approved'].includes(current.status)
          ? { status: 'draft' }
          : {}),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.contentItems.id, id),
          eq(schema.contentItems.workspaceId, workspaceId),
        ),
      )
      .returning();

    if (!contentItem) throw new NotFoundException('Content item not found');
    return this.findOne(workspaceId, contentItem.id);
  }

  async updateStatus(
    workspaceId: number,
    id: number,
    data: UpdateContentStatusInput,
  ) {
    const current = await this.requireContent(workspaceId, id);

    if (!MANUAL_CONTENT_STATUSES.has(data.status)) {
      throw new BadRequestException(
        'Scheduled and published states are controlled by scheduling and publishing',
      );
    }

    if (['scheduled', 'published'].includes(current.status)) {
      throw new BadRequestException(
        'Scheduled or published content cannot be moved manually',
      );
    }

    const [contentItem] = await this.db
      .update(schema.contentItems)
      .set({ status: data.status, updatedAt: new Date() })
      .where(
        and(
          eq(schema.contentItems.id, id),
          eq(schema.contentItems.workspaceId, workspaceId),
        ),
      )
      .returning();

    if (!contentItem) throw new NotFoundException('Content item not found');
    return contentItem;
  }

  async updateVariant(
    workspaceId: number,
    contentId: number,
    variantId: number,
    data: UpdateContentVariantInput,
  ) {
    const contentItem = await this.requireContent(workspaceId, contentId);
    if (['scheduled', 'published'].includes(contentItem.status)) {
      throw new BadRequestException(
        'Scheduled or published variants cannot be edited here',
      );
    }

    const content = cleanText(data.content);
    if (!content) throw new BadRequestException('variant content is required');

    const variant = await this.db.query.contentVariants.findFirst({
      where: and(
        eq(schema.contentVariants.id, variantId),
        eq(schema.contentVariants.contentItemId, contentId),
      ),
    });
    if (!variant) throw new NotFoundException('Content variant not found');

    if (variant.content === content) return variant;

    return this.db.transaction(async (tx) => {
      await tx.insert(schema.contentVersions).values({
        variantId,
        content: variant.content,
      });

      const [updated] = await tx
        .update(schema.contentVariants)
        .set({
          content,
          status: 'draft',
          updatedAt: new Date(),
        })
        .where(eq(schema.contentVariants.id, variantId))
        .returning();

      if (['in_review', 'approved'].includes(contentItem.status)) {
        await tx
          .update(schema.contentItems)
          .set({ status: 'draft', updatedAt: new Date() })
          .where(eq(schema.contentItems.id, contentId));
      }

      return updated;
    });
  }

  async repurpose(
    workspaceId: number,
    id: number,
    _data: { platforms: string[] },
  ) {
    await this.requireContent(workspaceId, id);
    throw new BadRequestException(
      'Model-backed repurposing is not implemented yet. Use AI Studio to generate channel variants.',
    );
  }
}
