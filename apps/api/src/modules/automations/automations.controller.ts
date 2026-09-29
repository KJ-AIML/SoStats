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
  ) {}

  @Get()
  findAll(@CurrentWorkspaceId() workspaceId: number) {
    return this.automationsService.findAll(workspaceId);
  }

  @Post()
  create(
    @Body() body: CreateAutomationDto,
    @CurrentWorkspaceId() workspaceId: number,
  ) {
    return this.automationsService.create(workspaceId, body);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: UpdateAutomationDto,
    @CurrentWorkspaceId() workspaceId: number,
  ) {
    return this.automationsService.update(workspaceId, id, body);
  }

  @Post(':id/versions')
  createVersion(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: CreateAutomationVersionDto,
    @CurrentWorkspaceId() workspaceId: number,
  ) {
    return this.automationsService.createVersion(workspaceId, id, body);
  }

  @Post(':id/publish')
  publish(
    @Param('id', ParseIntPipe) id: number,
    @CurrentWorkspaceId() workspaceId: number,
  ) {
    return this.automationsService.publish(workspaceId, id);
  }

  @Post(':id/pause')
  pause(
    @Param('id', ParseIntPipe) id: number,
    @CurrentWorkspaceId() workspaceId: number,
  ) {
    return this.automationsService.pause(workspaceId, id);
  }

  @Post(':id/trigger/rotate-secret')
  rotateTriggerSecret(
    @Param('id', ParseIntPipe) id: number,
    @CurrentWorkspaceId() workspaceId: number,
  ) {
    return this.triggers.rotateWebhookSecret(workspaceId, id);
  }

  @Post(':id/trigger/retry')
  retryTrigger(
    @Param('id', ParseIntPipe) id: number,
    @CurrentWorkspaceId() workspaceId: number,
  ) {
    return this.triggers.retry(workspaceId, id);
  }

  @Post(':id/run')
  run(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: RunAutomationDto,
    @CurrentWorkspaceId() workspaceId: number,
  ) {
    return this.automationsService.run(workspaceId, id, body);
  }

  @Get(':id/runs')
  runs(
    @Param('id', ParseIntPipe) id: number,
    @CurrentWorkspaceId() workspaceId: number,
  ) {
    return this.automationsService.findRuns(workspaceId, id);
  }

  @Post('runs/:runId/retry')
  retry(
    @Param('runId', ParseIntPipe) runId: number,
    @CurrentWorkspaceId() workspaceId: number,
  ) {
    return this.runtime.retry(workspaceId, runId);
  }

  @Post('runs/:runId/steps/:stepId/decision')
  decision(
    @Param('runId', ParseIntPipe) runId: number,
    @Param('stepId') stepId: string,
    @Body() body: AutomationDecisionDto,
    @CurrentWorkspaceId() workspaceId: number,
  ) {
    return this.runtime.decide(workspaceId, runId, stepId, body);
  }
}
