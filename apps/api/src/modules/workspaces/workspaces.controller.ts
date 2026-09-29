import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
} from '@nestjs/common';
import { CurrentUser } from '../../common/auth/current-user.decorator.js';
import type { AuthenticatedUser } from '../../common/auth/auth.types.js';
import {
  AuditLogService,
  actorFromUser,
} from '../../common/audit/audit-log.service.js';
import { WorkspacesService } from './workspaces.service.js';
import { WorkspaceInvitationsService } from './workspace-invitations.service.js';
import { ApiKeyService } from '../../common/auth/api-key.service.js';

@Controller('workspaces')
export class WorkspacesController {
  constructor(
    private readonly workspacesService: WorkspacesService,
    private readonly invitationsService: WorkspaceInvitationsService,
    private readonly apiKeys: ApiKeyService,
    private readonly audit: AuditLogService,
  ) {}

  @Post()
  async create(
    @Body('name') name: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const workspace = await this.workspacesService.create(name, user.id);
    await this.audit.record({
      workspaceId: workspace.id,
      actor: actorFromUser(user),
      action: 'workspace.created',
      targetType: 'workspace',
      targetId: workspace.id,
      metadata: {
        name: workspace.name,
        slug: workspace.slug,
      },
    });
    return workspace;
  }

  @Get()
  findAll(@CurrentUser() user: AuthenticatedUser) {
    return this.workspacesService.findAllForUser(user.id);
  }

  @Get(':id/settings')
  settings(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workspacesService.settings(
      id,
      user.id,
      user.session?.id || null,
    );
  }

  @Delete(':id/sessions/:sessionId')
  async revokeSession(
    @Param('id', ParseIntPipe) id: number,
    @Param('sessionId', ParseIntPipe) sessionId: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const result = await this.workspacesService.revokeOwnSession(
      id,
      user.id,
      sessionId,
      user.session?.id || null,
    );

    await this.audit.record({
      workspaceId: id,
      actor: actorFromUser(user),
      action: 'session.revoked',
      targetType: 'auth_session',
      targetId: sessionId,
      metadata: {
        currentSessionId: user.session?.id || null,
      },
    });

    return result;
  }

  @Put(':id/notification-preferences')
  async updateNotificationPreferences(
    @Param('id', ParseIntPipe) id: number,
    @Body()
    body: {
      securityEvents?: unknown;
      publishingFailures?: unknown;
      automationFailures?: unknown;
      weeklyDigest?: unknown;
    },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const result =
      await this.workspacesService.updateOwnNotificationPreferences(
        id,
        user.id,
        body,
      );

    await this.audit.record({
      workspaceId: id,
      actor: actorFromUser(user),
      action: 'notification.preferences_updated',
      targetType: 'workspace_notification_preferences',
      targetId: user.id,
      metadata: {
        securityEvents: result.securityEvents,
        publishingFailures: result.publishingFailures,
        automationFailures: result.automationFailures,
        weeklyDigest: result.weeklyDigest,
      },
    });

    return result;
  }

