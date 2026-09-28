import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import {
  CurrentWorkspaceId,
  WorkspaceScoped,
} from '../../common/workspace/workspace.decorator.js';
import { BrandsService } from './brands.service.js';
import { CreateBrandDto, UpdateBrandDto } from './brands.dto.js';

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
  findOne(@Param('id') id: string, @CurrentWorkspaceId() workspaceId: number) {
    return this.brandsService.findOne(+id, workspaceId);
  }

  @Put(':id')
  update(
    @Param('id') id: string,
    @Body() data: UpdateBrandDto,
    @CurrentWorkspaceId() workspaceId: number,
  ) {
    return this.brandsService.update(+id, workspaceId, data);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentWorkspaceId() workspaceId: number) {
    return this.brandsService.remove(+id, workspaceId);
  }
}
