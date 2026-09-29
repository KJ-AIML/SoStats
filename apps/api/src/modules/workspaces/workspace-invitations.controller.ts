import { Controller, Get, Param, Post } from '@nestjs/common';
import { Public } from '../../common/auth/public.decorator.js';
import { WorkspaceInvitationsService } from './workspace-invitations.service.js';

@Public()
@Controller('invitations')
export class WorkspaceInvitationsController {
  constructor(
    private readonly invitationsService: WorkspaceInvitationsService,
  ) {}

  @Get(':token')
  inspect(@Param('token') token: string) {
    return this.invitationsService.inspect(token);
  }

  @Post(':token/accept')
  accept(@Param('token') token: string) {
    return this.invitationsService.accept(token);
  }

  @Post(':token/reject')
  reject(@Param('token') token: string) {
    return this.invitationsService.reject(token);
  }
}
