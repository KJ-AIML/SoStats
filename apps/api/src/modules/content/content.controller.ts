import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import {
  CurrentWorkspaceId,
  WorkspaceScoped,
} from '../../common/workspace/workspace.decorator.js';
import { ContentService } from './content.service.js';
import {
  CreateContentDto,
  RepurposeContentDto,
  UpdateContentDto,
  UpdateContentStatusDto,
  UpdateContentVariantDto,
} from './content.dto.js';

@WorkspaceScoped()
@Controller('v1/content')
export class ContentController {
  constructor(private readonly contentService: ContentService) {}

  @Post()
  create(
    @Body() data: CreateContentDto,
    @CurrentWorkspaceId() workspaceId: number,
  ) {
    return this.contentService.create({ ...data, workspaceId });
  }

  @Get()
  findAll(@CurrentWorkspaceId() workspaceId: number) {
    return this.contentService.findAllForWorkspace(workspaceId);
  }

  @Get(':id')
  findOne(
    @Param('id') id: string,
    @CurrentWorkspaceId() workspaceId: number,
  ) {
    return this.contentService.findOne(workspaceId, +id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() data: UpdateContentDto,
    @CurrentWorkspaceId() workspaceId: number,
  ) {
    return this.contentService.update(workspaceId, +id, data);
  }

  @Patch(':id/status')
  updateStatus(
    @Param('id') id: string,
    @Body() data: UpdateContentStatusDto,
    @CurrentWorkspaceId() workspaceId: number,
  ) {
    return this.contentService.updateStatus(workspaceId, +id, data);
  }

  @Patch(':id/variants/:variantId')
  updateVariant(
    @Param('id') id: string,
    @Param('variantId') variantId: string,
    @Body() data: UpdateContentVariantDto,
    @CurrentWorkspaceId() workspaceId: number,
  ) {
    return this.contentService.updateVariant(
      workspaceId,
      +id,
      +variantId,
      data,
    );
  }

  @Post(':id/repurpose')
  repurpose(
    @Param('id') id: string,
    @Body() data: RepurposeContentDto,
    @CurrentWorkspaceId() workspaceId: number,
  ) {
    return this.contentService.repurpose(workspaceId, +id, data);
  }
}
