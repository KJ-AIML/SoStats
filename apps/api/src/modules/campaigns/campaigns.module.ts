import { Module } from '@nestjs/common';
import { CampaignsController } from './campaigns.controller.js';
import { CampaignsService } from './campaigns.service.js';
import { DbModule } from '../../db/db.module.js';

@Module({
  imports: [DbModule],
  controllers: [CampaignsController],
  providers: [CampaignsService],
  exports: [CampaignsService],
})
export class CampaignsModule {}
