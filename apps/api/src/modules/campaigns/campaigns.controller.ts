import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  ParseIntPipe,
} from '@nestjs/common';
import { CampaignsService } from './campaigns.service.js';
import { CreateCampaignDto, GenerateCampaignDto } from './campaigns.dto.js';

@Controller('v1/campaigns')
export class CampaignsController {
  constructor(private readonly campaignsService: CampaignsService) {}

  @Post()
  async create(@Body() body: CreateCampaignDto) {
    return this.campaignsService.create(body);
  }

  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    return this.campaignsService.findOne(id);
  }

  @Post(':id/generate')
  async generate(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: GenerateCampaignDto,
  ) {
    return this.campaignsService.generate(id, body);
  }
}
