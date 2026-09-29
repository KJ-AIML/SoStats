-- Test fixture: SoStats schema at b5b9194 (pre-migration 007).
-- Generated from git show b5b9194:apps/api/src/db/schema.ts with:
--   pnpm exec drizzle-kit export --dialect=postgresql --schema=<that file> --sql
-- NOT a production baseline; canonical from-zero bootstrap is ST15-36.1.
-- Pinned to b5b9194 forever: NEVER regenerate from the current schema.ts, or the
-- migration tests stop exercising the real pre-007 -> 007 upgrade path.

CREATE TABLE "ai_insights" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"brand_id" integer,
	"generation_id" varchar(64) NOT NULL,
	"summary" text,
	"finding" text NOT NULL,
	"evidence" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"evidence_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"recommendation" text NOT NULL,
	"impact_estimate" text,
	"confidence" varchar(20) DEFAULT 'medium' NOT NULL,
	"action_type" varchar(50) DEFAULT 'none' NOT NULL,
	"action_payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" varchar(30) DEFAULT 'pending' NOT NULL,
	"result" jsonb,
	"error" text,
	"executed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "analytics_daily" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"social_account_id" integer,
	"date" timestamp NOT NULL,
	"metrics" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "approval_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"content_item_id" integer NOT NULL,
	"requester_id" integer,
	"status" varchar(50) DEFAULT 'pending' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "asset_collection_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"collection_id" integer NOT NULL,
	"asset_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "asset_collections" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "asset_tags" (
	"id" serial PRIMARY KEY NOT NULL,
	"asset_id" integer NOT NULL,
	"tag" varchar(100) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "assets" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"brand_id" integer,
	"file_name" varchar(255) NOT NULL,
	"file_type" varchar(50) NOT NULL,
	"mime_type" varchar(100) NOT NULL,
	"size" integer NOT NULL,
	"storage_key" varchar(255) NOT NULL,
	"public_url" varchar(1024),
	"status" varchar(30) DEFAULT 'ready' NOT NULL,
	"width" integer,
	"height" integer,
	"duration_ms" integer,
	"processing_token" varchar(64),
	"processing_error" text,
	"upload_completed_at" timestamp,
	"processed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "auth_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"auth_method" varchar(40) NOT NULL,
	"user_agent" varchar(512),
	"expires_at" timestamp,
	"last_seen_at" timestamp DEFAULT now() NOT NULL,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "auth_sessions_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "auth_session_method_check" CHECK ("auth_sessions"."auth_method" in ('jwt', 'development'))
);

