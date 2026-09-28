import { Module } from '@nestjs/common';
import { BrandsController } from './brands.controller.js';
import { BrandsService } from './brands.service.js';
import { BrandContextService } from './brand-context.service.js';

@Module({
  controllers: [BrandsController],
  providers: [BrandsService, BrandContextService],
  exports: [BrandsService, BrandContextService],
})
export class BrandsModule {}
