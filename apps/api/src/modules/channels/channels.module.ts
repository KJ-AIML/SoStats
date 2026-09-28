import { Module } from '@nestjs/common';
import { ChannelsController } from './channels.controller.js';
import { ChannelsService } from './channels.service.js';
import { ProviderRegistry } from './ProviderRegistry.js';
import { LinkedInPublisherAdapter } from './adapters/LinkedInPublisherAdapter.js';
import { DbModule } from '../../db/db.module.js';

@Module({
  imports: [DbModule],
  controllers: [ChannelsController],
  providers: [
    ChannelsService,
    LinkedInPublisherAdapter,
    ProviderRegistry,
  ],
  exports: [ChannelsService, ProviderRegistry],
})
export class ChannelsModule {}
