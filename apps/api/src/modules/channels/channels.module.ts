import { Module } from '@nestjs/common';
import { ChannelsController } from './channels.controller.js';
import { ChannelsService } from './channels.service.js';
import { ProviderRegistry } from './ProviderRegistry.js';
import { DbModule } from '../../db/db.module.js';

@Module({
  imports: [DbModule],
  controllers: [ChannelsController],
  providers: [ChannelsService, ProviderRegistry],
  exports: [ChannelsService],
})
export class ChannelsModule {}
