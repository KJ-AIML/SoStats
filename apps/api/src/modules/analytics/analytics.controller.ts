import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import {
  CurrentWorkspaceId,
  WorkspaceScoped,
} from '../../common/workspace/workspace.decorator.js';
import { AnalyticsService } from './analytics.service.js';

@WorkspaceScoped()
@Controller('v1/analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('overview')
  getOverview(@CurrentWorkspaceId() workspaceId: number) {
    return this.analyticsService.getOverview(workspaceId);
  }

  @Post('insights')
  generateInsights(
    @CurrentWorkspaceId() workspaceId: number,
    @Body('brandId') brandId?: number,
  ) {
    return this.analyticsService.generateInsights(workspaceId, brandId);
  }

  @Get('content/:contentId')
  getContentAnalytics(
    @Param('contentId', ParseIntPipe) contentId: number,
    @CurrentWorkspaceId() workspaceId: number,
  ) {
    return this.analyticsService.getContentAnalytics(workspaceId, contentId);
  }
}
