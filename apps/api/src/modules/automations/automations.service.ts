import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { DRIZZLE } from '../../db/db.module.js';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema.js';
import { CreateAutomationDto } from './automations.dto.js';
import { WORKFLOW_ENGINE_PORT } from './ports/workflow-engine.port.js';
import type { WorkflowEnginePort } from './ports/workflow-engine.port.js';
import { eq } from 'drizzle-orm';

@Injectable()
export class AutomationsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    @Inject(WORKFLOW_ENGINE_PORT)
    private readonly workflowEngine: WorkflowEnginePort,
  ) {}

  async create(dto: CreateAutomationDto) {
    const [automation] = await this.db
      .insert(schema.automations)
      .values({
        workspaceId: dto.workspaceId,
        name: dto.name,
        description: dto.description,
        triggerType: dto.triggerType,
        status: 'draft',
      })
      .returning();

    const [version] = await this.db
      .insert(schema.automationVersions)
      .values({
        automationId: automation.id,
        versionNumber: 1,
        workflowDefinition: dto.workflowDefinition,
      })
      .returning();

    return { ...automation, versions: [version] };
  }

  async findAll() {
    const all = await this.db.select().from(schema.automations);
    return all;
  }

  async run(id: number) {
    const [automation] = await this.db
      .select()
      .from(schema.automations)
      .where(eq(schema.automations.id, id));

    if (!automation) {
      throw new NotFoundException(`Automation with id ${id} not found`);
    }

    const versions = await this.db
      .select()
      .from(schema.automationVersions)
      .where(eq(schema.automationVersions.automationId, id))
      .orderBy(schema.automationVersions.versionNumber);

    if (versions.length === 0) {
      throw new NotFoundException(`No versions found for automation ${id}`);
    }

    // Get the latest version
    const latestVersion = versions[versions.length - 1];

    const runId = await this.workflowEngine.runWorkflow(
      id,
      latestVersion.id,
      latestVersion.workflowDefinition,
    );

    const [run] = await this.db
      .insert(schema.automationRuns)
      .values({
        automationId: id,
        versionId: latestVersion.id,
        status: 'pending',
      })
      .returning();

    // Log the run starting
    await this.db.insert(schema.automationRunSteps).values({
      runId: run.id,
      stepId: 'init',
      status: 'pending',
    });

    return {
      success: true,
      automationId: id,
      versionId: latestVersion.id,
      runId: run.id,
      externalRunId: runId,
    };
  }
}
