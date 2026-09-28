import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller.js';
import { AnalyticsInternalController } from './analytics-internal.controller.js';
import { AnalyticsService } from './analytics.service.js';
import { DbModule } from '../../db/db.module.js';
import { BrandsModule } from '../brands/brands.module.js';
import { ChannelsModule } from '../channels/channels.module.js';
import { WorkerTokenGuard } from '../../common/internal/worker-token.guard.js';

@Module({
  imports: [DbModule, BrandsModule, ChannelsModule],
  controllers: [AnalyticsController, AnalyticsInternalController],
  providers: [AnalyticsService, WorkerTokenGuard],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
