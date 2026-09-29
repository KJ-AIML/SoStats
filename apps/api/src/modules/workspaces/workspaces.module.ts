import { Module } from '@nestjs/common';
import { WorkspacesController } from './workspaces.controller.js';
import { WorkspacesService } from './workspaces.service.js';
import { WorkspaceInvitationsService } from './workspace-invitations.service.js';
import { WorkspaceInvitationsController } from './workspace-invitations.controller.js';

@Module({
  controllers: [WorkspacesController, WorkspaceInvitationsController],
  providers: [WorkspacesService, WorkspaceInvitationsService],
})
export class WorkspacesModule {}
