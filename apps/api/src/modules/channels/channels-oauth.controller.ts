import {
  Controller,
  Get,
  Query,
  Redirect,
} from '@nestjs/common';
import { Public } from '../../common/auth/public.decorator.js';
import { ChannelsService } from './channels.service.js';

@Controller('v1/channels')
export class ChannelsOAuthController {
  constructor(private readonly channelsService: ChannelsService) {}

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
    return {
      url: result.redirectUrl,
      statusCode: 302,
    };
  }
}
