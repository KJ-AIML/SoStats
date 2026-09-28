import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Put,
  Delete,
  Headers,
} from '@nestjs/common';
import { BrandsService } from './brands.service.js';
import { CreateBrandDto, UpdateBrandDto } from './brands.dto.js';

@Controller('brands')
export class BrandsController {
  constructor(private readonly brandsService: BrandsService) {}

  // Dummy extract workspace ID from headers for now
  private getWorkspaceId(headers: Record<string, string | undefined>): number {
    return headers['x-workspace-id']
      ? parseInt(headers['x-workspace-id'] as string, 10)
      : 1;
  }

  @Post()
  create(
    @Body() data: CreateBrandDto,
    @Headers() headers: Record<string, string | undefined>,
  ) {
    const workspaceId = this.getWorkspaceId(headers);
    return this.brandsService.create({
      ...data,
      workspaceId,
    });
  }

  @Get()
  findAll(@Headers() headers: Record<string, string | undefined>) {
    const workspaceId = this.getWorkspaceId(headers);
    return this.brandsService.findAllForWorkspace(workspaceId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.brandsService.findOne(+id);
  }

  @Put(':id')
  update(@Param('id') id: string, @Body() data: UpdateBrandDto) {
    return this.brandsService.update(+id, data);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.brandsService.remove(+id);
  }
}
