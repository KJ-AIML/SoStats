import { Module } from '@nestjs/common';
import { OutboxController } from './outbox.controller.js';

@Module({
  controllers: [OutboxController],
})
export class OutboxModule {}
