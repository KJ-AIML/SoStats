import {
  Body,
  Controller,
  Get,
  Param,
  Post,
} from '@nestjs/common';
import {
  CurrentWorkspaceId,
  WorkspaceScoped,
} from '../../common/workspace/workspace.decorator.js';
import { ChannelsService } from './channels.service.js';

export class StartOAuthDto {
  brandId!: number;
  returnTo!: string;
}

@WorkspaceScoped()
@Controller('v1/channels')
export class ChannelsController {
  constructor(private readonly channelsService: ChannelsService) {}

  @Get()
  findAll(@CurrentWorkspaceId() workspaceId: number) {
    return this.channelsService.findAll(workspaceId);
  }

  @Get('providers')
  providers() {
    return this.channelsService.providers();
  }

  @Post(':provider/oauth/start')
  startOAuth(
    @Param('provider') provider: string,
    @Body() body: StartOAuthDto,
    @CurrentWorkspaceId() workspaceId: number,
  ) {
    return this.channelsService.startOAuth(
      provider,
      workspaceId,
      body.brandId,
      body.returnTo,
    );
  }
}
