import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { DRIZZLE } from '../../db/db.module.js';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema.js';
import { eq } from 'drizzle-orm';
import { CreateCampaignDto, GenerateCampaignDto } from './campaigns.dto.js';

@Injectable()
export class CampaignsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  async create(data: CreateCampaignDto) {
    const { startDate, endDate, ...rest } = data;
    const [campaign] = await this.db
      .insert(schema.campaigns)
      .values({
        ...rest,
        startDate: startDate ? new Date(startDate) : undefined,
        endDate: endDate ? new Date(endDate) : undefined,
      })
      .returning();
    return campaign;
  }

  async findOne(id: number) {
    const campaign = await this.db.query.campaigns.findFirst({
      where: eq(schema.campaigns.id, id),
      with: {
        channels: true,
        pillars: true,
        contentItems: {
          with: {
            variants: true,
          },
        },
      },
    });
    if (!campaign) throw new NotFoundException('Campaign not found');
    return campaign;
  }

  async generate(id: number, data: GenerateCampaignDto) {
    const campaign = await this.findOne(id);

    // 1. Mock Axios call to the AI service
    const mockAiPlan = {
      channels: ['linkedin', 'twitter'],
      pillars: ['AI Trends', 'Automation Strategy'],
      contentItems: [
        {
          title: 'The Future of AI in Marketing',
          description: 'A deep dive into AI tools for marketers.',
          variants: [
            {
              platform: 'linkedin',
              content:
                'AI is changing marketing forever. Here are the top 3 trends...',
            },
            {
              platform: 'twitter',
              content: 'AI is changing marketing forever! #MarketingAI #Trends',
            },
          ],
        },
      ],
    };

    // 2. Insert channels and pillars
    if (mockAiPlan.channels.length > 0) {
      await this.db.insert(schema.campaignChannels).values(
        mockAiPlan.channels.map((platform) => ({
          campaignId: id,
          platform,
        })),
      );
    }

    if (mockAiPlan.pillars.length > 0) {
      await this.db.insert(schema.campaignPillars).values(
        mockAiPlan.pillars.map((pillar) => ({
          campaignId: id,
          pillar,
        })),
      );
    }

    // 3. Insert content items and variants
    for (const item of mockAiPlan.contentItems) {
      const [insertedItem] = await this.db
        .insert(schema.contentItems)
        .values({
          workspaceId: campaign.workspaceId,
          brandId: campaign.brandId,
          title: item.title,
          description: item.description,
          campaignId: id,
        })
        .returning();

      if (item.variants.length > 0) {
        await this.db.insert(schema.contentVariants).values(
          item.variants.map((variant) => ({
            contentItemId: insertedItem.id,
            platform: variant.platform,
            content: variant.content,
          })),
        );
      }
    }

    // 4. Update campaign status to active
    await this.db
      .update(schema.campaigns)
      .set({ status: 'active', updatedAt: new Date() })
      .where(eq(schema.campaigns.id, id));

    return this.findOne(id);
  }
}
