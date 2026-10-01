import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../../common/auth/public.decorator.js';
import { WorkerTokenGuard } from '../../common/internal/worker-token.guard.js';
import { ReconciliationService } from './publication-reconciliation.service.js';
import {
  PublishingService,
  type ExecuteRequest,
} from './publishing.service.js';

export function parseExecuteBody(body: unknown): ExecuteRequest {
  const input = (body && typeof body === 'object' ? body : {}) as Record<
    string,
    unknown
  >;
  if (
    typeof input.expectedVersion !== 'string' ||
    Number.isNaN(Date.parse(input.expectedVersion))
  ) {
    throw new BadRequestException('expectedVersion must be an ISO timestamp');
  }

  let expectedDispatchGeneration: number | undefined;
  const raw = input.expectedDispatchGeneration;
  if (raw !== undefined && raw !== null) {
    const parsed =
      typeof raw === 'number'
        ? raw
        : typeof raw === 'string' && /^\d+$/.test(raw)
          ? Number(raw)
          : Number.NaN;
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new BadRequestException(
        'expectedDispatchGeneration must be a positive integer',
      );
    }
    expectedDispatchGeneration = parsed;
  }

  return {
    expectedVersion: new Date(input.expectedVersion).toISOString(),
    expectedDispatchGeneration,
    queueJobId:
      typeof input.queueJobId === 'string'
        ? input.queueJobId.slice(0, 200)
        : undefined,
  };
}

/** Internal batch size: the config default on garbage, else clamped to 1..20 (32B-1 §4.3). */
export function parseReconcileLimit(raw?: string): number | undefined {
  if (raw === undefined || !/^\d+$/.test(raw)) return undefined;
  return Math.min(20, Math.max(1, Number(raw)));
}

@Public()
@SkipThrottle()
@UseGuards(WorkerTokenGuard)
@Controller('internal/publications')
export class PublishingController {
  constructor(
    private readonly publishingService: PublishingService,
    private readonly reconciliation: ReconciliationService,
  ) {}

  @Post('reconcile-due')
  @HttpCode(200)
  reconcileDue(@Query('limit') limit?: string) {
    return this.reconciliation.reconcileDue(parseReconcileLimit(limit));
  }

  @Get('dispatchable')
  dispatchable(
    @Query('until') until?: string,
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
  ) {
    return this.publishingService.listDispatchable(
      until,
      offset ? Number.parseInt(offset, 10) : 0,
      limit ? Number.parseInt(limit, 10) : 250,
    );
  }

  @Post(':id/execute')
  @HttpCode(200)
  execute(@Param('id', ParseIntPipe) id: number, @Body() body: unknown) {
    return this.publishingService.execute(id, parseExecuteBody(body));
  }

  /** Legacy workers only; a no-op per spec §5.3. */
  @Post(':id/dead-letter')
  @HttpCode(200)
  deadLetter(@Param('id', ParseIntPipe) id: number) {
    return this.publishingService.deadLetter(id);
  }
}
