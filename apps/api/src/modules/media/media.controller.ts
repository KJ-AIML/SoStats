import {
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
import { MediaService } from './media.service.js';

@WorkspaceScoped()
@Controller('v1/assets')
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Get()
  listAssets(
    @CurrentWorkspaceId() workspaceId: number,
    @Query('brandId') brandId?: string,
  ) {
    const parsedBrandId = brandId ? Number.parseInt(brandId, 10) : undefined;
    return this.mediaService.listAssets(workspaceId, parsedBrandId);
  }

  @Post('upload-url')
  getUploadUrl(
    @CurrentWorkspaceId() workspaceId: number,
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

  @Post(':id/complete-upload')
  completeUpload(
    @CurrentWorkspaceId() workspaceId: number,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.mediaService.completeUpload(workspaceId, id);
  }

  @Post(':id/retry')
  retry(
    @CurrentWorkspaceId() workspaceId: number,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.mediaService.retryProcessing(workspaceId, id);
  }

  @Delete(':id')
  deleteAsset(
    @CurrentWorkspaceId() workspaceId: number,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.mediaService.deleteAsset(workspaceId, id);
  }
}
