import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { AnalyticsService } from './analytics.service.js';

@Controller('v1/analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('overview')
  async getOverview(@Query('workspaceId', ParseIntPipe) workspaceId: number) {
    return this.analyticsService.getOverview(workspaceId);
  }

  @Get('content/:contentId')
  async getContentAnalytics(
    @Param('contentId', ParseIntPipe) contentId: number,
  ) {
    return this.analyticsService.getContentAnalytics(contentId);
  }
}
