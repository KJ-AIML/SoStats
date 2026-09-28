import { Module } from '@nestjs/common';
import { ChannelsModule } from '../channels/channels.module.js';
import { PublishingController } from './publishing.controller.js';
import { PublishingService } from './publishing.service.js';
import { WorkerTokenGuard } from '../../common/internal/worker-token.guard.js';

@Module({
  imports: [ChannelsModule],
  controllers: [PublishingController],
  providers: [PublishingService, WorkerTokenGuard],
  exports: [PublishingService],
})
export class PublishingModule {}
