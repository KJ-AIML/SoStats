import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { Public } from '../../common/auth/public.decorator.js';
import { AutomationTriggersService } from './automation-triggers.service.js';

type RawRequest = {
  rawBody?: Buffer;
};

@Public()
@Controller('v1/automation-hooks')
export class AutomationHooksController {
  constructor(private readonly triggers: AutomationTriggersService) {}

  @Post(':publicId')
  @HttpCode(202)
  receive(
    @Param('publicId') publicId: string,
    @Req() request: RawRequest,
    @Body() body: unknown,
    @Headers('x-sostats-timestamp') timestamp?: string,
    @Headers('x-sostats-signature') signature?: string,
    @Headers('x-sostats-event-id') eventId?: string,
    @Headers('x-sostats-event') eventName?: string,
  ) {
    if (!request.rawBody) {
      throw new BadRequestException(
        'Raw webhook body is unavailable for signature verification',
      );
    }

    return this.triggers.ingestWebhook(publicId, {
      rawBody: request.rawBody,
      body,
      timestamp,
      signature,
      eventId,
      eventName,
    });
  }
}
