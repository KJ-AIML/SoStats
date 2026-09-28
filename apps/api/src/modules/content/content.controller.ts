import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Patch,
  Headers,
} from '@nestjs/common';
import { ContentService } from './content.service.js';
import {
  CreateContentDto,
  UpdateContentStatusDto,
  RepurposeContentDto,
} from './content.dto.js';

@Controller('v1/content')
export class ContentController {
  constructor(private readonly contentService: ContentService) {}

  // Dummy extract workspace ID from headers for now
  private getWorkspaceId(headers: Record<string, string | undefined>): number {
    return headers['x-workspace-id']
      ? parseInt(headers['x-workspace-id'] as string, 10)
      : 1;
  }

  @Post()
  create(
    @Body() data: CreateContentDto,
    @Headers() headers: Record<string, string | undefined>,
  ) {
    const workspaceId = this.getWorkspaceId(headers);
    return this.contentService.create({
      ...data,
      workspaceId,
    });
  }

  @Get()
  findAll(@Headers() headers: Record<string, string | undefined>) {
    const workspaceId = this.getWorkspaceId(headers);
    return this.contentService.findAllForWorkspace(workspaceId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.contentService.findOne(+id);
  }

  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body() data: UpdateContentStatusDto) {
    return this.contentService.updateStatus(+id, data);
  }

  @Post(':id/repurpose')
  repurpose(@Param('id') id: string, @Body() data: RepurposeContentDto) {
    return this.contentService.repurpose(+id, data);
  }
}
