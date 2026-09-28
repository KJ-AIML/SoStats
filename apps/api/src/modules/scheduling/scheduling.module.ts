import { Module } from '@nestjs/common';
import { ChannelsModule } from '../channels/channels.module.js';
import { SchedulingController } from './scheduling.controller.js';
import { SchedulingService } from './scheduling.service.js';

@Module({
  imports: [ChannelsModule],
  controllers: [SchedulingController],
  providers: [SchedulingService],
  exports: [SchedulingService],
})
export class SchedulingModule {}
