import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DRIZZLE } from '../../db/db.module.js';
import * as schema from '../../db/schema.js';

@Injectable()
export class BrandContextService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  async get(workspaceId: number, brandId?: number | null) {
    if (brandId) {
      return this.db.query.brands.findFirst({
        where: and(
          eq(schema.brands.id, brandId),
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
    }

    return this.db.query.brands.findFirst({
      where: eq(schema.brands.workspaceId, workspaceId),
      with: {
        voiceProfiles: true,
        audiences: true,
        products: true,
        pillars: true,
        rules: true,
      },
      orderBy: (fields, { asc }) => [asc(fields.createdAt)],
    });
  }

  serialize(
    brand: Awaited<ReturnType<BrandContextService['get']>>,
    extra?: Record<string, unknown>,
  ) {
    if (!brand) return extra ? JSON.stringify(extra) : undefined;

    return JSON.stringify({
      brand: {
        name: brand.name,
        description: brand.description,
        websiteUrl: brand.websiteUrl,
      },
      voice: brand.voiceProfiles.map((profile) => ({
        tone: profile.tone,
        style: profile.style,
        guidelines: profile.guidelines,
      })),
      audiences: brand.audiences.map((audience) => ({
        name: audience.name,
        demographics: audience.demographics,
        painPoints: audience.painPoints,
      })),
      products: brand.products.map((product) => ({
        name: product.name,
        description: product.description,
        features: product.features,
      })),
      pillars: brand.pillars.map((pillar) => ({
        name: pillar.name,
        description: pillar.description,
      })),
      rules: brand.rules.map((rule) => ({
        type: rule.ruleType,
        description: rule.description,
      })),
      ...extra,
    });
  }
}
