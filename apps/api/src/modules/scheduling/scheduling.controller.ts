import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  CurrentWorkspaceId,
  WorkspaceScoped,
} from '../../common/workspace/workspace.decorator.js';
import { SchedulingService } from './scheduling.service.js';
import {
  CreateScheduleDto,
  GetCalendarDto,
  UpdateScheduleDto,
} from './scheduling.dto.js';

@WorkspaceScoped()
@Controller('v1')
export class SchedulingController {
  constructor(private readonly schedulingService: SchedulingService) {}

  @Get('calendar')
  getCalendar(
    @Query() query: GetCalendarDto,
    @CurrentWorkspaceId() workspaceId: number,
  ) {
    return this.schedulingService.getCalendar(workspaceId, query);
  }

  @Post('schedules')
  createSchedule(
    @Body() body: CreateScheduleDto,
    @CurrentWorkspaceId() workspaceId: number,
  ) {
    return this.schedulingService.createSchedule(workspaceId, body);
  }

  @Patch('schedules/:id')
  updateSchedule(
    @Param('id') id: string,
    @Body() body: UpdateScheduleDto,
    @CurrentWorkspaceId() workspaceId: number,
  ) {
    return this.schedulingService.updateSchedule(
      workspaceId,
      Number.parseInt(id, 10),
      body,
    );
  }
}
