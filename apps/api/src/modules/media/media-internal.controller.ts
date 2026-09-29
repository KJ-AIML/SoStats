import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../../common/auth/public.decorator.js';
import { WorkerTokenGuard } from '../../common/internal/worker-token.guard.js';
import { MediaService } from './media.service.js';

@Public()
@SkipThrottle()
@UseGuards(WorkerTokenGuard)
@Controller('internal/media')
export class MediaInternalController {
  constructor(private readonly mediaService: MediaService) {}

  @Get('dispatchable')
  dispatchable(@Query('limit') limit?: string) {
    return this.mediaService.listDispatchable(
      limit ? Number.parseInt(limit, 10) : 250,
    );
  }

  @Post(':id/claim')
  claim(
    @Param('id', ParseIntPipe) id: number,
    @Body('processingToken') processingToken?: string,
  ) {
    return this.mediaService.claimProcessing(id, processingToken);
  }

  @Post(':id/complete')
  complete(
    @Param('id', ParseIntPipe) id: number,
    @Body('processingToken') processingToken: string,
    @Body('metadata')
    metadata: { width?: number; height?: number; durationMs?: number },
  ) {
    return this.mediaService.completeProcessing(id, processingToken, metadata);
  }

  @Post(':id/fail')
  fail(
    @Param('id', ParseIntPipe) id: number,
    @Body('processingToken') processingToken: string,
    @Body('reason') reason: string,
  ) {
    return this.mediaService.failProcessing(
      id,
      processingToken,
      reason || 'Media processing failed',
    );
  }
}
