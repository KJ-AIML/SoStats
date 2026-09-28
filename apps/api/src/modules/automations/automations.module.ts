import { Module } from '@nestjs/common';
import { AutomationsController } from './automations.controller.js';
import { AutomationsService } from './automations.service.js';
import { WORKFLOW_ENGINE_PORT } from './ports/workflow-engine.port.js';
import { BullMQWorkflowAdapter } from './adapters/bullmq-workflow.adapter.js';

@Module({
  controllers: [AutomationsController],
  providers: [
    AutomationsService,
    {
      provide: WORKFLOW_ENGINE_PORT,
      useClass: BullMQWorkflowAdapter,
    },
  ],
  exports: [AutomationsService],
})
export class AutomationsModule {}
