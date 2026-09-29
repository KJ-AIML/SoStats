import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  CurrentWorkspaceId,
  WorkspaceScoped,
} from '../../common/workspace/workspace.decorator.js';
import {
  CreateKnowledgeSourceDto,
  SearchKnowledgeDto,
} from './knowledge.dto.js';
import { KnowledgeService } from './knowledge.service.js';

@WorkspaceScoped()
@Controller('v1/knowledge')
export class KnowledgeController {
  constructor(private readonly knowledge: KnowledgeService) {}

  @Get()
  findAll(
    @CurrentWorkspaceId() workspaceId: number,
    @Query('brandId') brandId?: string,
  ) {
    const parsed = brandId ? Number.parseInt(brandId, 10) : undefined;
    if (brandId && (!Number.isInteger(parsed) || !parsed || parsed <= 0)) {
      throw new BadRequestException('brandId must be a positive integer');
    }
    return this.knowledge.findAll(workspaceId, parsed);
  }

  @Post()
  create(
    @CurrentWorkspaceId() workspaceId: number,
    @Body() body: CreateKnowledgeSourceDto,
  ) {
    return this.knowledge.create(workspaceId, body);
  }

  @Post('search')
  search(
    @CurrentWorkspaceId() workspaceId: number,
    @Body() body: SearchKnowledgeDto,
  ) {
    return this.knowledge.search(workspaceId, body);
  }

  @Delete(':id')
  remove(
    @CurrentWorkspaceId() workspaceId: number,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.knowledge.remove(workspaceId, id);
  }
}
