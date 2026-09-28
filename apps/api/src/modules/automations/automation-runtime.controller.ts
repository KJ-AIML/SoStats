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
import { AutomationRuntimeService } from './automation-runtime.service.js';

@Public()
@SkipThrottle()
@UseGuards(WorkerTokenGuard)
@Controller('internal/automation-runs')
export class AutomationRuntimeController {
  constructor(private readonly runtime: AutomationRuntimeService) {}

  @Get('dispatchable')
  dispatchable(
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
  ) {
    return this.runtime.listDispatchable(
      offset ? Number.parseInt(offset, 10) : 0,
      limit ? Number.parseInt(limit, 10) : 250,
    );
  }

  @Post(':id/execute')
  execute(
    @Param('id', ParseIntPipe) id: number,
    @Body('expectedStepId') expectedStepId?: string,
  ) {
    return this.runtime.execute(id, expectedStepId);
  }

  @Post(':id/dead-letter')
  deadLetter(
    @Param('id', ParseIntPipe) id: number,
    @Body('reason') reason?: string,
  ) {
    return this.runtime.deadLetter(id, reason);
  }
}
