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
import { WebhooksService } from './webhooks.service.js';

@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Get()
  async findAll(@Query('workspaceId', ParseIntPipe) workspaceId: number) {
    return this.webhooksService.findAll(workspaceId);
  }

  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    return this.webhooksService.findOne(id);
  }

  @Post()
  async create(
    @Query('workspaceId', ParseIntPipe) workspaceId: number,
    @Body() data: { url: string; events: string[] },
  ) {
    return this.webhooksService.create(workspaceId, data);
  }

  @Put(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() data: { url?: string; events?: string[]; active?: boolean },
  ) {
    return this.webhooksService.update(id, data);
  }

  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number) {
    return this.webhooksService.remove(id);
  }
}
