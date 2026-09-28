import { Body, Controller, Param, Post } from '@nestjs/common';
import {
  CurrentWorkspaceId,
  WorkspaceScoped,
} from '../../common/workspace/workspace.decorator.js';
import { ChannelsService } from './channels.service.js';

export class ConnectDto {
  brandId!: number;
  code!: string;
  redirectUri!: string;
}

@WorkspaceScoped()
@Controller('v1/channels')
export class ChannelsController {
  constructor(private readonly channelsService: ChannelsService) {}

  @Post(':provider/connect')
  connect(
    @Param('provider') provider: string,
    @Body() body: ConnectDto,
    @CurrentWorkspaceId() workspaceId: number,
  ) {
    return this.channelsService.connectProvider(
      provider,
      workspaceId,
      body.brandId,
      body.code,
      body.redirectUri,
    );
  }
}
