import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  CurrentWorkspaceId,
  WorkspaceScoped,
} from '../../common/workspace/workspace.decorator.js';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../../common/auth/auth.types.js';
import {
  AuditLogService,
  actorFromUser,
} from '../../common/audit/audit-log.service.js';
import { AutomationsService } from './automations.service.js';
import { AutomationRuntimeService } from './automation-runtime.service.js';
import { AutomationTriggersService } from './automation-triggers.service.js';
import {
  AutomationDecisionDto,
  CreateAutomationDto,
  CreateAutomationVersionDto,
  RunAutomationDto,
  UpdateAutomationDto,
} from './automations.dto.js';

@WorkspaceScoped()
@Controller('v1/automations')
export class AutomationsController {
  constructor(
    private readonly automationsService: AutomationsService,
    private readonly runtime: AutomationRuntimeService,
    private readonly triggers: AutomationTriggersService,
    private readonly audit: AuditLogService,
  ) {}

  @Get()
  findAll(@CurrentWorkspaceId() workspaceId: number) {
    return this.automationsService.findAll(workspaceId);
  }

  @Post()
  async create(
    @Body() body: CreateAutomationDto,
    @CurrentWorkspaceId() workspaceId: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const result = await this.automationsService.create(workspaceId, body);
    await this.audit.record({
      workspaceId,
      actor: actorFromUser(user),
      action: 'automation.created',
      targetType: 'automation',
      targetId: result.id,
      metadata: {
        name: result.name,
        triggerType: result.triggerType,
      },
    });
    return result;
  }

  @Patch(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateAutomationDto,
    @CurrentWorkspaceId() workspaceId: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const result = await this.automationsService.update(workspaceId, id, body);
    await this.audit.record({
      workspaceId,
      actor: actorFromUser(user),
      action: 'automation.updated',
      targetType: 'automation',
      targetId: id,
      metadata: {
        changedFields: Object.keys(body),
      },
    });
    return result;
  }

  @Post(':id/versions')
  async createVersion(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: CreateAutomationVersionDto,
    @CurrentWorkspaceId() workspaceId: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const result = await this.automationsService.createVersion(
      workspaceId,
      id,
      body,
    );
    await this.audit.record({
      workspaceId,
      actor: actorFromUser(user),
      action: 'automation.version_created',
      targetType: 'automation',
      targetId: id,
      metadata: {
        versionId: result.id,
        versionNumber: result.versionNumber,
      },
    });
    return result;
  }

  @Post(':id/publish')
  async publish(
    @Param('id', ParseIntPipe) id: number,
    @CurrentWorkspaceId() workspaceId: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const result = await this.automationsService.publish(workspaceId, id);
    await this.audit.record({
      workspaceId,
      actor: actorFromUser(user),
      action: 'automation.published',
      targetType: 'automation',
      targetId: id,
      metadata: {
        status: result.status,
      },
    });
    return result;
  }

  @Post(':id/pause')
  async pause(
    @Param('id', ParseIntPipe) id: number,
    @CurrentWorkspaceId() workspaceId: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const result = await this.automationsService.pause(workspaceId, id);
    await this.audit.record({
      workspaceId,
      actor: actorFromUser(user),
      action: 'automation.paused',
      targetType: 'automation',
      targetId: id,
      metadata: {
        status: result.status,
      },
    });
    return result;
  }

  @Post(':id/trigger/rotate-secret')
  async rotateTriggerSecret(
    @Param('id', ParseIntPipe) id: number,
    @CurrentWorkspaceId() workspaceId: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const result = await this.triggers.rotateWebhookSecret(workspaceId, id);
    await this.audit.record({
      workspaceId,
      actor: actorFromUser(user),
      action: 'automation.trigger_secret_rotated',
      targetType: 'automation',
      targetId: id,
      metadata: {},
    });
    return result;
  }

  @Post(':id/trigger/retry')
  async retryTrigger(
    @Param('id', ParseIntPipe) id: number,
    @CurrentWorkspaceId() workspaceId: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const result = await this.triggers.retry(workspaceId, id);
    await this.audit.record({
      workspaceId,
      actor: actorFromUser(user),
      action: 'automation.trigger_retried',
      targetType: 'automation',
      targetId: id,
      metadata: {},
    });
    return result;
  }

  @Post(':id/run')
  async run(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: RunAutomationDto,
    @CurrentWorkspaceId() workspaceId: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const result = await this.automationsService.run(workspaceId, id, body);
    await this.audit.record({
      workspaceId,
      actor: actorFromUser(user),
      action: 'automation.run_started',
      targetType: 'automation',
      targetId: id,
      metadata: {
        runId: result.id,
        hasTriggerPayload: Boolean(body.triggerPayload),
      },
    });
    return result;
  }

  @Get(':id/runs')
  runs(
    @Param('id', ParseIntPipe) id: number,
    @CurrentWorkspaceId() workspaceId: number,
  ) {
    return this.automationsService.findRuns(workspaceId, id);
  }

  @Post('runs/:runId/retry')
  async retry(
    @Param('runId', ParseIntPipe) runId: number,
    @CurrentWorkspaceId() workspaceId: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const result = await this.runtime.retry(workspaceId, runId);
    await this.audit.record({
      workspaceId,
      actor: actorFromUser(user),
      action: 'automation.run_retried',
      targetType: 'automation_run',
      targetId: runId,
      metadata: {},
    });
    return result;
  }

  @Post('runs/:runId/steps/:stepId/decision')
  async decision(
    @Param('runId', ParseIntPipe) runId: number,
    @Param('stepId') stepId: string,
    @Body() body: AutomationDecisionDto,
    @CurrentWorkspaceId() workspaceId: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const result = await this.runtime.decide(
      workspaceId,
      runId,
      stepId,
      body,
    );
    await this.audit.record({
      workspaceId,
      actor: actorFromUser(user),
      action: 'automation.review_decision',
      targetType: 'automation_run',
      targetId: runId,
      metadata: {
        stepId,
        decision: body.decision,
        hasNotes: Boolean(body.notes),
      },
    });
    return result;
  }
}
