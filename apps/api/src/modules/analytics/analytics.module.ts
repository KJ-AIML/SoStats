import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller.js';
import { AnalyticsService } from './analytics.service.js';
import { DbModule } from '../../db/db.module.js';
import { BrandsModule } from '../brands/brands.module.js';

@Module({
  imports: [DbModule, BrandsModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
