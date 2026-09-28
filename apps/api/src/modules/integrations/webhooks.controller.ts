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
import { WebhooksService } from './webhooks.service.js';

@WorkspaceScoped()
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Get()
  findAll(@CurrentWorkspaceId() workspaceId: number) {
    return this.webhooksService.findAll(workspaceId);
  }

  @Get(':id')
  findOne(
    @Param('id', ParseIntPipe) id: number,
    @CurrentWorkspaceId() workspaceId: number,
  ) {
    return this.webhooksService.findOne(workspaceId, id);
  }

  @Post()
  create(
    @CurrentWorkspaceId() workspaceId: number,
    @Body() data: { url: string; events: string[] },
  ) {
    return this.webhooksService.create(workspaceId, data);
  }

  @Put(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @CurrentWorkspaceId() workspaceId: number,
    @Body() data: { url?: string; events?: string[]; active?: boolean },
  ) {
    return this.webhooksService.update(workspaceId, id, data);
  }

  @Delete(':id')
  remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentWorkspaceId() workspaceId: number,
  ) {
    return this.webhooksService.remove(workspaceId, id);
  }
}
