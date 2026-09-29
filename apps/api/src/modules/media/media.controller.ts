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

  @Get(':id')
  getAsset(
    @CurrentWorkspaceId() workspaceId: number,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.mediaService.getAsset(workspaceId, id);
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

  @Post(':id/attachments')
  attach(
    @CurrentWorkspaceId() workspaceId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body('contentItemId', ParseIntPipe) contentItemId: number,
    @Body('variantId') variantId?: number,
  ) {
    return this.mediaService.attachToContent(
      workspaceId,
      id,
      contentItemId,
      variantId,
    );
  }

  @Delete(':id/attachments/:attachmentId')
  detach(
    @CurrentWorkspaceId() workspaceId: number,
    @Param('id', ParseIntPipe) id: number,
    @Param('attachmentId', ParseIntPipe) attachmentId: number,
  ) {
    return this.mediaService.detachFromContent(
      workspaceId,
      id,
      attachmentId,
    );
  }

  @Delete(':id')
  deleteAsset(
    @CurrentWorkspaceId() workspaceId: number,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.mediaService.deleteAsset(workspaceId, id);
  }
}
