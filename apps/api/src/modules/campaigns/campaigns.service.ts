import {
  BadGatewayException,
  Injectable,
  Inject,
  NotFoundException,
} from '@nestjs/common';
import { DRIZZLE } from '../../db/db.module.js';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema.js';
import { and, eq } from 'drizzle-orm';
import { CreateCampaignDto, GenerateCampaignDto } from './campaigns.dto.js';
import { BrandContextService } from '../brands/brand-context.service.js';

interface AiCampaignPlan {
  title: string;
  objective: string;
  audience: string;
  channels: string[];
  contentPillars: string[];
  contentIdeas: Array<{
    idea: string;
    description: string;
    format: string;
  }>;
}

@Injectable()
export class CampaignsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly brandContext: BrandContextService,
  ) {}

  findAll(workspaceId: number) {
    return this.db.query.campaigns.findMany({
      where: eq(schema.campaigns.workspaceId, workspaceId),
      with: {
        brand: true,
        channels: true,
        pillars: true,
        contentItems: { with: { variants: true } },
      },
      orderBy: (fields, { desc }) => [desc(fields.createdAt)],
    });
  }

  async create(workspaceId: number, data: CreateCampaignDto) {
    if (data.brandId) {
      const brand = await this.db.query.brands.findFirst({
        where: and(
          eq(schema.brands.id, data.brandId),
          eq(schema.brands.workspaceId, workspaceId),
        ),
      });
      if (!brand) throw new NotFoundException('Brand not found');
    }

    const { startDate, endDate, channels = [], ...rest } = data;

    return this.db.transaction(async (tx) => {
      const [campaign] = await tx
        .insert(schema.campaigns)
        .values({
          ...rest,
          workspaceId,
          startDate: startDate ? new Date(startDate) : undefined,
          endDate: endDate ? new Date(endDate) : undefined,
        })
        .returning();

      if (channels.length) {
        await tx.insert(schema.campaignChannels).values(
          [...new Set(channels)].map((platform) => ({
            campaignId: campaign.id,
            platform,
          })),
        );
      }

      return campaign;
    });
  }

  async findOne(workspaceId: number, id: number) {
    const campaign = await this.db.query.campaigns.findFirst({
      where: and(
        eq(schema.campaigns.id, id),
        eq(schema.campaigns.workspaceId, workspaceId),
      ),
      with: {
        channels: true,
        pillars: true,
        contentItems: { with: { variants: true } },
      },
    });

    if (!campaign) throw new NotFoundException('Campaign not found');
    return campaign;
  }

  private async requestPlan(
    workspaceId: number,
    campaign: Awaited<ReturnType<CampaignsService['findOne']>>,
    data: GenerateCampaignDto,
  ): Promise<AiCampaignPlan> {
    const baseUrl = process.env.AI_SERVICE_URL || 'http://localhost:8000';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    const brand = await this.brandContext.get(workspaceId, campaign.brandId);
    const promptContext = this.brandContext.serialize(brand, {
      campaignDescription: campaign.description,
    });

    const audience =
      data.instructions ||
      brand?.audiences[0]?.name ||
      'Existing brand audience';
    const tone =
      brand?.voiceProfiles[0]?.tone || 'Use the configured brand voice';

    try {
      const response = await fetch(baseUrl + '/v1/campaigns/plan', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          goal: campaign.goal || data.topic || campaign.name,
          audience,
          channels: campaign.channels.map((channel) => channel.platform),
          tone,
          brand_context: promptContext,
        }),
      });

      if (!response.ok) {
        throw new BadGatewayException(
          `AI service returned HTTP ${response.status}`,
        );
      }

      return (await response.json()) as AiCampaignPlan;
    } catch (error) {
      if (error instanceof BadGatewayException) throw error;
      throw new BadGatewayException('AI campaign planning service unavailable');
    } finally {
      clearTimeout(timer);
    }
  }

  async generate(
    workspaceId: number,
    id: number,
    data: GenerateCampaignDto,
    options: { replaceExistingContent?: boolean } = {},
  ) {
    const campaign = await this.findOne(workspaceId, id);
    const plan = await this.requestPlan(workspaceId, campaign, data);

    await this.db.transaction(async (tx) => {
      await tx
        .delete(schema.campaignChannels)
        .where(eq(schema.campaignChannels.campaignId, id));
      await tx
        .delete(schema.campaignPillars)
        .where(eq(schema.campaignPillars.campaignId, id));

      if (options.replaceExistingContent) {
        await tx
          .delete(schema.contentItems)
          .where(eq(schema.contentItems.campaignId, id));
      }

      if (plan.channels.length) {
        await tx.insert(schema.campaignChannels).values(
          plan.channels.map((platform) => ({ campaignId: id, platform })),
        );
      }

      if (plan.contentPillars.length) {
        await tx.insert(schema.campaignPillars).values(
          plan.contentPillars.map((pillar) => ({ campaignId: id, pillar })),
        );
      }

      for (const idea of plan.contentIdeas) {
        const [item] = await tx
          .insert(schema.contentItems)
          .values({
            workspaceId,
            brandId: campaign.brandId,
            title: idea.idea,
            description: idea.description,
            campaignId: id,
            status: 'draft',
          })
          .returning();

        const platforms = plan.channels.length ? plan.channels : ['generic'];
        await tx.insert(schema.contentVariants).values(
          platforms.map((platform) => ({
            contentItemId: item.id,
            platform,
            content: idea.description,
            status: 'draft',
          })),
        );
      }

      await tx
        .update(schema.campaigns)
        .set({
          description: campaign.description || plan.objective,
          status: 'active',
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.campaigns.id, id),
            eq(schema.campaigns.workspaceId, workspaceId),
          ),
        );
    });

    return this.findOne(workspaceId, id);
  }
}
