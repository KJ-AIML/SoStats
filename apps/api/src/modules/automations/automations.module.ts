import { Module } from '@nestjs/common';
import { CampaignsModule } from '../campaigns/campaigns.module.js';
import { SchedulingModule } from '../scheduling/scheduling.module.js';
import { AnalyticsModule } from '../analytics/analytics.module.js';
import { AutomationsController } from './automations.controller.js';
import { AutomationRuntimeController } from './automation-runtime.controller.js';
import { AutomationsService } from './automations.service.js';
import { AutomationRuntimeService } from './automation-runtime.service.js';
import { WorkerTokenGuard } from '../../common/internal/worker-token.guard.js';

@Module({
  imports: [CampaignsModule, SchedulingModule, AnalyticsModule],
  controllers: [AutomationsController, AutomationRuntimeController],
  providers: [
    AutomationsService,
    AutomationRuntimeService,
    WorkerTokenGuard,
  ],
  exports: [AutomationsService, AutomationRuntimeService],
})
export class AutomationsModule {}
