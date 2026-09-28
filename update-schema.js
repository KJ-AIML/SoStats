const fs = require('fs');
let content = fs.readFileSync('apps/api/src/db/schema.ts', 'utf8');

const newTables = `
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
`;

const newRelations = `
export const integrationsRelations = relations(integrations, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [integrations.workspaceId],
    references: [workspaces.id],
  }),
}));

export const webhookEndpointsRelations = relations(webhookEndpoints, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [webhookEndpoints.workspaceId],
    references: [workspaces.id],
  }),
  deliveries: many(webhookDeliveries),
}));

export const webhookDeliveriesRelations = relations(webhookDeliveries, ({ one }) => ({
  endpoint: one(webhookEndpoints, {
    fields: [webhookDeliveries.endpointId],
    references: [webhookEndpoints.id],
  }),
}));
`;

content = content.replace('// Relations\n', newTables);
content += newRelations;

// also update boolean import from 'drizzle-orm/pg-core'
if (!content.includes('boolean')) {
    content = content.replace(/uniqueIndex,\n  jsonb,/g, 'uniqueIndex,\n  jsonb,\n  boolean,');
}

// add integrations and webhookEndpoints to workspacesRelations
content = content.replace(
  'automations: many(automations),\n}));',
  'automations: many(automations),\n  integrations: many(integrations),\n  webhookEndpoints: many(webhookEndpoints),\n}));'
);

fs.writeFileSync('apps/api/src/db/schema.ts', content);
