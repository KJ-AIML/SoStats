import { Module } from '@nestjs/common';
import { CampaignsController } from './campaigns.controller.js';
import { CampaignsService } from './campaigns.service.js';
import { DbModule } from '../../db/db.module.js';
import { BrandsModule } from '../brands/brands.module.js';

@Module({
  imports: [DbModule, BrandsModule],
  controllers: [CampaignsController],
  providers: [CampaignsService],
  exports: [CampaignsService],
})
export class CampaignsModule {}