  @Put(':id/settings')
  async updateSettings(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { name?: string; timezone?: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const workspace = await this.workspacesService.updateSettings(
      id,
      user.id,
      body,
    );
    await this.audit.record({
      workspaceId: id,
      actor: actorFromUser(user),
      action: 'workspace.settings_updated',
      targetType: 'workspace',
      targetId: id,
      metadata: {
        changedFields: Object.keys(body).filter(
          (field) => body[field as keyof typeof body] !== undefined,
        ),
        name: body.name,
        timezone: body.timezone,
      },
    });
    return workspace;
  }

  @Post(':id/invitations')
  async createInvitation(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { email?: string; role?: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const result = await this.invitationsService.create(id, user.id, body);
    await this.audit.record({
      workspaceId: id,
      actor: actorFromUser(user),
      action: 'invitation.created',
      targetType: 'workspace_invitation',
      targetId: result.invitation.id,
      metadata: {
        email: result.invitation.email,
        role: result.invitation.role,
        expiresAt: result.invitation.expiresAt,
      },
    });
    return result;
  }

  @Post(':id/invitations/:invitationId/regenerate')
  async regenerateInvitation(
    @Param('id', ParseIntPipe) id: number,
    @Param('invitationId', ParseIntPipe) invitationId: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const result = await this.invitationsService.regenerate(
      id,
      user.id,
      invitationId,
    );
    await this.audit.record({
      workspaceId: id,
      actor: actorFromUser(user),
      action: 'invitation.regenerated',
      targetType: 'workspace_invitation',
      targetId: invitationId,
      metadata: {
        email: result.invitation.email,
        role: result.invitation.role,
        expiresAt: result.invitation.expiresAt,
      },
    });
    return result;
  }

  @Delete(':id/invitations/:invitationId')
  async revokeInvitation(
    @Param('id', ParseIntPipe) id: number,
    @Param('invitationId', ParseIntPipe) invitationId: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const result = await this.invitationsService.revoke(
      id,
      user.id,
      invitationId,
    );
    await this.audit.record({
      workspaceId: id,
      actor: actorFromUser(user),
      action: 'invitation.revoked',
      targetType: 'workspace_invitation',
      targetId: invitationId,
      metadata: {
        email: result.email,
        role: result.role,
      },
    });
    return result;
  }

  @Post(':id/api-keys')
  async createApiKey(
    @Param('id', ParseIntPipe) id: number,
    @Body()
    body: {
      name?: unknown;
      scopes?: unknown;
      expiresInDays?: unknown;
    },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const result = await this.apiKeys.create(id, user.id, body);
    await this.audit.record({
      workspaceId: id,
      actor: actorFromUser(user),
      action: 'api_key.created',
      targetType: 'workspace_api_key',
      targetId: result.apiKey.id,
      metadata: {
        name: result.apiKey.name,
        publicId: result.apiKey.publicId,
        scopes: result.apiKey.scopes,
        expiresAt: result.apiKey.expiresAt,
      },
    });
    return result;
  }

  @Post(':id/api-keys/:keyId/rotate')
  async rotateApiKey(
    @Param('id', ParseIntPipe) id: number,
    @Param('keyId', ParseIntPipe) keyId: number,
    @Body() body: { expiresInDays?: unknown },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const result = await this.apiKeys.rotate(id, user.id, keyId, body);
    await this.audit.record({
      workspaceId: id,
      actor: actorFromUser(user),
      action: 'api_key.rotated',
      targetType: 'workspace_api_key',
      targetId: keyId,
      metadata: {
        name: result.apiKey.name,
        publicId: result.apiKey.publicId,
        scopes: result.apiKey.scopes,
        expiresAt: result.apiKey.expiresAt,
      },
    });
    return result;
  }

  @Delete(':id/api-keys/:keyId')
  async revokeApiKey(
    @Param('id', ParseIntPipe) id: number,
    @Param('keyId', ParseIntPipe) keyId: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const result = await this.apiKeys.revoke(id, user.id, keyId);
    await this.audit.record({
      workspaceId: id,
      actor: actorFromUser(user),
      action: 'api_key.revoked',
      targetType: 'workspace_api_key',
      targetId: keyId,
      metadata: {
        name: result.name,
        publicId: result.publicId,
        scopes: result.scopes,
      },
    });
    return result;
  }

  @Post(':id/ownership-transfer')
  async transferOwnership(
    @Param('id', ParseIntPipe) id: number,
    @Body()
    body: {
      targetMemberId?: number;
      previousOwnerRole?: 'admin' | 'member';
    },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workspacesService.transferOwnership(
      id,
      user.id,
      Number(body.targetMemberId),
      body.previousOwnerRole || 'admin',
      actorFromUser(user),
    );
  }

  @Put(':id/members/:memberId/role')
  async updateMemberRole(
    @Param('id', ParseIntPipe) id: number,
    @Param('memberId', ParseIntPipe) memberId: number,
    @Body('role') role: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const result = await this.workspacesService.updateMemberRole(
      id,
      user.id,
      memberId,
      role,
    );
    await this.audit.record({
      workspaceId: id,
      actor: actorFromUser(user),
      action: 'member.role_updated',
      targetType: 'workspace_member',
      targetId: memberId,
      metadata: {
        userId: result.userId,
        role: result.role,
      },
    });
    return result;
  }

  @Delete(':id/members/:memberId')
  async removeMember(
    @Param('id', ParseIntPipe) id: number,
    @Param('memberId', ParseIntPipe) memberId: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const result = await this.workspacesService.removeMember(
      id,
      user.id,
      memberId,
    );
    await this.audit.record({
      workspaceId: id,
      actor: actorFromUser(user),
      action: 'member.removed',
      targetType: 'workspace_member',
      targetId: memberId,
      metadata: {
        removed: true,
      },
    });
    return result;
  }

  @Get(':id')
  findOne(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workspacesService.findOneForUser(id, user.id);
  }

  @Put(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body('name') name: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const workspace = await this.workspacesService.update(id, user.id, name);
    await this.audit.record({
      workspaceId: id,
      actor: actorFromUser(user),
      action: 'workspace.name_updated',
      targetType: 'workspace',
      targetId: id,
      metadata: { name: workspace.name },
    });
    return workspace;
  }

  @Delete(':id')
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const workspace = await this.workspacesService.remove(id, user.id);
    await this.audit.record({
      workspaceId: id,
      actor: actorFromUser(user),
      action: 'workspace.deleted',
      targetType: 'workspace',
      targetId: id,
      metadata: {
        name: workspace.name,
        slug: workspace.slug,
      },
    });
    return workspace;
  }
}
