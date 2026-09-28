import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Body,
  Query,
  ParseIntPipe,
} from '@nestjs/common';
import { MediaService } from './media.service.js';

@Controller('v1/assets')
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Get()
  async listAssets(
    @Query('workspaceId', ParseIntPipe) workspaceId: number,
    @Query('brandId') brandId?: string,
  ) {
    const parsedBrandId = brandId ? parseInt(brandId, 10) : undefined;
    return this.mediaService.listAssets(workspaceId, parsedBrandId);
  }

  @Post('upload-url')
  async getUploadUrl(
    @Body('workspaceId', ParseIntPipe) workspaceId: number,
    @Body('fileName') fileName: string,
    @Body('fileType') fileType: string,
    @Body('mimeType') mimeType: string,
    @Body('size', ParseIntPipe) size: number,
    @Body('brandId') brandId?: number,
  ) {
    return this.mediaService.getUploadUrl(
      workspaceId,
      fileName,
      fileType,
      mimeType,
      size,
      brandId,
    );
  }

  @Delete(':id')
  async deleteAsset(
    @Param('id', ParseIntPipe) id: number,
    @Query('workspaceId', ParseIntPipe) workspaceId: number,
  ) {
    return this.mediaService.deleteAsset(workspaceId, id);
  }
}
