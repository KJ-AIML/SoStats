import { Module } from '@nestjs/common';
import { ChannelsModule } from '../channels/channels.module.js';
import { PublishingController } from './publishing.controller.js';
import { PublishingService } from './publishing.service.js';
import { WorkerTokenGuard } from '../../common/internal/worker-token.guard.js';
import { MediaModule } from '../media/media.module.js';
import { PublicationLedger } from './publication-ledger.js';
import {
  loadPublishingConfig,
  PUBLISHING_CONFIG,
} from './publishing.config.js';

@Module({
  imports: [ChannelsModule, MediaModule],
  controllers: [PublishingController],
  providers: [
    PublishingService,
    PublicationLedger,
    WorkerTokenGuard,
    { provide: PUBLISHING_CONFIG, useFactory: () => loadPublishingConfig() },
  ],
  exports: [PublishingService],
})
export class PublishingModule {}
