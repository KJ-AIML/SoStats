import {
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';

export const WORKSPACE_SCOPED_KEY = 'sostats:workspace-scoped';
export const WorkspaceScoped = () => SetMetadata(WORKSPACE_SCOPED_KEY, true);

type WorkspaceRequest = { workspaceId?: number };

export const CurrentWorkspaceId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): number => {
    const request = ctx.switchToHttp().getRequest<WorkspaceRequest>();
    if (!request.workspaceId) throw new Error('Workspace context is missing');
    return request.workspaceId;
  },
);
