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
import type { ReplaceBrandContextDto } from './brands.dto.js';

export interface CreateBrandInput {
  workspaceId: number;
  name: string;
  description?: string;
  websiteUrl?: string;
}

export interface UpdateBrandInput {
  name?: string;
  description?: string;
  websiteUrl?: string;
}

function requiredText(value: unknown, label: string, max: number) {
  const result = String(value || '').trim().slice(0, max);
  if (!result) throw new BadRequestException(`${label} is required`);
  return result;
}

function optionalText(value: unknown, max: number) {
  const result = String(value || '').trim().slice(0, max);
  return result || null;
}

function website(value: unknown) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (raw.length > 255) {
    throw new BadRequestException('Website URL is too long');
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BadRequestException('Website URL must be a valid URL');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new BadRequestException('Website URL must use HTTP or HTTPS');
  }
  return url.toString();
}

function bounded<T>(value: T[] | undefined, label: string, max: number) {
  const rows = Array.isArray(value) ? value : [];
  if (rows.length > max) {
    throw new BadRequestException(`${label} supports at most ${max} entries`);
  }
  return rows;
}

@Injectable()
export class BrandsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  async create(data: CreateBrandInput) {
    const [brand] = await this.db
      .insert(schema.brands)
      .values({
        workspaceId: data.workspaceId,
        name: requiredText(data.name, 'Brand name', 255),
        description: optionalText(data.description, 5000),
        websiteUrl: website(data.websiteUrl),
      })
      .returning();
    return brand;
  }

  findAllForWorkspace(workspaceId: number) {
    return this.db.query.brands.findMany({
      where: eq(schema.brands.workspaceId, workspaceId),
      orderBy: (fields, { asc }) => [asc(fields.createdAt)],
    });
  }

  async findOne(id: number, workspaceId: number) {
    const brand = await this.db.query.brands.findFirst({
      where: and(
        eq(schema.brands.id, id),
        eq(schema.brands.workspaceId, workspaceId),
      ),
      with: {
        voiceProfiles: true,
        audiences: true,
        products: true,
        pillars: true,
        rules: true,
      },
    });

    if (!brand) throw new NotFoundException('Brand not found');
    return brand;
  }

  async update(id: number, workspaceId: number, data: UpdateBrandInput) {
    await this.findOne(id, workspaceId);

    const values: Partial<typeof schema.brands.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (data.name !== undefined) {
      values.name = requiredText(data.name, 'Brand name', 255);
    }
    if (data.description !== undefined) {
      values.description = optionalText(data.description, 5000);
    }
    if (data.websiteUrl !== undefined) {
      values.websiteUrl = website(data.websiteUrl);
    }

    const [brand] = await this.db
      .update(schema.brands)
      .set(values)
      .where(
        and(
          eq(schema.brands.id, id),
          eq(schema.brands.workspaceId, workspaceId),
        ),
      )
      .returning();

    if (!brand) throw new NotFoundException('Brand not found');
    return this.findOne(id, workspaceId);
  }

  async replaceContext(
    id: number,
    workspaceId: number,
    data: ReplaceBrandContextDto,
  ) {
    await this.findOne(id, workspaceId);

    const voiceProfiles = bounded(data.voiceProfiles, 'Voice profiles', 10).map(
      (profile) => ({
        brandId: id,
        tone: requiredText(profile.tone, 'Voice tone', 255),
        style: optionalText(profile.style, 5000),
        guidelines: optionalText(profile.guidelines, 10_000),
      }),
    );
    const audiences = bounded(data.audiences, 'Audiences', 25).map(
      (audience) => ({
        brandId: id,
        name: requiredText(audience.name, 'Audience name', 255),
        demographics: optionalText(audience.demographics, 5000),
        painPoints: optionalText(audience.painPoints, 10_000),
      }),
    );
    const products = bounded(data.products, 'Products', 50).map((product) => ({
      brandId: id,
      name: requiredText(product.name, 'Product name', 255),
      description: optionalText(product.description, 10_000),
      features: optionalText(product.features, 10_000),
    }));
    const pillars = bounded(data.pillars, 'Content pillars', 25).map(
      (pillar) => ({
        brandId: id,
        name: requiredText(pillar.name, 'Pillar name', 255),
        description: optionalText(pillar.description, 5000),
      }),
    );
    const rules = bounded(data.rules, 'Brand rules', 50).map((rule) => ({
      brandId: id,
      ruleType: requiredText(rule.ruleType, 'Rule type', 50),
      description: requiredText(rule.description, 'Rule description', 10_000),
    }));

    await this.db.transaction(async (tx) => {
      await tx
        .delete(schema.brandVoiceProfiles)
        .where(eq(schema.brandVoiceProfiles.brandId, id));
      await tx
        .delete(schema.brandAudiences)
        .where(eq(schema.brandAudiences.brandId, id));
      await tx
        .delete(schema.brandProducts)
        .where(eq(schema.brandProducts.brandId, id));
      await tx
        .delete(schema.contentPillars)
        .where(eq(schema.contentPillars.brandId, id));
      await tx
        .delete(schema.brandRules)
        .where(eq(schema.brandRules.brandId, id));

      if (voiceProfiles.length) {
        await tx.insert(schema.brandVoiceProfiles).values(voiceProfiles);
      }
      if (audiences.length) {
        await tx.insert(schema.brandAudiences).values(audiences);
      }
      if (products.length) {
        await tx.insert(schema.brandProducts).values(products);
      }
      if (pillars.length) {
        await tx.insert(schema.contentPillars).values(pillars);
      }
      if (rules.length) {
        await tx.insert(schema.brandRules).values(rules);
      }

      await tx
        .update(schema.brands)
        .set({ updatedAt: new Date() })
        .where(
          and(
            eq(schema.brands.id, id),
            eq(schema.brands.workspaceId, workspaceId),
          ),
        );
    });

    return this.findOne(id, workspaceId);
  }

  async remove(id: number, workspaceId: number) {
    const [brand] = await this.db
      .delete(schema.brands)
      .where(
        and(
          eq(schema.brands.id, id),
          eq(schema.brands.workspaceId, workspaceId),
        ),
      )
      .returning();

    if (!brand) throw new NotFoundException('Brand not found');
    return brand;
  }
}
