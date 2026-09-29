import {
  Controller,
  Get,
  Query,
  Redirect,
} from '@nestjs/common';
import { Public } from '../../common/auth/public.decorator.js';
import { AuditLogService } from '../../common/audit/audit-log.service.js';
import { ChannelsService } from './channels.service.js';

@Controller('v1/channels')
export class ChannelsOAuthController {
  constructor(
    private readonly channelsService: ChannelsService,
    private readonly audit: AuditLogService,
  ) {}

  @Public()
  @Get('oauth/callback')
  @Redirect()
  async callback(
    @Query('state') state: string,
    @Query('code') code?: string,
    @Query('error') error?: string,
    @Query('error_description') errorDescription?: string,
  ) {
    const result = await this.channelsService.completeOAuth(
      state,
      code,
      error,
      errorDescription,
    );

    if (result.accounts?.length) {
      for (const account of result.accounts) {
        await this.audit.record({
          workspaceId: account.workspaceId,
          actor: {
            userId: null,
            email: null,
            authMethod: 'system',
          },
          action: 'channel.connected',
          targetType: 'social_account',
          targetId: account.id,
          metadata: {
            provider: account.provider,
            providerAccountId: account.providerAccountId,
            accountName: account.accountName,
            brandId: account.brandId,
          },
        });
      }
    }

    return {
      url: result.redirectUrl,
      statusCode: 302,
    };
  }
}
