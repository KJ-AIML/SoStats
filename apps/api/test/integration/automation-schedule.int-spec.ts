import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../../src/db/schema.js';
import type { RecommendationsService } from '../../src/modules/analytics/recommendations.service.js';
import { AutomationRuntimeService } from '../../src/modules/automations/automation-runtime.service.js';
import type { CampaignsService } from '../../src/modules/campaigns/campaigns.service.js';
import type { ProviderRegistry } from '../../src/modules/channels/ProviderRegistry.js';
import type { MediaService } from '../../src/modules/media/media.service.js';
import { SchedulingService } from '../../src/modules/scheduling/scheduling.service.js';
import { seedChannel } from './seed.js';
import { createTestDatabase, type TestDatabase } from './test-database.js';

const sp = schema.scheduledPublications;

type ScheduleResult = { scheduleIds: number[]; firstScheduledAt: string };
type Internals = {
  getRun(runId: number): Promise<{
    steps: Array<typeof schema.automationRunSteps.$inferSelect>;
  }>;
  executeSchedule(
    run: unknown,
    node: unknown,
    order: unknown[],
    index: number,
    step: typeof schema.automationRunSteps.$inferSelect,
  ): Promise<ScheduleResult>;
};

describe('automation schedule step under concurrent execution', () => {
  let database: TestDatabase;
  let runtime: AutomationRuntimeService;

  beforeAll(async () => {
    database = await createTestDatabase();
    const scheduling = new SchedulingService(
      database.db,
      {
        describeProvider: () => ({
          supported: true,
          capabilities: { text: true },
        }),
      } as unknown as ProviderRegistry,
      { listReadyContentMedia: async () => [] } as unknown as MediaService,
    );
    runtime = new AutomationRuntimeService(
      database.db,
      {} as CampaignsService,
      scheduling,
      {} as RecommendationsService,
    );
  });
  afterAll(async () => {
    await database.drop();
  });

  it('gives both executions the same startAt, one row and the same schedule id', async () => {
    const seeded = await seedChannel(database.sql);
    const definition = {
      nodes: [
        { id: 'gen', data: { type: 'generate' } },
        {
          id: 'schedule',
          data: {
            type: 'schedule',
            config: { socialAccountId: seeded.socialAccountId },
          },
        },
      ],
      edges: [{ source: 'gen', target: 'schedule' }],
    };
    const [automation] = await database.sql<{ id: number }[]>`
      insert into automations (workspace_id, name, trigger_type) values (${seeded.workspaceId}, 'C', 'manual') returning id`;
    const [version] = await database.sql<{ id: number }[]>`
      insert into automation_versions (automation_id, version_number, workflow_definition)
      values (${automation.id}, 1, ${JSON.stringify(definition)}::jsonb) returning id`;
    const [run] = await database.sql<{ id: number }[]>`
      insert into automation_runs (automation_id, version_id) values (${automation.id}, ${version.id}) returning id`;
    await database.sql`
      insert into automation_run_steps (run_id, step_id, status, logs)
      values (${run.id}, 'gen', 'completed', ${JSON.stringify({ output: { contentItemIds: [seeded.contentItemId] } })})`;
    await database.sql`
      insert into automation_run_steps (run_id, step_id) values (${run.id}, 'schedule')`;

    const internals = runtime as unknown as Internals;
    const execute = async () => {
      const loaded = await internals.getRun(run.id);
      const step = loaded.steps.find(
        (candidate) => candidate.stepId === 'schedule',
      );
      if (!step) throw new Error('step missing');
      return internals.executeSchedule(
        loaded,
        definition.nodes[1],
        definition.nodes,
        1,
        step,
      );
    };
    const results = await Promise.allSettled([execute(), execute()]);

    const rows = await database.db
      .select()
      .from(sp)
      .where(eq(sp.contentItemId, seeded.contentItemId));
    expect(rows).toHaveLength(1);
    for (const result of results) {
      expect(result.status).toBe('fulfilled');
      expect(
        (result as PromiseFulfilledResult<ScheduleResult>).value.scheduleIds,
      ).toEqual([rows[0].id]);
    }

    const [persisted] = await database.sql<{ logs: string }[]>`
      select logs from automation_run_steps where run_id = ${run.id} and step_id = 'schedule'`;
    const startAt = (
      JSON.parse(persisted.logs) as { checkpoint: { startAt: string } }
    ).checkpoint.startAt;
    expect(rows[0].scheduledAt.toISOString()).toBe(startAt);
  });
});
