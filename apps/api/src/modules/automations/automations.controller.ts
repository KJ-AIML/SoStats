import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import {
  CurrentWorkspaceId,
  WorkspaceScoped,
} from '../../common/workspace/workspace.decorator.js';
import { AutomationsService } from './automations.service.js';
import { CreateAutomationDto } from './automations.dto.js';

@WorkspaceScoped()
@Controller('v1/automations')
export class AutomationsController {
  constructor(private readonly automationsService: AutomationsService) {}

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

  @Post(':id/run')
  run(
    @Param('id', ParseIntPipe) id: number,
    @CurrentWorkspaceId() workspaceId: number,
  ) {
    return this.automationsService.run(workspaceId, id);
  }
}
