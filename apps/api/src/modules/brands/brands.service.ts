import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { DRIZZLE } from '../../db/db.module.js';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema.js';
import { and, eq } from 'drizzle-orm';

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

@Injectable()
export class BrandsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  async create(data: CreateBrandInput) {
    const [brand] = await this.db.insert(schema.brands).values(data).returning();
    return brand;
  }

  findAllForWorkspace(workspaceId: number) {
    return this.db.query.brands.findMany({
      where: eq(schema.brands.workspaceId, workspaceId),
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
    const [brand] = await this.db
      .update(schema.brands)
      .set({ ...data, updatedAt: new Date() })
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
