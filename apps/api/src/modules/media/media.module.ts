import { Module } from '@nestjs/common';
import { MediaController } from './media.controller.js';
import { MediaService } from './media.service.js';
import { OBJECT_STORAGE_PORT } from './ports/object-storage.port.js';
import { MockObjectStorageAdapter } from './adapters/mock-storage.adapter.js';

@Module({
  controllers: [MediaController],
  providers: [
    MediaService,
    {
      provide: OBJECT_STORAGE_PORT,
      useClass: MockObjectStorageAdapter,
    },
  ],
  exports: [MediaService],
})
export class MediaModule {}
