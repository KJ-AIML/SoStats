import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import {
  CurrentWorkspaceId,
  WorkspaceScoped,
} from '../../common/workspace/workspace.decorator.js';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../../common/auth/auth.types.js';
import {
  AuditLogService,
  actorFromUser,
} from '../../common/audit/audit-log.service.js';
import { ChannelsService } from './channels.service.js';

export class StartOAuthDto {
  brandId!: number;
  returnTo!: string;
}

@WorkspaceScoped()
@Controller('v1/channels')
export class ChannelsController {
  constructor(
    private readonly channelsService: ChannelsService,
    private readonly audit: AuditLogService,
  ) {}

  @Get()
  findAll(@CurrentWorkspaceId() workspaceId: number) {
    return this.channelsService.findAll(workspaceId);
  }

  @Get('providers')
  providers() {
    return this.channelsService.providers();
  }

  @Post(':id/refresh')
  async refresh(
    @Param('id', ParseIntPipe) id: number,
    @CurrentWorkspaceId() workspaceId: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const result = await this.channelsService.refreshCredentials(workspaceId, id);
    await this.audit.record({
      workspaceId,
      actor: actorFromUser(user),
      action: 'channel.credentials_refreshed',
      targetType: 'social_account',
      targetId: id,
      metadata: {
        status: result.status,
        expiresAt: result.expiresAt,
      },
    });
    return result;
  }

  @Delete(':id')
  async disconnect(
    @Param('id', ParseIntPipe) id: number,
    @CurrentWorkspaceId() workspaceId: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const result = await this.channelsService.disconnect(workspaceId, id);
    await this.audit.record({
      workspaceId,
      actor: actorFromUser(user),
      action: 'channel.disconnected',
      targetType: 'social_account',
      targetId: id,
      metadata: { status: result.status },
    });
    return result;
  }

  @Post(':provider/oauth/start')
  async startOAuth(
    @Param('provider') provider: string,
    @Body() body: StartOAuthDto,
    @CurrentWorkspaceId() workspaceId: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const result = await this.channelsService.startOAuth(
      provider,
      workspaceId,
      body.brandId,
      body.returnTo,
    );
    await this.audit.record({
      workspaceId,
      actor: actorFromUser(user),
      action: 'channel.oauth_started',
      targetType: 'provider',
      targetId: result.provider,
      metadata: {
        provider: result.provider,
        brandId: body.brandId,
      },
    });
    return result;
  }
}
