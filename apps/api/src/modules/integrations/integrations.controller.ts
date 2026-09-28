import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  Query,
  ParseIntPipe,
} from '@nestjs/common';
import { IntegrationsService } from './integrations.service.js';

@Controller('integrations')
export class IntegrationsController {
  constructor(private readonly integrationsService: IntegrationsService) {}

  @Get()
  async findAll(@Query('workspaceId', ParseIntPipe) workspaceId: number) {
    return this.integrationsService.findAll(workspaceId);
  }

  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    return this.integrationsService.findOne(id);
  }

  @Post()
  async create(
    @Query('workspaceId', ParseIntPipe) workspaceId: number,
    @Body() data: { type: string; config: any },
  ) {
    return this.integrationsService.create(workspaceId, data);
  }

  @Put(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() data: { config?: any; status?: string },
  ) {
    return this.integrationsService.update(id, data);
  }

  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number) {
    return this.integrationsService.remove(id);
  }

  @Post(':id/sync')
  async syncIntegration(@Param('id', ParseIntPipe) id: number) {
    return this.integrationsService.syncIntegration(id);
  }
}
