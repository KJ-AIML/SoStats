import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { DbModule } from './db/db.module.js';
import { SecurityModule } from './common/security.module.js';
import { AuthGuard } from './common/auth/auth.guard.js';
import { WorkspaceGuard } from './common/workspace/workspace.guard.js';
import { WorkspacesModule } from './modules/workspaces/workspaces.module.js';
import { BrandsModule } from './modules/brands/brands.module.js';
import { ChannelsModule } from './modules/channels/channels.module.js';
import { MediaModule } from './modules/media/media.module.js';
import { ContentModule } from './modules/content/content.module.js';
import { CampaignsModule } from './modules/campaigns/campaigns.module.js';
import { SchedulingModule } from './modules/scheduling/scheduling.module.js';
import { PublishingModule } from './modules/publishing/publishing.module.js';
import { AutomationsModule } from './modules/automations/automations.module.js';
import { AnalyticsModule } from './modules/analytics/analytics.module.js';
import { IntegrationsModule } from './modules/integrations/integrations.module.js';

@Module({
  imports: [
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    DbModule,
    SecurityModule,
    WorkspacesModule,
    BrandsModule,
    ChannelsModule,
    MediaModule,
    ContentModule,
    CampaignsModule,
    SchedulingModule,
    PublishingModule,
    AutomationsModule,
    AnalyticsModule,
    IntegrationsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    { provide: APP_GUARD, useExisting: AuthGuard },
    { provide: APP_GUARD, useExisting: WorkspaceGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
