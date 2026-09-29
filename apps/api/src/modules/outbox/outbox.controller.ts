import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../../common/auth/public.decorator.js';
import { WorkerTokenGuard } from '../../common/internal/worker-token.guard.js';
import { OutboxService } from '../../common/outbox/outbox.service.js';

@Public()
@SkipThrottle()
@UseGuards(WorkerTokenGuard)
@Controller('internal/outbox')
export class OutboxController {
  constructor(private readonly outbox: OutboxService) {}

  @Post('claim')
  claim(@Body('limit') limit?: number) {
    return this.outbox.claim(
      typeof limit === 'number' ? limit : 100,
    );
  }

  @Post(':id/execute')
  execute(
    @Param('id', ParseIntPipe) id: number,
    @Body('leaseToken') leaseToken: string,
  ) {
    return this.outbox.execute(id, leaseToken);
  }

  @Get('stats')
  stats() {
    return this.outbox.stats();
  }
}
