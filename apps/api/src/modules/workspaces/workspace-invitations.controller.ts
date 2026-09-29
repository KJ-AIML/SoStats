import { Controller, Get, Param, Post } from '@nestjs/common';
import { Public } from '../../common/auth/public.decorator.js';
import { AuditLogService } from '../../common/audit/audit-log.service.js';
import { WorkspaceInvitationsService } from './workspace-invitations.service.js';

@Public()
@Controller('invitations')
export class WorkspaceInvitationsController {
  constructor(
    private readonly invitationsService: WorkspaceInvitationsService,
    private readonly audit: AuditLogService,
  ) {}

  @Get(':token')
  inspect(@Param('token') token: string) {
    return this.invitationsService.inspect(token);
  }

  @Post(':token/accept')
  async accept(@Param('token') token: string) {
    const preview = await this.invitationsService.inspect(token);
    const result = await this.invitationsService.accept(token);

    await this.audit.record({
      workspaceId: preview.workspace.id,
      actor: {
        userId: null,
        email: null,
        authMethod: 'invitation_token',
      },
      action: 'invitation.accepted',
      targetType: 'workspace_invitation',
      targetId: preview.invitationId,
      metadata: {
        invitedEmail: preview.email,
        role: preview.role,
      },
    });

    return result;
  }

  @Post(':token/reject')
  async reject(@Param('token') token: string) {
    const preview = await this.invitationsService.inspect(token);
    const result = await this.invitationsService.reject(token);

    await this.audit.record({
      workspaceId: preview.workspace.id,
      actor: {
        userId: null,
        email: null,
        authMethod: 'invitation_token',
      },
      action: 'invitation.rejected',
      targetType: 'workspace_invitation',
      targetId: preview.invitationId,
      metadata: {
        invitedEmail: preview.email,
        role: preview.role,
      },
    });

    return result;
  }
}
