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
import { KnowledgeService } from './knowledge.service.js';

@Public()
@SkipThrottle()
@UseGuards(WorkerTokenGuard)
@Controller('internal/knowledge')
export class KnowledgeInternalController {
  constructor(private readonly knowledge: KnowledgeService) {}

  @Get('dispatchable')
  dispatchable(@Query('limit') limit?: string) {
    return this.knowledge.listDispatchable(
      limit ? Number.parseInt(limit, 10) : 250,
    );
  }

  @Post(':id/claim')
  claim(
    @Param('id', ParseIntPipe) id: number,
    @Body('processingToken') processingToken?: string,
  ) {
    return this.knowledge.claimProcessing(id, processingToken);
  }

  @Post(':id/chunks')
  appendChunks(
    @Param('id', ParseIntPipe) id: number,
    @Body('processingToken') processingToken: string,
    @Body('versionNumber') versionNumber: number,
    @Body('chunks')
    chunks: Array<{
      index: number;
      content: string;
      embedding: number[];
    }>,
  ) {
    return this.knowledge.appendProcessingChunks(
      id,
      processingToken,
      versionNumber,
      chunks,
    );
  }

  @Post(':id/complete')
  complete(
    @Param('id', ParseIntPipe) id: number,
    @Body('processingToken') processingToken: string,
    @Body('versionNumber') versionNumber: number,
    @Body('chunkCount') chunkCount: number,
    @Body('embeddingModel') embeddingModel: string,
    @Body('contentHash') contentHash: string,
  ) {
    return this.knowledge.completeProcessing(id, processingToken, {
      versionNumber,
      chunkCount,
      embeddingModel,
      contentHash,
    });
  }

  @Post(':id/fail')
  fail(
    @Param('id', ParseIntPipe) id: number,
    @Body('processingToken') processingToken: string,
    @Body('reason') reason: string,
  ) {
    return this.knowledge.failProcessing(
      id,
      processingToken,
      reason || 'Knowledge processing failed',
    );
  }
}
