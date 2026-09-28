import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { DRIZZLE } from '../../db/db.module.js';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema.js';
import { eq } from 'drizzle-orm';

export interface CreateContentInput {
  workspaceId: number;
  brandId?: number;
  title: string;
  description?: string;
  status?: string;
}

export interface UpdateContentStatusInput {
  status: string;
}

export interface RepurposeContentInput {
  platforms: string[];
}

@Injectable()
export class ContentService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  async create(data: CreateContentInput) {
    const [contentItem] = await this.db
      .insert(schema.contentItems)
      .values({
        ...data,
        status: data.status || 'draft',
      })
      .returning();
    return contentItem;
  }

  async findAllForWorkspace(workspaceId: number) {
    return this.db.query.contentItems.findMany({
      where: eq(schema.contentItems.workspaceId, workspaceId),
      with: {
        variants: true,
        tags: {
          with: {
            tag: true,
          },
        },
      },
    });
  }

  async findOne(id: number) {
    const contentItem = await this.db.query.contentItems.findFirst({
      where: eq(schema.contentItems.id, id),
      with: {
        variants: true,
        tags: {
          with: {
            tag: true,
          },
        },
        assets: {
          with: {
            asset: true,
          },
        },
        approvalRequests: true,
      },
    });
    if (!contentItem) throw new NotFoundException('Content item not found');
    return contentItem;
  }

  async updateStatus(id: number, data: UpdateContentStatusInput) {
    const [contentItem] = await this.db
      .update(schema.contentItems)
      .set({ status: data.status, updatedAt: new Date() })
      .where(eq(schema.contentItems.id, id))
      .returning();
    if (!contentItem) throw new NotFoundException('Content item not found');
    return contentItem;
  }

  async repurpose(id: number, data: RepurposeContentInput) {
    const contentItem = await this.findOne(id);

    // Create variants for each platform
    const variants = await Promise.all(
      data.platforms.map(async (platform) => {
        const [variant] = await this.db
          .insert(schema.contentVariants)
          .values({
            contentItemId: contentItem.id,
            platform,
            content: `Draft content for ${platform} based on ${contentItem.title}`,
            status: 'draft',
          })
          .returning();
        return variant;
      }),
    );

    return { contentItem, newVariants: variants };
  }
}
