import {
  BadRequestException,
  CanActivate,
  ForbiddenException,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { AuthenticatedUser } from '../auth/auth.types.js';
import { WorkspaceAccessService } from './workspace-access.service.js';
import { WORKSPACE_SCOPED_KEY } from './workspace.decorator.js';

type WorkspaceRequest = {
  headers: Record<string, string | string[] | undefined>;
  method?: string;
  user?: AuthenticatedUser;
  workspaceId?: number;
};

@Injectable()
export class WorkspaceGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly access: WorkspaceAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const scoped = this.reflector.getAllAndOverride<boolean>(
      WORKSPACE_SCOPED_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!scoped) return true;

    const request = context.switchToHttp().getRequest<WorkspaceRequest>();
    const raw = request.headers['x-workspace-id'];
    const workspaceId =
      typeof raw === 'string' ? Number.parseInt(raw, 10) : Number.NaN;

    if (!Number.isInteger(workspaceId) || workspaceId <= 0) {
      throw new BadRequestException('x-workspace-id header is required');
    }
    if (!request.user) {
      throw new BadRequestException('Authenticated user context is missing');
    }

    await this.access.requireMembership(request.user.id, workspaceId);

    if (request.user.apiKey) {
      const method = (request.method || 'GET').toUpperCase();
      const requiredScope = ['GET', 'HEAD', 'OPTIONS'].includes(method)
        ? 'workspace:read'
        : 'workspace:write';

      if (!request.user.apiKey.scopes.includes(requiredScope)) {
        throw new ForbiddenException(
          `API key is missing required scope: ${requiredScope}`,
        );
      }
    }

    request.workspaceId = workspaceId;
    return true;
  }
}
