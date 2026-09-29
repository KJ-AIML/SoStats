import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import {
  CurrentWorkspaceId,
  WorkspaceScoped,
} from '../../common/workspace/workspace.decorator.js';
import { AnalyticsService } from './analytics.service.js';
import { RecommendationsService } from './recommendations.service.js';

@WorkspaceScoped()
@Controller('v1/analytics')
export class AnalyticsController {
  constructor(
    private readonly analyticsService: AnalyticsService,
    private readonly recommendations: RecommendationsService,
  ) {}

  @Get('overview')
  getOverview(
    @CurrentWorkspaceId() workspaceId: number,
    @Query('days') days?: string,
    @Query('channel') channel?: string,
  ) {
    const parsedDays = days ? Number.parseInt(days, 10) : undefined;
    return this.analyticsService.getOverview(workspaceId, {
      days: Number.isFinite(parsedDays) ? parsedDays : undefined,
      channel,
    });
  }

  @Get('insights')
  listInsights(
    @CurrentWorkspaceId() workspaceId: number,
    @Query('limit') limit?: string,
  ) {
    return this.recommendations.list(
      workspaceId,
      limit ? Number.parseInt(limit, 10) : 30,
    );
  }

  @Post('insights')
  generateInsights(
    @CurrentWorkspaceId() workspaceId: number,
    @Body('brandId') brandId?: number,
  ) {
    return this.recommendations.generate(workspaceId, brandId);
  }

  @Post('insights/:id/execute')
  executeInsight(
    @Param('id', ParseIntPipe) id: number,
    @CurrentWorkspaceId() workspaceId: number,
  ) {
    return this.recommendations.execute(workspaceId, id);
  }

  @Post('insights/:id/dismiss')
  dismissInsight(
    @Param('id', ParseIntPipe) id: number,
    @CurrentWorkspaceId() workspaceId: number,
  ) {
    return this.recommendations.dismiss(workspaceId, id);
  }

  @Get('content/:contentId')
  getContentAnalytics(
    @Param('contentId', ParseIntPipe) contentId: number,
    @CurrentWorkspaceId() workspaceId: number,
  ) {
    return this.analyticsService.getContentAnalytics(workspaceId, contentId);
  }
}
