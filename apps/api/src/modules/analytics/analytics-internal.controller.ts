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
import { AnalyticsService } from './analytics.service.js';

@Public()
@SkipThrottle()
@UseGuards(WorkerTokenGuard)
@Controller('internal/analytics')
export class AnalyticsInternalController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('dispatchable')
  dispatchable(@Query('limit') limit?: string) {
    return this.analytics.listDispatchable(
      limit ? Number.parseInt(limit, 10) : 250,
    );
  }

  @Post('publication-results/:id/ingest')
  ingest(
    @Param('id', ParseIntPipe) id: number,
    @Body('expectedSnapshotAt') expectedSnapshotAt?: string | null,
  ) {
    return this.analytics.ingestPublication(id, expectedSnapshotAt);
  }
}
