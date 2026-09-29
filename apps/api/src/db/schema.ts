import {
  pgTable,
  serial,
  varchar,
  text,
  timestamp,
  integer,
  uniqueIndex,
  index,
  jsonb,
  boolean,
  customType,
  check,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

// users
export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  authSubject: varchar('auth_subject', { length: 255 }).unique(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  name: varchar('name', { length: 255 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// workspaces
export const workspaces = pgTable('workspaces', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 255 }).notNull().unique(),
  timezone: varchar('timezone', { length: 100 }).notNull().default('UTC'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// workspace_members
export const workspaceMembers = pgTable(
  'workspace_members',
  {
    id: serial('id').primaryKey(),
    workspaceId: integer('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: varchar('role', { length: 50 }).notNull().default('member'), // owner, admin, member
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => {
    return {
      workspaceUserIdx: uniqueIndex('workspace_user_idx').on(
        table.workspaceId,
        table.userId,
      ),
      workspaceMemberRoleCheck: check(
        'workspace_member_role_check',
        sql`${table.role} in ('owner', 'admin', 'member')`,
      ),
      workspaceSingleOwnerIdx: uniqueIndex('workspace_single_owner_idx')
        .on(table.workspaceId)
        .where(sql`${table.role} = 'owner'`),
    };
  },
);

// workspace_invitations
export const workspaceInvitations = pgTable(
  'workspace_invitations',
  {
    id: serial('id').primaryKey(),
    workspaceId: integer('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    email: varchar('email', { length: 255 }).notNull(),
    role: varchar('role', { length: 50 }).notNull().default('member'),
    tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
    status: varchar('status', { length: 30 }).notNull().default('pending'),
    invitedByUserId: integer('invited_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    acceptedByUserId: integer('accepted_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    expiresAt: timestamp('expires_at').notNull(),
    acceptedAt: timestamp('accepted_at'),
    rejectedAt: timestamp('rejected_at'),
    revokedAt: timestamp('revoked_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    workspaceInviteEmailIdx: index('workspace_invite_email_idx').on(
      table.workspaceId,
      table.email,
    ),
    workspaceInviteStatusIdx: index('workspace_invite_status_idx').on(
      table.workspaceId,
      table.status,
    ),
    workspaceInviteRoleCheck: check(
      'workspace_invite_role_check',
      sql`${table.role} in ('admin', 'member')`,
    ),
    workspaceInviteStatusCheck: check(
      'workspace_invite_status_check',
      sql`${table.status} in ('pending', 'accepted', 'rejected', 'revoked', 'expired')`,
    ),
  }),
);

// workspace_api_keys
export const workspaceApiKeys = pgTable(
  'workspace_api_keys',
  {
    id: serial('id').primaryKey(),
    workspaceId: integer('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    createdByUserId: integer('created_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    publicId: varchar('public_id', { length: 32 }).notNull().unique(),
    name: varchar('name', { length: 120 }).notNull(),
    secretHash: varchar('secret_hash', { length: 64 }).notNull(),
    scopes: jsonb('scopes')
      .$type<string[]>()
      .notNull()
      .default([]),
    expiresAt: timestamp('expires_at').notNull(),
    lastUsedAt: timestamp('last_used_at'),
    rotatedAt: timestamp('rotated_at'),
    revokedAt: timestamp('revoked_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    workspaceApiKeyWorkspaceIdx: index('workspace_api_key_workspace_idx').on(
      table.workspaceId,
      table.createdAt,
    ),
    workspaceApiKeyActiveIdx: index('workspace_api_key_active_idx').on(
      table.workspaceId,
      table.revokedAt,
    ),
    workspaceApiKeyNameCheck: check(
      'workspace_api_key_name_check',
      sql`length(trim(${table.name})) between 1 and 120`,
    ),
    workspaceApiKeyScopesArrayCheck: check(
      'workspace_api_key_scopes_array_check',
      sql`jsonb_typeof(${table.scopes}) = 'array'`,
    ),
  }),
);

// workspace_audit_events
// Intentionally append-only. workspace/actor/target ids are snapshots rather than
// foreign keys so the audit record survives deletion of the referenced entity.
export const workspaceAuditEvents = pgTable(
  'workspace_audit_events',
  {
    id: serial('id').primaryKey(),
    workspaceId: integer('workspace_id').notNull(),
    actorUserId: integer('actor_user_id'),
    actorEmail: varchar('actor_email', { length: 255 }),
    authMethod: varchar('auth_method', { length: 40 }).notNull(),
    apiKeyId: integer('api_key_id'),
    sourceOutboxEventId: integer('source_outbox_event_id'),
    action: varchar('action', { length: 120 }).notNull(),
    targetType: varchar('target_type', { length: 80 }).notNull(),
    targetId: varchar('target_id', { length: 120 }),
    metadata: jsonb('metadata')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    workspaceAuditWorkspaceCreatedIdx: index(
      'workspace_audit_workspace_created_idx',
    ).on(table.workspaceId, table.createdAt),
    workspaceAuditActionIdx: index('workspace_audit_action_idx').on(
      table.workspaceId,
      table.action,
    ),
    workspaceAuditSourceOutboxIdx: uniqueIndex(
      'workspace_audit_source_outbox_idx',
    )
      .on(table.sourceOutboxEventId)
      .where(sql`${table.sourceOutboxEventId} is not null`),
    workspaceAuditAuthMethodCheck: check(
      'workspace_audit_auth_method_check',
      sql`${table.authMethod} in ('jwt', 'development', 'api_key', 'invitation_token', 'system')`,
    ),
    workspaceAuditActionCheck: check(
      'workspace_audit_action_check',
      sql`length(trim(${table.action})) between 1 and 120`,
    ),
    workspaceAuditTargetTypeCheck: check(
      'workspace_audit_target_type_check',
      sql`length(trim(${table.targetType})) between 1 and 80`,
    ),
  }),
);

// outbox_events
// Durable handoff between domain transactions and asynchronous side effects.
// Rows are claimed with leases so queue/process crashes recover after lease expiry.
export const outboxEvents = pgTable(
  'outbox_events',
  {
    id: serial('id').primaryKey(),
    workspaceId: integer('workspace_id'),
    topic: varchar('topic', { length: 120 }).notNull(),
    dedupeKey: varchar('dedupe_key', { length: 255 }).notNull().unique(),
    payload: jsonb('payload')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    status: varchar('status', { length: 30 }).notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    availableAt: timestamp('available_at').defaultNow().notNull(),
    leaseToken: varchar('lease_token', { length: 64 }),
    leaseExpiresAt: timestamp('lease_expires_at'),
    processedAt: timestamp('processed_at'),
    lastError: text('last_error'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    outboxDispatchIdx: index('outbox_dispatch_idx').on(
      table.status,
      table.availableAt,
      table.leaseExpiresAt,
    ),
    outboxWorkspaceIdx: index('outbox_workspace_idx').on(
      table.workspaceId,
      table.createdAt,
    ),
    outboxStatusCheck: check(
      'outbox_status_check',
      sql`${table.status} in ('pending', 'processing', 'completed', 'dead')`,
    ),
    outboxAttemptsCheck: check(
      'outbox_attempts_check',
      sql`${table.attempts} >= 0`,
    ),
  }),
);

// auth_sessions
// Stores a fingerprint of the presented bearer credential, never the raw token.
export const authSessions = pgTable(
  'auth_sessions',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
    authMethod: varchar('auth_method', { length: 40 }).notNull(),
    userAgent: varchar('user_agent', { length: 512 }),
    expiresAt: timestamp('expires_at'),
    lastSeenAt: timestamp('last_seen_at').defaultNow().notNull(),
    revokedAt: timestamp('revoked_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    authSessionUserIdx: index('auth_session_user_idx').on(
      table.userId,
      table.lastSeenAt,
    ),
    authSessionMethodCheck: check(
      'auth_session_method_check',
      sql`${table.authMethod} in ('jwt', 'development')`,
    ),
  }),
);

// workspace_notification_preferences
// Preferences are persisted policy only. Outbound delivery remains a separate
// adapter/runtime capability and is not implied by this table.
export const workspaceNotificationPreferences = pgTable(
  'workspace_notification_preferences',
  {
    id: serial('id').primaryKey(),
    workspaceId: integer('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    securityEvents: boolean('security_events').notNull().default(true),
    publishingFailures: boolean('publishing_failures').notNull().default(true),
    automationFailures: boolean('automation_failures').notNull().default(true),
    weeklyDigest: boolean('weekly_digest').notNull().default(false),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    workspaceNotificationUserIdx: uniqueIndex(
      'workspace_notification_user_idx',
    ).on(table.workspaceId, table.userId),
  }),
);

// brands
export const brands = pgTable(
  'brands',
  {
    id: serial('id').primaryKey(),
    workspaceId: integer('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: 255 }).notNull(),
    description: text('description'),
    websiteUrl: varchar('website_url', { length: 255 }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => {
    return {
      brandWorkspaceIdx: index('brand_workspace_idx').on(table.workspaceId),
    };
  },
);

// brand_voice_profiles
export const brandVoiceProfiles = pgTable('brand_voice_profiles', {
  id: serial('id').primaryKey(),
  brandId: integer('brand_id')
    .notNull()
    .references(() => brands.id, { onDelete: 'cascade' }),
  tone: varchar('tone', { length: 255 }).notNull(),
  style: text('style'),
  guidelines: text('guidelines'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// brand_audiences
export const brandAudiences = pgTable('brand_audiences', {
  id: serial('id').primaryKey(),
  brandId: integer('brand_id')
    .notNull()
    .references(() => brands.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  demographics: text('demographics'),
  painPoints: text('pain_points'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// brand_products
export const brandProducts = pgTable('brand_products', {
  id: serial('id').primaryKey(),
  brandId: integer('brand_id')
    .notNull()
    .references(() => brands.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  features: text('features'), // Could be jsonb, but text is simpler for Stage 1
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// content_pillars
export const contentPillars = pgTable('content_pillars', {
  id: serial('id').primaryKey(),
  brandId: integer('brand_id')
    .notNull()
    .references(() => brands.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// brand_rules
export const brandRules = pgTable('brand_rules', {
  id: serial('id').primaryKey(),
  brandId: integer('brand_id')
    .notNull()
    .references(() => brands.id, { onDelete: 'cascade' }),
  ruleType: varchar('rule_type', { length: 50 }).notNull(), // e.g. "do", "dont", "must_include"
  description: text('description').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// social_accounts
export const socialAccounts = pgTable('social_accounts', {
  id: serial('id').primaryKey(),
  workspaceId: integer('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  brandId: integer('brand_id')
    .notNull()
    .references(() => brands.id, { onDelete: 'cascade' }),
  provider: varchar('provider', { length: 50 }).notNull(), // e.g. "linkedin", "twitter"
  providerAccountId: varchar('provider_account_id', { length: 255 }).notNull(),
  accountName: varchar('account_name', { length: 255 }),
  accessToken: text('access_token'), // will be encrypted
  refreshToken: text('refresh_token'), // will be encrypted
  expiresAt: timestamp('expires_at'),
  status: varchar('status', { length: 50 }).default('active').notNull(), // active, expired, disconnected
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// channel_rules
export const channelRules = pgTable('channel_rules', {
  id: serial('id').primaryKey(),
  socialAccountId: integer('social_account_id')
    .notNull()
    .references(() => socialAccounts.id, { onDelete: 'cascade' }),
  ruleType: varchar('rule_type', { length: 50 }).notNull(), // e.g. "hashtag_limit", "mention_style"
  description: text('description').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// assets
export const assets = pgTable(
  'assets',
  {
    id: serial('id').primaryKey(),
    workspaceId: integer('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    brandId: integer('brand_id').references(() => brands.id, {
      onDelete: 'set null',
    }),
    fileName: varchar('file_name', { length: 255 }).notNull(),
    fileType: varchar('file_type', { length: 50 }).notNull(), // image, video
    mimeType: varchar('mime_type', { length: 100 }).notNull(),
    size: integer('size').notNull(),
    storageKey: varchar('storage_key', { length: 255 }).notNull(),
    publicUrl: varchar('public_url', { length: 1024 }),
    status: varchar('status', { length: 30 }).notNull().default('ready'),
    width: integer('width'),
    height: integer('height'),
    durationMs: integer('duration_ms'),
    processingToken: varchar('processing_token', { length: 64 }),
    processingError: text('processing_error'),
    uploadCompletedAt: timestamp('upload_completed_at'),
    processedAt: timestamp('processed_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    assetWorkspaceStatusIdx: index('asset_workspace_status_idx').on(
      table.workspaceId,
      table.status,
      table.updatedAt,
    ),
  }),
);

// asset_collections
export const assetCollections = pgTable('asset_collections', {
  id: serial('id').primaryKey(),
  workspaceId: integer('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// asset_collection_items
export const assetCollectionItems = pgTable('asset_collection_items', {
  id: serial('id').primaryKey(),
  collectionId: integer('collection_id')
    .notNull()
    .references(() => assetCollections.id, { onDelete: 'cascade' }),
  assetId: integer('asset_id')
    .notNull()
    .references(() => assets.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// asset_tags
export const assetTags = pgTable('asset_tags', {
  id: serial('id').primaryKey(),
  assetId: integer('asset_id')
    .notNull()
    .references(() => assets.id, { onDelete: 'cascade' }),
  tag: varchar('tag', { length: 100 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

const embedding1536 = customType<{
  data: number[];
  driverData: string;
}>({
  dataType() {
    return 'vector(1536)';
  },
  toDriver(value) {
    if (
      !Array.isArray(value) ||
      value.length !== 1536 ||
      value.some((item) => typeof item !== 'number' || !Number.isFinite(item))
    ) {
      throw new Error('Embedding must contain exactly 1536 finite numbers');
    }
    return `[${value.join(',')}]`;
  },
  fromDriver(value) {
    const parsed = JSON.parse(value) as unknown;
    if (
      !Array.isArray(parsed) ||
      parsed.some((item) => typeof item !== 'number')
    ) {
      throw new Error('Stored embedding has an invalid vector value');
    }
    return parsed;
  },
});

// knowledge_sources
export const knowledgeSources = pgTable(
  'knowledge_sources',
  {
    id: serial('id').primaryKey(),
    workspaceId: integer('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    brandId: integer('brand_id')
      .notNull()
      .references(() => brands.id, { onDelete: 'cascade' }),
    sourceType: varchar('source_type', { length: 30 }).notNull(),
    title: varchar('title', { length: 255 }).notNull(),
    sourceUrl: varchar('source_url', { length: 2048 }),
    sourceText: text('source_text'),
    mimeType: varchar('mime_type', { length: 150 }),
    fileName: varchar('file_name', { length: 255 }),
    fileSize: integer('file_size'),
    storageKey: varchar('storage_key', { length: 1024 }),
    contentHash: varchar('content_hash', { length: 64 }),
    status: varchar('status', { length: 30 }).notNull().default('processing'),
    activeVersion: integer('active_version').notNull().default(1),
    processingVersion: integer('processing_version'),
    processingToken: varchar('processing_token', { length: 64 }),
    embeddingModel: varchar('embedding_model', { length: 100 }),
    chunkCount: integer('chunk_count').notNull().default(0),
    metadata: jsonb('metadata')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    lastError: text('last_error'),
    uploadCompletedAt: timestamp('upload_completed_at'),
    processedAt: timestamp('processed_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    knowledgeSourceWorkspaceBrandIdx: index(
      'knowledge_source_workspace_brand_idx',
    ).on(table.workspaceId, table.brandId, table.status, table.updatedAt),
    knowledgeSourceHashIdx: index('knowledge_source_hash_idx').on(
      table.brandId,
      table.contentHash,
    ),
    knowledgeSourceDispatchIdx: index('knowledge_source_dispatch_idx').on(
      table.status,
      table.updatedAt,
    ),
  }),
);

// knowledge_chunks
export const knowledgeChunks = pgTable(
  'knowledge_chunks',
  {
    id: serial('id').primaryKey(),
    sourceId: integer('source_id')
      .notNull()
      .references(() => knowledgeSources.id, { onDelete: 'cascade' }),
    workspaceId: integer('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    brandId: integer('brand_id')
      .notNull()
      .references(() => brands.id, { onDelete: 'cascade' }),
    versionNumber: integer('version_number').notNull().default(1),
    chunkIndex: integer('chunk_index').notNull(),
    content: text('content').notNull(),
    embedding: embedding1536('embedding').notNull(),
    metadata: jsonb('metadata')
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    knowledgeChunkSourceVersionIndexUnique: uniqueIndex(
      'knowledge_chunk_source_version_index_unique',
    ).on(table.sourceId, table.versionNumber, table.chunkIndex),
    knowledgeChunkWorkspaceBrandIdx: index(
      'knowledge_chunk_workspace_brand_idx',
    ).on(table.workspaceId, table.brandId, table.sourceId),
  }),
);

// campaigns
export const campaigns = pgTable('campaigns', {
  id: serial('id').primaryKey(),
  workspaceId: integer('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  brandId: integer('brand_id').references(() => brands.id, {
    onDelete: 'set null',
  }),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  goal: varchar('goal', { length: 255 }),
  status: varchar('status', { length: 50 }).notNull().default('draft'), // draft, active, completed, archived
  generationContext: jsonb('generation_context')
    .$type<Record<string, unknown>>()
    .notNull()
    .default({}),
  startDate: timestamp('start_date'),
  endDate: timestamp('end_date'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// campaign_channels
export const campaignChannels = pgTable('campaign_channels', {
  id: serial('id').primaryKey(),
  campaignId: integer('campaign_id')
    .notNull()
    .references(() => campaigns.id, { onDelete: 'cascade' }),
  platform: varchar('platform', { length: 50 }).notNull(), // linkedin, twitter, etc.
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// campaign_pillars
export const campaignPillars = pgTable('campaign_pillars', {
  id: serial('id').primaryKey(),
  campaignId: integer('campaign_id')
    .notNull()
    .references(() => campaigns.id, { onDelete: 'cascade' }),
  pillar: varchar('pillar', { length: 255 }).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// tags
export const tags = pgTable('tags', {
  id: serial('id').primaryKey(),
  workspaceId: integer('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 100 }).notNull(),
  color: varchar('color', { length: 50 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// content_items
export const contentItems = pgTable(
  'content_items',
  {
    id: serial('id').primaryKey(),
    workspaceId: integer('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    brandId: integer('brand_id').references(() => brands.id, {
      onDelete: 'set null',
    }),
    title: varchar('title', { length: 255 }).notNull(),
    description: text('description'),
    status: varchar('status', { length: 50 }).notNull().default('draft'), // idea, draft, in_review, approved, scheduled, published, archived
    campaignId: integer('campaign_id').references(() => campaigns.id, {
      onDelete: 'set null',
    }),
    authorId: integer('author_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => {
    return {
      contentWorkspaceIdx: index('content_workspace_idx').on(table.workspaceId),
      contentBrandIdx: index('content_brand_idx').on(table.brandId),
    };
  },
);

// content_tags
export const contentTags = pgTable('content_tags', {
  id: serial('id').primaryKey(),
  contentItemId: integer('content_item_id')
    .notNull()
    .references(() => contentItems.id, { onDelete: 'cascade' }),
  tagId: integer('tag_id')
    .notNull()
    .references(() => tags.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// content_variants
export const contentVariants = pgTable('content_variants', {
  id: serial('id').primaryKey(),
  contentItemId: integer('content_item_id')
    .notNull()
    .references(() => contentItems.id, { onDelete: 'cascade' }),
  socialAccountId: integer('social_account_id').references(
    () => socialAccounts.id,
    { onDelete: 'set null' },
  ), // null for generic variants
  platform: varchar('platform', { length: 50 }), // linkedin, twitter, etc.
  content: text('content').notNull(),
  status: varchar('status', { length: 50 }).notNull().default('draft'),
  scheduledAt: timestamp('scheduled_at'),
  publishedAt: timestamp('published_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// content_versions
export const contentVersions = pgTable('content_versions', {
  id: serial('id').primaryKey(),
  variantId: integer('variant_id')
    .notNull()
    .references(() => contentVariants.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  authorId: integer('author_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// content_assets
export const contentAssets = pgTable('content_assets', {
  id: serial('id').primaryKey(),
  contentItemId: integer('content_item_id').references(() => contentItems.id, {
    onDelete: 'cascade',
  }),
  variantId: integer('variant_id').references(() => contentVariants.id, {
    onDelete: 'cascade',
  }),
  assetId: integer('asset_id')
    .notNull()
    .references(() => assets.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// approval_requests
export const approvalRequests = pgTable('approval_requests', {
  id: serial('id').primaryKey(),
  contentItemId: integer('content_item_id')
    .notNull()
    .references(() => contentItems.id, { onDelete: 'cascade' }),
  requesterId: integer('requester_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  status: varchar('status', { length: 50 }).notNull().default('pending'), // pending, approved, rejected
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// scheduled_publications
export const scheduledPublications = pgTable(
  'scheduled_publications',
  {
    id: serial('id').primaryKey(),
    contentItemId: integer('content_item_id')
      .notNull()
      .references(() => contentItems.id, { onDelete: 'cascade' }),
    variantId: integer('variant_id').references(() => contentVariants.id, {
      onDelete: 'cascade',
    }),
    workspaceId: integer('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    socialAccountId: integer('social_account_id')
      .notNull()
      .references(() => socialAccounts.id, { onDelete: 'cascade' }),
    scheduledAt: timestamp('scheduled_at').notNull(),
    status: varchar('status', { length: 50 }).notNull().default('scheduled'), // scheduled, published, failed, cancelled
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => {
    return {
      scheduledPubWorkspaceIdx: index('scheduled_pub_workspace_idx').on(
        table.workspaceId,
      ),
      scheduledPubDateIdx: index('scheduled_pub_date_idx').on(
        table.scheduledAt,
      ),
    };
  },
);

// publication_jobs
export const publicationJobs = pgTable('publication_jobs', {
  id: serial('id').primaryKey(),
  scheduledPublicationId: integer('scheduled_publication_id')
    .notNull()
    .references(() => scheduledPublications.id, { onDelete: 'cascade' }),
  status: varchar('status', { length: 50 }).notNull().default('pending'), // pending, processing, completed, failed
  attempts: integer('attempts').notNull().default(0),
  lastAttemptAt: timestamp('last_attempt_at'),
  nextAttemptAt: timestamp('next_attempt_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// publication_results
export const publicationResults = pgTable('publication_results', {
  id: serial('id').primaryKey(),
  publicationJobId: integer('publication_job_id')
    .notNull()
    .references(() => publicationJobs.id, { onDelete: 'cascade' }),
  platformPostId: varchar('platform_post_id', { length: 255 }),
  platformPostUrl: varchar('platform_post_url', { length: 1024 }),
  errorType: varchar('error_type', { length: 255 }),
  errorMessage: text('error_message'),
  rawResponse: text('raw_response'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// automations
export const automations = pgTable('automations', {
  id: serial('id').primaryKey(),
  workspaceId: integer('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  triggerType: varchar('trigger_type', { length: 50 }).notNull(), // e.g., 'manual', 'schedule', 'webhook'
  status: varchar('status', { length: 50 }).notNull().default('draft'), // 'draft', 'active', 'paused'
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// automation_versions
export const automationVersions = pgTable('automation_versions', {
  id: serial('id').primaryKey(),
  automationId: integer('automation_id')
    .notNull()
    .references(() => automations.id, { onDelete: 'cascade' }),
  versionNumber: integer('version_number').notNull(),
  workflowDefinition: jsonb('workflow_definition').notNull(),
  publishedAt: timestamp('published_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// automation_runs
export const automationRuns = pgTable('automation_runs', {
  id: serial('id').primaryKey(),
  automationId: integer('automation_id')
    .notNull()
    .references(() => automations.id, { onDelete: 'cascade' }),
  versionId: integer('version_id')
    .notNull()
    .references(() => automationVersions.id, { onDelete: 'cascade' }),
  status: varchar('status', { length: 50 }).notNull().default('pending'), // 'pending', 'running', 'completed', 'failed'
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  error: text('error'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// automation_run_steps
export const automationRunSteps = pgTable('automation_run_steps', {
  id: serial('id').primaryKey(),
  runId: integer('run_id')
    .notNull()
    .references(() => automationRuns.id, { onDelete: 'cascade' }),
  stepId: varchar('step_id', { length: 255 }).notNull(), // from workflow definition
  status: varchar('status', { length: 50 }).notNull().default('pending'), // 'pending', 'running', 'completed', 'failed'
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  logs: text('logs'),
  error: text('error'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// automation_triggers
export const automationTriggers = pgTable(
  'automation_triggers',
  {
    id: serial('id').primaryKey(),
    automationId: integer('automation_id')
      .notNull()
      .references(() => automations.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 50 }).notNull(),
    config: jsonb('config').notNull().default({}),
    status: varchar('status', { length: 30 }).notNull().default('active'),
    publicId: varchar('public_id', { length: 64 }),
    secret: varchar('secret', { length: 512 }),
    leaseToken: varchar('lease_token', { length: 64 }),
    leaseExpiresAt: timestamp('lease_expires_at'),
    nextPollAt: timestamp('next_poll_at'),
    lastPolledAt: timestamp('last_polled_at'),
    lastTriggeredAt: timestamp('last_triggered_at'),
    lastReceivedAt: timestamp('last_received_at'),
    lastError: text('last_error'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    automationTriggerAutomationUnique: uniqueIndex(
      'automation_trigger_automation_unique',
    ).on(table.automationId),
    automationTriggerPublicIdUnique: uniqueIndex(
      'automation_trigger_public_id_unique',
    ).on(table.publicId),
    automationTriggerDueIdx: index('automation_trigger_due_idx').on(
      table.status,
      table.nextPollAt,
    ),
  }),
);

// automation_trigger_events
export const automationTriggerEvents = pgTable(
  'automation_trigger_events',
  {
    id: serial('id').primaryKey(),
    triggerId: integer('trigger_id')
      .notNull()
      .references(() => automationTriggers.id, { onDelete: 'cascade' }),
    automationId: integer('automation_id')
      .notNull()
      .references(() => automations.id, { onDelete: 'cascade' }),
    eventKey: varchar('event_key', { length: 64 }).notNull(),
    externalId: varchar('external_id', { length: 1024 }).notNull(),
    payload: jsonb('payload').notNull(),
    runId: integer('run_id').references(() => automationRuns.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    automationTriggerEventUnique: uniqueIndex(
      'automation_trigger_event_unique',
    ).on(table.triggerId, table.eventKey),
    automationTriggerEventAutomationIdx: index(
      'automation_trigger_event_automation_idx',
    ).on(table.automationId, table.createdAt),
  }),
);

// metric_snapshots
export const metricSnapshots = pgTable('metric_snapshots', {
  id: serial('id').primaryKey(),
  contentItemId: integer('content_item_id').references(() => contentItems.id, {
    onDelete: 'cascade',
  }),
  socialAccountId: integer('social_account_id').references(
    () => socialAccounts.id,
    { onDelete: 'cascade' },
  ),
  platformPostId: varchar('platform_post_id', { length: 255 }),
  metrics: jsonb('metrics').notNull(),
  snapshotAt: timestamp('snapshot_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// analytics_daily
export const analyticsDaily = pgTable('analytics_daily', {
  id: serial('id').primaryKey(),
  workspaceId: integer('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  socialAccountId: integer('social_account_id').references(
    () => socialAccounts.id,
    { onDelete: 'cascade' },
  ),
  date: timestamp('date').notNull(),
  metrics: jsonb('metrics').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// ai_insights
export const aiInsights = pgTable(
  'ai_insights',
  {
    id: serial('id').primaryKey(),
    workspaceId: integer('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    brandId: integer('brand_id').references(() => brands.id, {
      onDelete: 'set null',
    }),
    generationId: varchar('generation_id', { length: 64 }).notNull(),
    summary: text('summary'),
    finding: text('finding').notNull(),
    evidence: jsonb('evidence').notNull().default([]),
    evidenceData: jsonb('evidence_data').notNull().default({}),
    recommendation: text('recommendation').notNull(),
    impactEstimate: text('impact_estimate'),
    confidence: varchar('confidence', { length: 20 }).notNull().default('medium'),
    actionType: varchar('action_type', { length: 50 }).notNull().default('none'),
    actionPayload: jsonb('action_payload').notNull().default({}),
    status: varchar('status', { length: 30 }).notNull().default('pending'),
    result: jsonb('result'),
    error: text('error'),
    executedAt: timestamp('executed_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    insightWorkspaceIdx: index('ai_insight_workspace_idx').on(
      table.workspaceId,
      table.createdAt,
    ),
    insightStatusIdx: index('ai_insight_status_idx').on(
      table.workspaceId,
      table.status,
    ),
  }),
);

// integrations
export const integrations = pgTable('integrations', {
  id: serial('id').primaryKey(),
  workspaceId: integer('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  type: varchar('type', { length: 50 }).notNull(), // e.g. 'wordpress', 'rss'
  config: jsonb('config').notNull().default({}), // credentials, urls, etc.
  status: varchar('status', { length: 50 }).notNull().default('active'), // active, error
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// webhook_endpoints
export const webhookEndpoints = pgTable('webhook_endpoints', {
  id: serial('id').primaryKey(),
  workspaceId: integer('workspace_id')
    .notNull()
    .references(() => workspaces.id, { onDelete: 'cascade' }),
  url: varchar('url', { length: 1024 }).notNull(),
  events: jsonb('events').notNull().default([]), // string[] of events
  secret: varchar('secret', { length: 255 }).notNull(),
  active: boolean('active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// webhook_deliveries
export const webhookDeliveries = pgTable('webhook_deliveries', {
  id: serial('id').primaryKey(),
  endpointId: integer('endpoint_id')
    .notNull()
    .references(() => webhookEndpoints.id, { onDelete: 'cascade' }),
  event: varchar('event', { length: 255 }).notNull(),
  payload: jsonb('payload').notNull(),
  statusCode: integer('status_code'),
  success: boolean('success').notNull(),
  durationMs: integer('duration_ms'),
  requestHeaders: jsonb('request_headers'),
  responseHeaders: jsonb('response_headers'),
  responseBody: text('response_body'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Relations
export const workspacesRelations = relations(workspaces, ({ many }) => ({
  members: many(workspaceMembers),
  invitations: many(workspaceInvitations),
  apiKeys: many(workspaceApiKeys),
  notificationPreferences: many(workspaceNotificationPreferences),
  brands: many(brands),
  socialAccounts: many(socialAccounts),
  assets: many(assets),
  assetCollections: many(assetCollections),
  campaigns: many(campaigns),
  scheduledPublications: many(scheduledPublications),
  automations: many(automations),
  aiInsights: many(aiInsights),
  integrations: many(integrations),
  webhookEndpoints: many(webhookEndpoints),
  knowledgeSources: many(knowledgeSources),
  knowledgeChunks: many(knowledgeChunks),
}));

export const usersRelations = relations(users, ({ many }) => ({
  workspaceMembers: many(workspaceMembers),
  invitationsSent: many(workspaceInvitations, { relationName: 'invitedBy' }),
  invitationsAccepted: many(workspaceInvitations, {
    relationName: 'acceptedBy',
  }),
  apiKeysCreated: many(workspaceApiKeys),
  authSessions: many(authSessions),
  notificationPreferences: many(workspaceNotificationPreferences),
}));

export const workspaceMembersRelations = relations(
  workspaceMembers,
  ({ one }) => ({
    workspace: one(workspaces, {
      fields: [workspaceMembers.workspaceId],
      references: [workspaces.id],
    }),
    user: one(users, {
      fields: [workspaceMembers.userId],
      references: [users.id],
    }),
  }),
);

export const workspaceInvitationsRelations = relations(
  workspaceInvitations,
  ({ one }) => ({
    workspace: one(workspaces, {
      fields: [workspaceInvitations.workspaceId],
      references: [workspaces.id],
    }),
    invitedBy: one(users, {
      relationName: 'invitedBy',
      fields: [workspaceInvitations.invitedByUserId],
      references: [users.id],
    }),
    acceptedBy: one(users, {
      relationName: 'acceptedBy',
      fields: [workspaceInvitations.acceptedByUserId],
      references: [users.id],
    }),
  }),
);

export const workspaceApiKeysRelations = relations(
  workspaceApiKeys,
  ({ one }) => ({
    workspace: one(workspaces, {
      fields: [workspaceApiKeys.workspaceId],
      references: [workspaces.id],
    }),
    createdBy: one(users, {
      fields: [workspaceApiKeys.createdByUserId],
      references: [users.id],
    }),
  }),
);

export const authSessionsRelations = relations(authSessions, ({ one }) => ({
  user: one(users, {
    fields: [authSessions.userId],
    references: [users.id],
  }),
}));

export const workspaceNotificationPreferencesRelations = relations(
  workspaceNotificationPreferences,
  ({ one }) => ({
    workspace: one(workspaces, {
      fields: [workspaceNotificationPreferences.workspaceId],
      references: [workspaces.id],
    }),
    user: one(users, {
      fields: [workspaceNotificationPreferences.userId],
      references: [users.id],
    }),
  }),
);

export const brandsRelations = relations(brands, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [brands.workspaceId],
    references: [workspaces.id],
  }),
  voiceProfiles: many(brandVoiceProfiles),
  audiences: many(brandAudiences),
  products: many(brandProducts),
  pillars: many(contentPillars),
  rules: many(brandRules),
  socialAccounts: many(socialAccounts),
  assets: many(assets),
  campaigns: many(campaigns),
  aiInsights: many(aiInsights),
  knowledgeSources: many(knowledgeSources),
  knowledgeChunks: many(knowledgeChunks),
}));

export const brandVoiceProfilesRelations = relations(
  brandVoiceProfiles,
  ({ one }) => ({
    brand: one(brands, {
      fields: [brandVoiceProfiles.brandId],
      references: [brands.id],
    }),
  }),
);

export const brandAudiencesRelations = relations(brandAudiences, ({ one }) => ({
  brand: one(brands, {
    fields: [brandAudiences.brandId],
    references: [brands.id],
  }),
}));

export const brandProductsRelations = relations(brandProducts, ({ one }) => ({
  brand: one(brands, {
    fields: [brandProducts.brandId],
    references: [brands.id],
  }),
}));

export const contentPillarsRelations = relations(contentPillars, ({ one }) => ({
  brand: one(brands, {
    fields: [contentPillars.brandId],
    references: [brands.id],
  }),
}));

export const brandRulesRelations = relations(brandRules, ({ one }) => ({
  brand: one(brands, {
    fields: [brandRules.brandId],
    references: [brands.id],
  }),
}));

export const knowledgeSourcesRelations = relations(
  knowledgeSources,
  ({ one, many }) => ({
    workspace: one(workspaces, {
      fields: [knowledgeSources.workspaceId],
      references: [workspaces.id],
    }),
    brand: one(brands, {
      fields: [knowledgeSources.brandId],
      references: [brands.id],
    }),
    chunks: many(knowledgeChunks),
  }),
);

export const knowledgeChunksRelations = relations(
  knowledgeChunks,
  ({ one }) => ({
    source: one(knowledgeSources, {
      fields: [knowledgeChunks.sourceId],
      references: [knowledgeSources.id],
    }),
    workspace: one(workspaces, {
      fields: [knowledgeChunks.workspaceId],
      references: [workspaces.id],
    }),
    brand: one(brands, {
      fields: [knowledgeChunks.brandId],
      references: [brands.id],
    }),
  }),
);

export const socialAccountsRelations = relations(
  socialAccounts,
  ({ one, many }) => ({
    workspace: one(workspaces, {
      fields: [socialAccounts.workspaceId],
      references: [workspaces.id],
    }),
    brand: one(brands, {
      fields: [socialAccounts.brandId],
      references: [brands.id],
    }),
    channelRules: many(channelRules),
    scheduledPublications: many(scheduledPublications),
  }),
);

export const channelRulesRelations = relations(channelRules, ({ one }) => ({
  socialAccount: one(socialAccounts, {
    fields: [channelRules.socialAccountId],
    references: [socialAccounts.id],
  }),
}));

export const assetsRelations = relations(assets, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [assets.workspaceId],
    references: [workspaces.id],
  }),
  brand: one(brands, {
    fields: [assets.brandId],
    references: [brands.id],
  }),
  tags: many(assetTags),
  collectionItems: many(assetCollectionItems),
}));

export const assetCollectionsRelations = relations(
  assetCollections,
  ({ one, many }) => ({
    workspace: one(workspaces, {
      fields: [assetCollections.workspaceId],
      references: [workspaces.id],
    }),
    items: many(assetCollectionItems),
  }),
);

export const assetCollectionItemsRelations = relations(
  assetCollectionItems,
  ({ one }) => ({
    collection: one(assetCollections, {
      fields: [assetCollectionItems.collectionId],
      references: [assetCollections.id],
    }),
    asset: one(assets, {
      fields: [assetCollectionItems.assetId],
      references: [assets.id],
    }),
  }),
);

export const assetTagsRelations = relations(assetTags, ({ one }) => ({
  asset: one(assets, {
    fields: [assetTags.assetId],
    references: [assets.id],
  }),
}));

export const tagsRelations = relations(tags, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [tags.workspaceId],
    references: [workspaces.id],
  }),
  contentTags: many(contentTags),
}));

export const campaignsRelations = relations(campaigns, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [campaigns.workspaceId],
    references: [workspaces.id],
  }),
  brand: one(brands, {
    fields: [campaigns.brandId],
    references: [brands.id],
  }),
  channels: many(campaignChannels),
  pillars: many(campaignPillars),
  contentItems: many(contentItems),
}));

export const campaignChannelsRelations = relations(
  campaignChannels,
  ({ one }) => ({
    campaign: one(campaigns, {
      fields: [campaignChannels.campaignId],
      references: [campaigns.id],
    }),
  }),
);

export const campaignPillarsRelations = relations(
  campaignPillars,
  ({ one }) => ({
    campaign: one(campaigns, {
      fields: [campaignPillars.campaignId],
      references: [campaigns.id],
    }),
  }),
);

export const contentItemsRelations = relations(
  contentItems,
  ({ one, many }) => ({
    workspace: one(workspaces, {
      fields: [contentItems.workspaceId],
      references: [workspaces.id],
    }),
    brand: one(brands, {
      fields: [contentItems.brandId],
      references: [brands.id],
    }),
    campaign: one(campaigns, {
      fields: [contentItems.campaignId],
      references: [campaigns.id],
    }),
    author: one(users, {
      fields: [contentItems.authorId],
      references: [users.id],
    }),
    tags: many(contentTags),
    variants: many(contentVariants),
    assets: many(contentAssets),
    approvalRequests: many(approvalRequests),
    scheduledPublications: many(scheduledPublications),
  }),
);

export const contentTagsRelations = relations(contentTags, ({ one }) => ({
  contentItem: one(contentItems, {
    fields: [contentTags.contentItemId],
    references: [contentItems.id],
  }),
  tag: one(tags, {
    fields: [contentTags.tagId],
    references: [tags.id],
  }),
}));

export const contentVariantsRelations = relations(
  contentVariants,
  ({ one, many }) => ({
    contentItem: one(contentItems, {
      fields: [contentVariants.contentItemId],
      references: [contentItems.id],
    }),
    socialAccount: one(socialAccounts, {
      fields: [contentVariants.socialAccountId],
      references: [socialAccounts.id],
    }),
    versions: many(contentVersions),
    assets: many(contentAssets),
    scheduledPublications: many(scheduledPublications),
  }),
);

export const contentVersionsRelations = relations(
  contentVersions,
  ({ one }) => ({
    variant: one(contentVariants, {
      fields: [contentVersions.variantId],
      references: [contentVariants.id],
    }),
    author: one(users, {
      fields: [contentVersions.authorId],
      references: [users.id],
    }),
  }),
);

export const contentAssetsRelations = relations(contentAssets, ({ one }) => ({
  contentItem: one(contentItems, {
    fields: [contentAssets.contentItemId],
    references: [contentItems.id],
  }),
  variant: one(contentVariants, {
    fields: [contentAssets.variantId],
    references: [contentVariants.id],
  }),
  asset: one(assets, {
    fields: [contentAssets.assetId],
    references: [assets.id],
  }),
}));

export const approvalRequestsRelations = relations(
  approvalRequests,
  ({ one }) => ({
    contentItem: one(contentItems, {
      fields: [approvalRequests.contentItemId],
      references: [contentItems.id],
    }),
    requester: one(users, {
      fields: [approvalRequests.requesterId],
      references: [users.id],
    }),
  }),
);

export const scheduledPublicationsRelations = relations(
  scheduledPublications,
  ({ one, many }) => ({
    contentItem: one(contentItems, {
      fields: [scheduledPublications.contentItemId],
      references: [contentItems.id],
    }),
    variant: one(contentVariants, {
      fields: [scheduledPublications.variantId],
      references: [contentVariants.id],
    }),
    workspace: one(workspaces, {
      fields: [scheduledPublications.workspaceId],
      references: [workspaces.id],
    }),
    socialAccount: one(socialAccounts, {
      fields: [scheduledPublications.socialAccountId],
      references: [socialAccounts.id],
    }),
    jobs: many(publicationJobs),
  }),
);

export const publicationJobsRelations = relations(
  publicationJobs,
  ({ one, many }) => ({
    scheduledPublication: one(scheduledPublications, {
      fields: [publicationJobs.scheduledPublicationId],
      references: [scheduledPublications.id],
    }),
    results: many(publicationResults),
  }),
);

export const publicationResultsRelations = relations(
  publicationResults,
  ({ one }) => ({
    job: one(publicationJobs, {
      fields: [publicationResults.publicationJobId],
      references: [publicationJobs.id],
    }),
  }),
);

export const automationsRelations = relations(automations, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [automations.workspaceId],
    references: [workspaces.id],
  }),
  versions: many(automationVersions),
  runs: many(automationRuns),
  triggers: many(automationTriggers),
  triggerEvents: many(automationTriggerEvents),
}));

export const automationVersionsRelations = relations(
  automationVersions,
  ({ one, many }) => ({
    automation: one(automations, {
      fields: [automationVersions.automationId],
      references: [automations.id],
    }),
    runs: many(automationRuns),
  }),
);

export const automationRunsRelations = relations(
  automationRuns,
  ({ one, many }) => ({
    automation: one(automations, {
      fields: [automationRuns.automationId],
      references: [automations.id],
    }),
    version: one(automationVersions, {
      fields: [automationRuns.versionId],
      references: [automationVersions.id],
    }),
    steps: many(automationRunSteps),
  }),
);

export const automationRunStepsRelations = relations(
  automationRunSteps,
  ({ one }) => ({
    run: one(automationRuns, {
      fields: [automationRunSteps.runId],
      references: [automationRuns.id],
    }),
  }),
);

export const automationTriggersRelations = relations(
  automationTriggers,
  ({ one, many }) => ({
    automation: one(automations, {
      fields: [automationTriggers.automationId],
      references: [automations.id],
    }),
    events: many(automationTriggerEvents),
  }),
);

export const automationTriggerEventsRelations = relations(
  automationTriggerEvents,
  ({ one }) => ({
    trigger: one(automationTriggers, {
      fields: [automationTriggerEvents.triggerId],
      references: [automationTriggers.id],
    }),
    automation: one(automations, {
      fields: [automationTriggerEvents.automationId],
      references: [automations.id],
    }),
    run: one(automationRuns, {
      fields: [automationTriggerEvents.runId],
      references: [automationRuns.id],
    }),
  }),
);

export const metricSnapshotsRelations = relations(
  metricSnapshots,
  ({ one }) => ({
    contentItem: one(contentItems, {
      fields: [metricSnapshots.contentItemId],
      references: [contentItems.id],
    }),
    socialAccount: one(socialAccounts, {
      fields: [metricSnapshots.socialAccountId],
      references: [socialAccounts.id],
    }),
  }),
);

export const analyticsDailyRelations = relations(analyticsDaily, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [analyticsDaily.workspaceId],
    references: [workspaces.id],
  }),
  socialAccount: one(socialAccounts, {
    fields: [analyticsDaily.socialAccountId],
    references: [socialAccounts.id],
  }),
}));

export const aiInsightsRelations = relations(aiInsights, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [aiInsights.workspaceId],
    references: [workspaces.id],
  }),
  brand: one(brands, {
    fields: [aiInsights.brandId],
    references: [brands.id],
  }),
}));

export const integrationsRelations = relations(integrations, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [integrations.workspaceId],
    references: [workspaces.id],
  }),
}));

export const webhookEndpointsRelations = relations(
  webhookEndpoints,
  ({ one, many }) => ({
    workspace: one(workspaces, {
      fields: [webhookEndpoints.workspaceId],
      references: [workspaces.id],
    }),
    deliveries: many(webhookDeliveries),
  }),
);

export const webhookDeliveriesRelations = relations(
  webhookDeliveries,
  ({ one }) => ({
    endpoint: one(webhookEndpoints, {
      fields: [webhookDeliveries.endpointId],
      references: [webhookEndpoints.id],
    }),
  }),
);
