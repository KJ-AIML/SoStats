import { Module } from '@nestjs/common';
import { ChannelsController } from './channels.controller.js';
import { ChannelsOAuthController } from './channels-oauth.controller.js';
import { ChannelsService } from './channels.service.js';
import { ChannelCredentialService } from './channel-credential.service.js';
import { OAuthStateService } from './oauth-state.service.js';
import { ProviderRegistry } from './ProviderRegistry.js';
import { LinkedInPublisherAdapter } from './adapters/LinkedInPublisherAdapter.js';
import { XPublisherAdapter } from './adapters/XPublisherAdapter.js';
import { DbModule } from '../../db/db.module.js';

@Module({
  imports: [DbModule],
  controllers: [ChannelsController, ChannelsOAuthController],
  providers: [
    ChannelsService,
    ChannelCredentialService,
    OAuthStateService,
    LinkedInPublisherAdapter,
    XPublisherAdapter,
    ProviderRegistry,
  ],
  exports: [
    ChannelsService,
    ChannelCredentialService,
    ProviderRegistry,
  ],
})
export class ChannelsModule {}
