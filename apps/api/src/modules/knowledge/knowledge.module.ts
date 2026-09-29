import { Module } from '@nestjs/common';
import { WorkerTokenGuard } from '../../common/internal/worker-token.guard.js';
import { MediaModule } from '../media/media.module.js';
import { KnowledgeController } from './knowledge.controller.js';
import { KnowledgeInternalController } from './knowledge-internal.controller.js';
import { KnowledgeService } from './knowledge.service.js';

@Module({
  imports: [MediaModule],
  controllers: [KnowledgeController, KnowledgeInternalController],
  providers: [KnowledgeService, WorkerTokenGuard],
  exports: [KnowledgeService],
})
export class KnowledgeModule {}
