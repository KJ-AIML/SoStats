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
import { BrandsService } from './brands.service.js';
import {
  CreateBrandDto,
  ReplaceBrandContextDto,
  UpdateBrandDto,
} from './brands.dto.js';

@WorkspaceScoped()
@Controller('brands')
export class BrandsController {
  constructor(private readonly brandsService: BrandsService) {}

  @Post()
  create(@Body() data: CreateBrandDto, @CurrentWorkspaceId() workspaceId: number) {
    return this.brandsService.create({ ...data, workspaceId });
  }

  @Get()
  findAll(@CurrentWorkspaceId() workspaceId: number) {
    return this.brandsService.findAllForWorkspace(workspaceId);
  }

  @Get(':id')
  findOne(
    @Param('id', ParseIntPipe) id: number,
    @CurrentWorkspaceId() workspaceId: number,
  ) {
    return this.brandsService.findOne(id, workspaceId);
  }

  @Put(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() data: UpdateBrandDto,
    @CurrentWorkspaceId() workspaceId: number,
  ) {
    return this.brandsService.update(id, workspaceId, data);
  }

  @Put(':id/context')
  replaceContext(
    @Param('id', ParseIntPipe) id: number,
    @Body() data: ReplaceBrandContextDto,
    @CurrentWorkspaceId() workspaceId: number,
  ) {
    return this.brandsService.replaceContext(id, workspaceId, data);
  }

  @Delete(':id')
  remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentWorkspaceId() workspaceId: number,
  ) {
    return this.brandsService.remove(id, workspaceId);
  }
}
