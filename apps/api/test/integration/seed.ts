import type postgres from 'postgres';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../src/db/schema.js';

export type SeededChannel = {
  workspaceId: number;
  brandId: number;
  socialAccountId: number;
  contentItemId: number;
};

let counter = 0;

export async function seedChannel(
  sql: postgres.Sql,
  provider = 'x',
): Promise<SeededChannel> {
  counter += 1;
  const key = `${process.pid}-${Date.now()}-${counter}`;
  const [workspace] = await sql<{ id: number }[]>`
    insert into workspaces (name, slug) values (${`Workspace ${key}`}, ${`ws-${key}`}) returning id`;
  const [brand] = await sql<{ id: number }[]>`
    insert into brands (workspace_id, name) values (${workspace.id}, 'Brand') returning id`;
  const [account] = await sql<{ id: number }[]>`
    insert into social_accounts (workspace_id, brand_id, provider, provider_account_id, access_token, status)
    values (${workspace.id}, ${brand.id}, ${provider}, ${`acct-${key}`}, 'not-a-real-token', 'active')
    returning id`;
  const [content] = await sql<{ id: number }[]>`
    insert into content_items (workspace_id, brand_id, title, description, status)
    values (${workspace.id}, ${brand.id}, 'Launch', 'Launch day', 'approved')
    returning id`;
  return {
    workspaceId: workspace.id,
    brandId: brand.id,
    socialAccountId: account.id,
    contentItemId: content.id,
  };
}

export async function createPublication(
  db: PostgresJsDatabase<typeof schema>,
  seeded: SeededChannel,
  overrides: Partial<typeof schema.scheduledPublications.$inferInsert> = {},
) {
  const [row] = await db
    .insert(schema.scheduledPublications)
    .values({
      workspaceId: seeded.workspaceId,
      contentItemId: seeded.contentItemId,
      socialAccountId: seeded.socialAccountId,
      scheduledAt: new Date(Date.now() - 1_000),
      status: 'scheduled',
      ...overrides,
    })
    .returning();
  return row;
}
