import { Module } from '@nestjs/common';
import { IntegrationsController } from './integrations.controller.js';
import { IntegrationsService } from './integrations.service.js';
import { WebhooksController } from './webhooks.controller.js';
import { WebhooksService } from './webhooks.service.js';
import { IntegrationRegistry } from './adapters/integration.registry.js';

@Module({
  controllers: [IntegrationsController, WebhooksController],
  providers: [IntegrationsService, WebhooksService, IntegrationRegistry],
  exports: [IntegrationsService, WebhooksService, IntegrationRegistry],
})
export class IntegrationsModule {}
