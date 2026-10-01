import { Module } from '@nestjs/common';
import { ChannelsModule } from '../channels/channels.module.js';
import { MediaModule } from '../media/media.module.js';
import { PublishingModule } from '../publishing/publishing.module.js';
import { ScheduleResolutionService } from './schedule-resolution.js';
import { SchedulingController } from './scheduling.controller.js';
import { SchedulingService } from './scheduling.service.js';

@Module({
  imports: [ChannelsModule, MediaModule, PublishingModule],
  controllers: [SchedulingController],
  providers: [SchedulingService, ScheduleResolutionService],
  exports: [SchedulingService],
})
export class SchedulingModule {}
