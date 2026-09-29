import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller.js';
import { AnalyticsInternalController } from './analytics-internal.controller.js';
import { AnalyticsService } from './analytics.service.js';
import { RecommendationsService } from './recommendations.service.js';
import { DbModule } from '../../db/db.module.js';
import { BrandsModule } from '../brands/brands.module.js';
import { ChannelsModule } from '../channels/channels.module.js';
import { CampaignsModule } from '../campaigns/campaigns.module.js';
import { ContentModule } from '../content/content.module.js';
import { SchedulingModule } from '../scheduling/scheduling.module.js';
import { WorkerTokenGuard } from '../../common/internal/worker-token.guard.js';

@Module({
  imports: [
    DbModule,
    BrandsModule,
    ChannelsModule,
    CampaignsModule,
    ContentModule,
    SchedulingModule,
  ],
  controllers: [AnalyticsController, AnalyticsInternalController],
  providers: [AnalyticsService, RecommendationsService, WorkerTokenGuard],
  exports: [AnalyticsService, RecommendationsService],
})
export class AnalyticsModule {}
