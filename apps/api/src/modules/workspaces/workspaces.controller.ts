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
import { WorkspacesService } from './workspaces.service.js';
import { WorkspaceInvitationsService } from './workspace-invitations.service.js';
import { ApiKeyService } from '../../common/auth/api-key.service.js';

@Controller('workspaces')
export class WorkspacesController {
  constructor(
    private readonly workspacesService: WorkspacesService,
    private readonly invitationsService: WorkspaceInvitationsService,
    private readonly apiKeys: ApiKeyService,
  ) {}

  @Post()
  create(@Body('name') name: string, @CurrentUser() user: AuthenticatedUser) {
    return this.workspacesService.create(name, user.id);
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
    return this.workspacesService.settings(id, user.id);
  }

  @Put(':id/settings')
  updateSettings(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { name?: string; timezone?: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workspacesService.updateSettings(id, user.id, body);
  }

  @Post(':id/invitations')
  createInvitation(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { email?: string; role?: string },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.invitationsService.create(id, user.id, body);
  }

  @Post(':id/invitations/:invitationId/regenerate')
  regenerateInvitation(
    @Param('id', ParseIntPipe) id: number,
    @Param('invitationId', ParseIntPipe) invitationId: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.invitationsService.regenerate(
      id,
      user.id,
      invitationId,
    );
  }

  @Delete(':id/invitations/:invitationId')
  revokeInvitation(
    @Param('id', ParseIntPipe) id: number,
    @Param('invitationId', ParseIntPipe) invitationId: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.invitationsService.revoke(id, user.id, invitationId);
  }

  @Post(':id/api-keys')
  createApiKey(
    @Param('id', ParseIntPipe) id: number,
    @Body()
    body: {
      name?: unknown;
      scopes?: unknown;
      expiresInDays?: unknown;
    },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.apiKeys.create(id, user.id, body);
  }

  @Post(':id/api-keys/:keyId/rotate')
  rotateApiKey(
    @Param('id', ParseIntPipe) id: number,
    @Param('keyId', ParseIntPipe) keyId: number,
    @Body() body: { expiresInDays?: unknown },
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.apiKeys.rotate(id, user.id, keyId, body);
  }

  @Delete(':id/api-keys/:keyId')
  revokeApiKey(
    @Param('id', ParseIntPipe) id: number,
    @Param('keyId', ParseIntPipe) keyId: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.apiKeys.revoke(id, user.id, keyId);
  }

  @Post(':id/ownership-transfer')
  transferOwnership(
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
    );
  }

  @Put(':id/members/:memberId/role')
  updateMemberRole(
    @Param('id', ParseIntPipe) id: number,
    @Param('memberId', ParseIntPipe) memberId: number,
    @Body('role') role: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workspacesService.updateMemberRole(
      id,
      user.id,
      memberId,
      role,
    );
  }

  @Delete(':id/members/:memberId')
  removeMember(
    @Param('id', ParseIntPipe) id: number,
    @Param('memberId', ParseIntPipe) memberId: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workspacesService.removeMember(id, user.id, memberId);
  }

  @Get(':id')
  findOne(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workspacesService.findOneForUser(id, user.id);
  }

  @Put(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body('name') name: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workspacesService.update(id, user.id, name);
  }

  @Delete(':id')
  remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.workspacesService.remove(id, user.id);
  }
}
