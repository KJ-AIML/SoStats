import { Module } from '@nestjs/common';
import { MediaController } from './media.controller.js';
import { MediaService } from './media.service.js';
import { OBJECT_STORAGE_PORT } from './ports/object-storage.port.js';
import { S3ObjectStorageAdapter } from './adapters/s3-storage.adapter.js';

@Module({
  controllers: [MediaController],
  providers: [
    MediaService,
    {
      provide: OBJECT_STORAGE_PORT,
      useClass: S3ObjectStorageAdapter,
    },
  ],
  exports: [MediaService],
})
export class MediaModule {}
