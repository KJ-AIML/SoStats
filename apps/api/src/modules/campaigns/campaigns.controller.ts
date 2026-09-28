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
import { CampaignsService } from './campaigns.service.js';
import { CreateCampaignDto, GenerateCampaignDto } from './campaigns.dto.js';

@WorkspaceScoped()
@Controller('v1/campaigns')
export class CampaignsController {
  constructor(private readonly campaignsService: CampaignsService) {}

  @Get()
  findAll(@CurrentWorkspaceId() workspaceId: number) {
    return this.campaignsService.findAll(workspaceId);
  }

  @Post()
  create(
    @Body() body: CreateCampaignDto,
    @CurrentWorkspaceId() workspaceId: number,
  ) {
    return this.campaignsService.create(workspaceId, body);
  }

  @Get(':id')
  findOne(
    @Param('id', ParseIntPipe) id: number,
    @CurrentWorkspaceId() workspaceId: number,
  ) {
    return this.campaignsService.findOne(workspaceId, id);
  }

  @Post(':id/generate')
  generate(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: GenerateCampaignDto,
    @CurrentWorkspaceId() workspaceId: number,
  ) {
    return this.campaignsService.generate(workspaceId, id, body);
  }
}
