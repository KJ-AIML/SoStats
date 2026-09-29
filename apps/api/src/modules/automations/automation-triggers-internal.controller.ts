import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../../common/auth/public.decorator.js';
import { WorkerTokenGuard } from '../../common/internal/worker-token.guard.js';
import { AutomationTriggersService } from './automation-triggers.service.js';

@Public()
@SkipThrottle()
@UseGuards(WorkerTokenGuard)
@Controller('internal/automation-triggers')
export class AutomationTriggersInternalController {
  constructor(private readonly triggers: AutomationTriggersService) {}

  @Get('rss/dispatchable')
  dispatchable(@Query('limit') limit?: string) {
    return this.triggers.listDispatchable(
      limit ? Number.parseInt(limit, 10) : 250,
    );
  }

  @Post(':id/claim')
  claim(
    @Param('id', ParseIntPipe) id: number,
    @Body('leaseToken') leaseToken?: string,
  ) {
    return this.triggers.claim(id, leaseToken);
  }

  @Post(':id/complete')
  complete(
    @Param('id', ParseIntPipe) id: number,
    @Body('leaseToken') leaseToken: string,
    @Body('feedTitle') feedTitle: string | undefined,
    @Body('entries')
    entries: Array<{
      externalId: string;
      title?: string;
      link?: string;
      publishedAt?: string;
      summary?: string;
    }>,
  ) {
    return this.triggers.complete(
      id,
      leaseToken,
      feedTitle,
      Array.isArray(entries) ? entries : [],
    );
  }

  @Post(':id/fail')
  fail(
    @Param('id', ParseIntPipe) id: number,
    @Body('leaseToken') leaseToken: string,
    @Body('reason') reason: string,
  ) {
    return this.triggers.fail(
      id,
      leaseToken,
      reason || 'RSS trigger polling failed',
    );
  }
}
