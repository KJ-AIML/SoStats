import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
} from '@nestjs/common';
import { SchedulingService } from './scheduling.service.js';
import {
  CreateScheduleDto,
  UpdateScheduleDto,
  GetCalendarDto,
} from './scheduling.dto.js';

@Controller('v1')
export class SchedulingController {
  constructor(private readonly schedulingService: SchedulingService) {}

  @Get('calendar')
  async getCalendar(@Query() query: any) {
    // Transform query parameters appropriately
    const dto: GetCalendarDto = {
      workspaceId: parseInt(query.workspaceId, 10),
      startDate: query.startDate,
      endDate: query.endDate,
    };
    return this.schedulingService.getCalendar(dto);
  }

  @Post('schedules')
  async createSchedule(@Body() body: CreateScheduleDto) {
    return this.schedulingService.createSchedule(body);
  }

  @Patch('schedules/:id')
  async updateSchedule(
    @Param('id') id: string,
    @Body() body: UpdateScheduleDto,
  ) {
    return this.schedulingService.updateSchedule(parseInt(id, 10), body);
  }
}
