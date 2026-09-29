import { Module } from '@nestjs/common';
import { MediaController } from './media.controller.js';
import { MediaInternalController } from './media-internal.controller.js';
import { MediaService } from './media.service.js';
import { OBJECT_STORAGE_PORT } from './ports/object-storage.port.js';
import { S3ObjectStorageAdapter } from './adapters/s3-storage.adapter.js';
import { WorkerTokenGuard } from '../../common/internal/worker-token.guard.js';

@Module({
  controllers: [MediaController, MediaInternalController],
  providers: [
    MediaService,
    WorkerTokenGuard,
    {
      provide: OBJECT_STORAGE_PORT,
      useClass: S3ObjectStorageAdapter,
    },
  ],
  exports: [MediaService],
})
export class MediaModule {}
