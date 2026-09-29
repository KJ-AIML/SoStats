import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
} from '@nestjs/common';
import {
  CurrentWorkspaceId,
  WorkspaceScoped,
} from '../../common/workspace/workspace.decorator.js';
import { IntegrationsService } from './integrations.service.js';

@WorkspaceScoped()
@Controller('integrations')
export class IntegrationsController {
  constructor(private readonly integrationsService: IntegrationsService) {}

  @Get('overview')
  overview(@CurrentWorkspaceId() workspaceId: number) {
    return this.integrationsService.overview(workspaceId);
  }

  @Get()
  findAll(@CurrentWorkspaceId() workspaceId: number) {
    return this.integrationsService.findAll(workspaceId);
  }

  @Get(':id')
  findOne(
    @Param('id', ParseIntPipe) id: number,
    @CurrentWorkspaceId() workspaceId: number,
  ) {
    return this.integrationsService.findOne(workspaceId, id);
  }

  @Post()
  create(
    @CurrentWorkspaceId() workspaceId: number,
    @Body() data: { type: string; config: Record<string, unknown> },
  ) {
    return this.integrationsService.create(workspaceId, data);
  }

  @Put(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @CurrentWorkspaceId() workspaceId: number,
    @Body() data: { config?: Record<string, unknown>; status?: string },
  ) {
    return this.integrationsService.update(workspaceId, id, data);
  }

  @Delete(':id')
  remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentWorkspaceId() workspaceId: number,
  ) {
    return this.integrationsService.remove(workspaceId, id);
  }

  @Post(':id/sync')
  syncIntegration(
    @Param('id', ParseIntPipe) id: number,
    @CurrentWorkspaceId() workspaceId: number,
  ) {
    return this.integrationsService.syncIntegration(workspaceId, id);
  }
}
