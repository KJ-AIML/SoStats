import { Module } from '@nestjs/common';
import { CampaignsModule } from '../campaigns/campaigns.module.js';
import { SchedulingModule } from '../scheduling/scheduling.module.js';
import { AnalyticsModule } from '../analytics/analytics.module.js';
import { AutomationsController } from './automations.controller.js';
import { AutomationRuntimeController } from './automation-runtime.controller.js';
import { AutomationTriggersInternalController } from './automation-triggers-internal.controller.js';
import { AutomationHooksController } from './automation-hooks.controller.js';
import { AutomationsService } from './automations.service.js';
import { AutomationRuntimeService } from './automation-runtime.service.js';
import { AutomationTriggersService } from './automation-triggers.service.js';
import { WorkerTokenGuard } from '../../common/internal/worker-token.guard.js';

@Module({
  imports: [CampaignsModule, SchedulingModule, AnalyticsModule],
  controllers: [
    AutomationsController,
    AutomationRuntimeController,
    AutomationTriggersInternalController,
    AutomationHooksController,
  ],
  providers: [
    AutomationsService,
    AutomationRuntimeService,
    AutomationTriggersService,
    WorkerTokenGuard,
  ],
  exports: [
    AutomationsService,
    AutomationRuntimeService,
    AutomationTriggersService,
  ],
})
export class AutomationsModule {}
