import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  CurrentWorkspaceId,
  WorkspaceScoped,
} from '../../common/workspace/workspace.decorator.js';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../../common/auth/auth.types.js';
import {
  AuditLogService,
  actorFromUser,
} from '../../common/audit/audit-log.service.js';
import {
  parseResolutionBody,
  ScheduleResolutionService,
} from './schedule-resolution.js';
import { SchedulingService } from './scheduling.service.js';
import {
  CreateScheduleDto,
  GetCalendarDto,
  UpdateScheduleDto,
} from './scheduling.dto.js';

@WorkspaceScoped()
@Controller('v1')
export class SchedulingController {
  constructor(
    private readonly schedulingService: SchedulingService,
    private readonly resolution: ScheduleResolutionService,
    private readonly audit: AuditLogService,
  ) {}

  @Get('calendar')
  getCalendar(
    @Query() query: GetCalendarDto,
    @CurrentWorkspaceId() workspaceId: number,
  ) {
    return this.schedulingService.getCalendar(workspaceId, query);
  }

  /** 32B-1 §7: owner/admin resolution of a `needs_review` publication. */
  @Post('schedules/:id/resolution')
  @HttpCode(200)
  resolveSchedule(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
    @CurrentWorkspaceId() workspaceId: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.resolution.resolve(
      workspaceId,
      id,
      user,
      parseResolutionBody(body),
    );
  }

  @Post('schedules')
  async createSchedule(
    @Body() body: CreateScheduleDto,
    @CurrentWorkspaceId() workspaceId: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const result = await this.schedulingService.createSchedule(
      workspaceId,
      body,
    );
    await this.audit.record({
      workspaceId,
      actor: actorFromUser(user),
      action: 'publication.scheduled',
      targetType: 'scheduled_publication',
      targetId: result.id,
      metadata: {
        contentItemId: result.contentItemId,
        variantId: result.variantId,
        socialAccountId: result.socialAccountId,
        scheduledAt: result.scheduledAt,
      },
    });
    return result;
  }

  @Patch('schedules/:id')
  async updateSchedule(
    @Param('id') id: string,
    @Body() body: UpdateScheduleDto,
    @CurrentWorkspaceId() workspaceId: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const scheduleId = Number.parseInt(id, 10);
    const result = await this.schedulingService.updateSchedule(
      workspaceId,
      scheduleId,
      body,
    );
    const cancelled = result.status === 'cancelled';

    await this.audit.record({
      workspaceId,
      actor: actorFromUser(user),
      action: cancelled
        ? 'publication.cancelled'
        : 'publication.rescheduled',
      targetType: 'scheduled_publication',
      targetId: scheduleId,
      metadata: {
        contentItemId: result.contentItemId,
        variantId: result.variantId,
        socialAccountId: result.socialAccountId,
        scheduledAt: result.scheduledAt,
        status: result.status,
      },
    });

    return result;
  }
}
