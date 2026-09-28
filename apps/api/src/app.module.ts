import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { DbModule } from './db/db.module.js';
import { WorkspacesModule } from './modules/workspaces/workspaces.module.js';
import { BrandsModule } from './modules/brands/brands.module.js';
import { ChannelsModule } from './modules/channels/channels.module.js';
import { MediaModule } from './modules/media/media.module.js';
import { ContentModule } from './modules/content/content.module.js';
import { CampaignsModule } from './modules/campaigns/campaigns.module.js';
import { SchedulingModule } from './modules/scheduling/scheduling.module.js';
import { AutomationsModule } from './modules/automations/automations.module.js';
import { AnalyticsModule } from './modules/analytics/analytics.module.js';
import { IntegrationsModule } from './modules/integrations/integrations.module.js';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { CacheModule, CacheInterceptor } from '@nestjs/cache-manager';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';

@Module({
  imports: [
    ThrottlerModule.forRoot([
      {
        ttl: 60000,
        limit: 100, // 100 requests per minute
      },
    ]),
    CacheModule.register({
      isGlobal: true,
      ttl: 5000, // 5 seconds by default
    }),
    DbModule,
    WorkspacesModule,
    BrandsModule,
    ChannelsModule,
    MediaModule,
    ContentModule,
    CampaignsModule,
    SchedulingModule,
    AutomationsModule,
    AnalyticsModule,
    IntegrationsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: CacheInterceptor,
    },
  ],
})
export class AppModule {}
