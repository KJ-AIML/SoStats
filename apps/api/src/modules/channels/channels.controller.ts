import { Controller, Post, Body, Param } from '@nestjs/common';
import { ChannelsService } from './channels.service.js';
import { ProviderRegistry } from './ProviderRegistry.js';

export class ConnectDto {
  brandId: number;
  code: string;
  redirectUri: string;
}

@Controller('v1/channels')
export class ChannelsController {
  constructor(
    private readonly channelsService: ChannelsService,
    private readonly providerRegistry: ProviderRegistry,
  ) {}

  @Post(':provider/connect')
  async connect(@Param('provider') provider: string, @Body() body: ConnectDto) {
    const { brandId, code, redirectUri } = body;
    return this.channelsService.connectProvider(
      provider,
      brandId,
      code,
      redirectUri,
    );
  }
}
