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
import { Public } from '../../common/auth/public.decorator.js';
import { WorkerTokenGuard } from '../../common/internal/worker-token.guard.js';
import { PublishingService } from './publishing.service.js';

@Public()
@UseGuards(WorkerTokenGuard)
@Controller('internal/publications')
export class PublishingController {
  constructor(private readonly publishingService: PublishingService) {}

  @Get('dispatchable')
  dispatchable(@Query('until') until?: string) {
    return this.publishingService.listDispatchable(until);
  }

  @Post(':id/execute')
  execute(
    @Param('id', ParseIntPipe) id: number,
    @Body('expectedVersion') expectedVersion: string,
  ) {
    return this.publishingService.execute(id, expectedVersion);
  }

  @Post(':id/dead-letter')
  deadLetter(
    @Param('id', ParseIntPipe) id: number,
    @Body('expectedVersion') expectedVersion: string,
    @Body('reason') reason?: string,
  ) {
    return this.publishingService.deadLetter(id, expectedVersion, reason);
  }
}