CREATE TABLE "automation_run_steps" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"step_id" varchar(255) NOT NULL,
	"status" varchar(50) DEFAULT 'pending' NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	"logs" text,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "automation_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"automation_id" integer NOT NULL,
	"version_id" integer NOT NULL,
	"status" varchar(50) DEFAULT 'pending' NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "automation_trigger_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"trigger_id" integer NOT NULL,
	"automation_id" integer NOT NULL,
	"event_key" varchar(64) NOT NULL,
	"external_id" varchar(1024) NOT NULL,
	"payload" jsonb NOT NULL,
	"run_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "automation_triggers" (
	"id" serial PRIMARY KEY NOT NULL,
	"automation_id" integer NOT NULL,
	"type" varchar(50) NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" varchar(30) DEFAULT 'active' NOT NULL,
	"public_id" varchar(64),
	"secret" varchar(512),
	"lease_token" varchar(64),
	"lease_expires_at" timestamp,
	"next_poll_at" timestamp,
	"last_polled_at" timestamp,
	"last_triggered_at" timestamp,
	"last_received_at" timestamp,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "automation_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"automation_id" integer NOT NULL,
	"version_number" integer NOT NULL,
	"workflow_definition" jsonb NOT NULL,
	"published_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "automations" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"trigger_type" varchar(50) NOT NULL,
	"status" varchar(50) DEFAULT 'draft' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "brand_audiences" (
	"id" serial PRIMARY KEY NOT NULL,
	"brand_id" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"demographics" text,
	"pain_points" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "brand_products" (
	"id" serial PRIMARY KEY NOT NULL,
	"brand_id" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"features" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "brand_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"brand_id" integer NOT NULL,
	"rule_type" varchar(50) NOT NULL,
	"description" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "brand_voice_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"brand_id" integer NOT NULL,
	"tone" varchar(255) NOT NULL,
	"style" text,
	"guidelines" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "brands" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"website_url" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "campaign_channels" (
	"id" serial PRIMARY KEY NOT NULL,
	"campaign_id" integer NOT NULL,
	"platform" varchar(50) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "campaign_pillars" (
	"id" serial PRIMARY KEY NOT NULL,
	"campaign_id" integer NOT NULL,
	"pillar" varchar(255) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "campaigns" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"brand_id" integer,
	"name" varchar(255) NOT NULL,
	"description" text,
	"goal" varchar(255),
	"status" varchar(50) DEFAULT 'draft' NOT NULL,
	"generation_context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"start_date" timestamp,
	"end_date" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "channel_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"social_account_id" integer NOT NULL,
	"rule_type" varchar(50) NOT NULL,
	"description" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "content_assets" (
	"id" serial PRIMARY KEY NOT NULL,
	"content_item_id" integer,
	"variant_id" integer,
	"asset_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "content_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"brand_id" integer,
	"title" varchar(255) NOT NULL,
	"description" text,
	"status" varchar(50) DEFAULT 'draft' NOT NULL,
	"campaign_id" integer,
	"author_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "content_pillars" (
	"id" serial PRIMARY KEY NOT NULL,
	"brand_id" integer NOT NULL,
	"name" varchar(255) NOT NULL,
	"description" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "content_tags" (
	"id" serial PRIMARY KEY NOT NULL,
	"content_item_id" integer NOT NULL,
	"tag_id" integer NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "content_variants" (
	"id" serial PRIMARY KEY NOT NULL,
	"content_item_id" integer NOT NULL,
	"social_account_id" integer,
	"platform" varchar(50),
	"content" text NOT NULL,
	"status" varchar(50) DEFAULT 'draft' NOT NULL,
	"scheduled_at" timestamp,
	"published_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "content_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"variant_id" integer NOT NULL,
	"content" text NOT NULL,
	"author_id" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "integrations" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"type" varchar(50) NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" varchar(50) DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "knowledge_chunks" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_id" integer NOT NULL,
	"workspace_id" integer NOT NULL,
	"brand_id" integer NOT NULL,
	"version_number" integer DEFAULT 1 NOT NULL,
	"chunk_index" integer NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "knowledge_sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"brand_id" integer NOT NULL,
	"source_type" varchar(30) NOT NULL,
	"title" varchar(255) NOT NULL,
	"source_url" varchar(2048),
	"source_text" text,
	"mime_type" varchar(150),
	"file_name" varchar(255),
	"file_size" integer,
	"storage_key" varchar(1024),
	"content_hash" varchar(64),
	"status" varchar(30) DEFAULT 'processing' NOT NULL,
	"active_version" integer DEFAULT 1 NOT NULL,
	"processing_version" integer,
	"processing_token" varchar(64),
	"embedding_model" varchar(100),
	"chunk_count" integer DEFAULT 0 NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_error" text,
	"upload_completed_at" timestamp,
	"processed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "metric_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"content_item_id" integer,
	"social_account_id" integer,
	"platform_post_id" varchar(255),
	"metrics" jsonb NOT NULL,
	"snapshot_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "outbox_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer,
	"topic" varchar(120) NOT NULL,
	"dedupe_key" varchar(255) NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" varchar(30) DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp DEFAULT now() NOT NULL,
	"lease_token" varchar(64),
	"lease_expires_at" timestamp,
	"processed_at" timestamp,
	"last_error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "outbox_events_dedupe_key_unique" UNIQUE("dedupe_key"),
	CONSTRAINT "outbox_status_check" CHECK ("outbox_events"."status" in ('pending', 'processing', 'completed', 'dead')),
	CONSTRAINT "outbox_attempts_check" CHECK ("outbox_events"."attempts" >= 0)
);

CREATE TABLE "publication_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"scheduled_publication_id" integer NOT NULL,
	"status" varchar(50) DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_attempt_at" timestamp,
	"next_attempt_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "publication_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"publication_job_id" integer NOT NULL,
	"platform_post_id" varchar(255),
	"platform_post_url" varchar(1024),
	"error_type" varchar(255),
	"error_message" text,
	"raw_response" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "scheduled_publications" (
	"id" serial PRIMARY KEY NOT NULL,
	"content_item_id" integer NOT NULL,
	"variant_id" integer,
	"workspace_id" integer NOT NULL,
	"social_account_id" integer NOT NULL,
	"scheduled_at" timestamp NOT NULL,
	"status" varchar(50) DEFAULT 'scheduled' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "social_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"brand_id" integer NOT NULL,
	"provider" varchar(50) NOT NULL,
	"provider_account_id" varchar(255) NOT NULL,
	"account_name" varchar(255),
	"access_token" text,
	"refresh_token" text,
	"expires_at" timestamp,
	"status" varchar(50) DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "tags" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"name" varchar(100) NOT NULL,
	"color" varchar(50),
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"auth_subject" varchar(255),
	"email" varchar(255) NOT NULL,
	"name" varchar(255),
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_auth_subject_unique" UNIQUE("auth_subject"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);

CREATE TABLE "webhook_deliveries" (
	"id" serial PRIMARY KEY NOT NULL,
	"endpoint_id" integer NOT NULL,
	"event" varchar(255) NOT NULL,
	"payload" jsonb NOT NULL,
	"status_code" integer,
	"success" boolean NOT NULL,
	"duration_ms" integer,
	"request_headers" jsonb,
	"response_headers" jsonb,
	"response_body" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "webhook_endpoints" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"url" varchar(1024) NOT NULL,
	"events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"secret" varchar(255) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "workspace_api_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"created_by_user_id" integer NOT NULL,
	"public_id" varchar(32) NOT NULL,
	"name" varchar(120) NOT NULL,
	"secret_hash" varchar(64) NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"expires_at" timestamp NOT NULL,
	"last_used_at" timestamp,
	"rotated_at" timestamp,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_api_keys_public_id_unique" UNIQUE("public_id"),
	CONSTRAINT "workspace_api_key_name_check" CHECK (length(trim("workspace_api_keys"."name")) between 1 and 120),
	CONSTRAINT "workspace_api_key_scopes_array_check" CHECK (jsonb_typeof("workspace_api_keys"."scopes") = 'array')
);

CREATE TABLE "workspace_audit_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"actor_user_id" integer,
	"actor_email" varchar(255),
	"auth_method" varchar(40) NOT NULL,
	"api_key_id" integer,
	"source_outbox_event_id" integer,
	"action" varchar(120) NOT NULL,
	"target_type" varchar(80) NOT NULL,
	"target_id" varchar(120),
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_audit_auth_method_check" CHECK ("workspace_audit_events"."auth_method" in ('jwt', 'development', 'api_key', 'invitation_token', 'system')),
	CONSTRAINT "workspace_audit_action_check" CHECK (length(trim("workspace_audit_events"."action")) between 1 and 120),
	CONSTRAINT "workspace_audit_target_type_check" CHECK (length(trim("workspace_audit_events"."target_type")) between 1 and 80)
);

CREATE TABLE "workspace_invitations" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"email" varchar(255) NOT NULL,
	"role" varchar(50) DEFAULT 'member' NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"status" varchar(30) DEFAULT 'pending' NOT NULL,
	"invited_by_user_id" integer,
	"accepted_by_user_id" integer,
	"expires_at" timestamp NOT NULL,
	"accepted_at" timestamp,
	"rejected_at" timestamp,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_invitations_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "workspace_invite_role_check" CHECK ("workspace_invitations"."role" in ('admin', 'member')),
	CONSTRAINT "workspace_invite_status_check" CHECK ("workspace_invitations"."status" in ('pending', 'accepted', 'rejected', 'revoked', 'expired'))
);

CREATE TABLE "workspace_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"role" varchar(50) DEFAULT 'member' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_member_role_check" CHECK ("workspace_members"."role" in ('owner', 'admin', 'member'))
);

CREATE TABLE "workspace_notification_preferences" (
	"id" serial PRIMARY KEY NOT NULL,
	"workspace_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"security_events" boolean DEFAULT true NOT NULL,
	"publishing_failures" boolean DEFAULT true NOT NULL,
	"automation_failures" boolean DEFAULT true NOT NULL,
	"weekly_digest" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE TABLE "workspaces" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar(255) NOT NULL,
	"slug" varchar(255) NOT NULL,
	"timezone" varchar(100) DEFAULT 'UTC' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "workspaces_slug_unique" UNIQUE("slug")
);

ALTER TABLE "ai_insights" ADD CONSTRAINT "ai_insights_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "ai_insights" ADD CONSTRAINT "ai_insights_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "analytics_daily" ADD CONSTRAINT "analytics_daily_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "analytics_daily" ADD CONSTRAINT "analytics_daily_social_account_id_social_accounts_id_fk" FOREIGN KEY ("social_account_id") REFERENCES "public"."social_accounts"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "approval_requests" ADD CONSTRAINT "approval_requests_requester_id_users_id_fk" FOREIGN KEY ("requester_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "asset_collection_items" ADD CONSTRAINT "asset_collection_items_collection_id_asset_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."asset_collections"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "asset_collection_items" ADD CONSTRAINT "asset_collection_items_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "asset_collections" ADD CONSTRAINT "asset_collections_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "asset_tags" ADD CONSTRAINT "asset_tags_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "assets" ADD CONSTRAINT "assets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "assets" ADD CONSTRAINT "assets_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "automation_run_steps" ADD CONSTRAINT "automation_run_steps_run_id_automation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."automation_runs"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_automation_id_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."automations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_version_id_automation_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."automation_versions"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "automation_trigger_events" ADD CONSTRAINT "automation_trigger_events_trigger_id_automation_triggers_id_fk" FOREIGN KEY ("trigger_id") REFERENCES "public"."automation_triggers"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "automation_trigger_events" ADD CONSTRAINT "automation_trigger_events_automation_id_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."automations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "automation_trigger_events" ADD CONSTRAINT "automation_trigger_events_run_id_automation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."automation_runs"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "automation_triggers" ADD CONSTRAINT "automation_triggers_automation_id_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."automations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "automation_versions" ADD CONSTRAINT "automation_versions_automation_id_automations_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."automations"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "automations" ADD CONSTRAINT "automations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "brand_audiences" ADD CONSTRAINT "brand_audiences_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "brand_products" ADD CONSTRAINT "brand_products_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "brand_rules" ADD CONSTRAINT "brand_rules_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "brand_voice_profiles" ADD CONSTRAINT "brand_voice_profiles_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "brands" ADD CONSTRAINT "brands_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "campaign_channels" ADD CONSTRAINT "campaign_channels_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "campaign_pillars" ADD CONSTRAINT "campaign_pillars_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "channel_rules" ADD CONSTRAINT "channel_rules_social_account_id_social_accounts_id_fk" FOREIGN KEY ("social_account_id") REFERENCES "public"."social_accounts"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "content_assets" ADD CONSTRAINT "content_assets_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "content_assets" ADD CONSTRAINT "content_assets_variant_id_content_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."content_variants"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "content_assets" ADD CONSTRAINT "content_assets_asset_id_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "content_items" ADD CONSTRAINT "content_items_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "content_pillars" ADD CONSTRAINT "content_pillars_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "content_tags" ADD CONSTRAINT "content_tags_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "content_tags" ADD CONSTRAINT "content_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "content_variants" ADD CONSTRAINT "content_variants_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "content_variants" ADD CONSTRAINT "content_variants_social_account_id_social_accounts_id_fk" FOREIGN KEY ("social_account_id") REFERENCES "public"."social_accounts"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "content_versions" ADD CONSTRAINT "content_versions_variant_id_content_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."content_variants"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "content_versions" ADD CONSTRAINT "content_versions_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_source_id_knowledge_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."knowledge_sources"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "knowledge_sources" ADD CONSTRAINT "knowledge_sources_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "metric_snapshots" ADD CONSTRAINT "metric_snapshots_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "metric_snapshots" ADD CONSTRAINT "metric_snapshots_social_account_id_social_accounts_id_fk" FOREIGN KEY ("social_account_id") REFERENCES "public"."social_accounts"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "publication_jobs" ADD CONSTRAINT "publication_jobs_scheduled_publication_id_scheduled_publications_id_fk" FOREIGN KEY ("scheduled_publication_id") REFERENCES "public"."scheduled_publications"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "publication_results" ADD CONSTRAINT "publication_results_publication_job_id_publication_jobs_id_fk" FOREIGN KEY ("publication_job_id") REFERENCES "public"."publication_jobs"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "scheduled_publications" ADD CONSTRAINT "scheduled_publications_content_item_id_content_items_id_fk" FOREIGN KEY ("content_item_id") REFERENCES "public"."content_items"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "scheduled_publications" ADD CONSTRAINT "scheduled_publications_variant_id_content_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."content_variants"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "scheduled_publications" ADD CONSTRAINT "scheduled_publications_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "scheduled_publications" ADD CONSTRAINT "scheduled_publications_social_account_id_social_accounts_id_fk" FOREIGN KEY ("social_account_id") REFERENCES "public"."social_accounts"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "tags" ADD CONSTRAINT "tags_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpoint_id_webhook_endpoints_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."webhook_endpoints"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "workspace_api_keys" ADD CONSTRAINT "workspace_api_keys_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "workspace_api_keys" ADD CONSTRAINT "workspace_api_keys_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "workspace_invitations" ADD CONSTRAINT "workspace_invitations_accepted_by_user_id_users_id_fk" FOREIGN KEY ("accepted_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "workspace_members" ADD CONSTRAINT "workspace_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "workspace_notification_preferences" ADD CONSTRAINT "workspace_notification_preferences_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "workspace_notification_preferences" ADD CONSTRAINT "workspace_notification_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
CREATE INDEX "ai_insight_workspace_idx" ON "ai_insights" USING btree ("workspace_id","created_at");
CREATE INDEX "ai_insight_status_idx" ON "ai_insights" USING btree ("workspace_id","status");
CREATE INDEX "asset_workspace_status_idx" ON "assets" USING btree ("workspace_id","status","updated_at");
CREATE INDEX "auth_session_user_idx" ON "auth_sessions" USING btree ("user_id","last_seen_at");
CREATE UNIQUE INDEX "automation_trigger_event_unique" ON "automation_trigger_events" USING btree ("trigger_id","event_key");
CREATE INDEX "automation_trigger_event_automation_idx" ON "automation_trigger_events" USING btree ("automation_id","created_at");
CREATE UNIQUE INDEX "automation_trigger_automation_unique" ON "automation_triggers" USING btree ("automation_id");
CREATE UNIQUE INDEX "automation_trigger_public_id_unique" ON "automation_triggers" USING btree ("public_id");
CREATE INDEX "automation_trigger_due_idx" ON "automation_triggers" USING btree ("status","next_poll_at");
CREATE INDEX "brand_workspace_idx" ON "brands" USING btree ("workspace_id");
CREATE INDEX "content_workspace_idx" ON "content_items" USING btree ("workspace_id");
CREATE INDEX "content_brand_idx" ON "content_items" USING btree ("brand_id");
CREATE UNIQUE INDEX "knowledge_chunk_source_version_index_unique" ON "knowledge_chunks" USING btree ("source_id","version_number","chunk_index");
CREATE INDEX "knowledge_chunk_workspace_brand_idx" ON "knowledge_chunks" USING btree ("workspace_id","brand_id","source_id");
CREATE INDEX "knowledge_source_workspace_brand_idx" ON "knowledge_sources" USING btree ("workspace_id","brand_id","status","updated_at");
CREATE INDEX "knowledge_source_hash_idx" ON "knowledge_sources" USING btree ("brand_id","content_hash");
CREATE INDEX "knowledge_source_dispatch_idx" ON "knowledge_sources" USING btree ("status","updated_at");
CREATE INDEX "outbox_dispatch_idx" ON "outbox_events" USING btree ("status","available_at","lease_expires_at");
CREATE INDEX "outbox_workspace_idx" ON "outbox_events" USING btree ("workspace_id","created_at");
CREATE INDEX "scheduled_pub_workspace_idx" ON "scheduled_publications" USING btree ("workspace_id");
CREATE INDEX "scheduled_pub_date_idx" ON "scheduled_publications" USING btree ("scheduled_at");
CREATE INDEX "workspace_api_key_workspace_idx" ON "workspace_api_keys" USING btree ("workspace_id","created_at");
CREATE INDEX "workspace_api_key_active_idx" ON "workspace_api_keys" USING btree ("workspace_id","revoked_at");
CREATE INDEX "workspace_audit_workspace_created_idx" ON "workspace_audit_events" USING btree ("workspace_id","created_at");
CREATE INDEX "workspace_audit_action_idx" ON "workspace_audit_events" USING btree ("workspace_id","action");
CREATE UNIQUE INDEX "workspace_audit_source_outbox_idx" ON "workspace_audit_events" USING btree ("source_outbox_event_id") WHERE "workspace_audit_events"."source_outbox_event_id" is not null;
CREATE INDEX "workspace_invite_email_idx" ON "workspace_invitations" USING btree ("workspace_id","email");
CREATE INDEX "workspace_invite_status_idx" ON "workspace_invitations" USING btree ("workspace_id","status");
CREATE UNIQUE INDEX "workspace_user_idx" ON "workspace_members" USING btree ("workspace_id","user_id");
CREATE UNIQUE INDEX "workspace_single_owner_idx" ON "workspace_members" USING btree ("workspace_id") WHERE "workspace_members"."role" = 'owner';
CREATE UNIQUE INDEX "workspace_notification_user_idx" ON "workspace_notification_preferences" USING btree ("workspace_id","user_id");
