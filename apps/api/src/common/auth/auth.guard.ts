import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthService } from './auth.service.js';
import { ApiKeyService } from './api-key.service.js';
import { WORKSPACE_SCOPED_KEY } from '../workspace/workspace.decorator.js';
import { IS_PUBLIC_KEY } from './public.decorator.js';
import type { AuthenticatedUser } from './auth.types.js';

type SecuredRequest = {
  headers: Record<string, string | string[] | undefined>;
  user?: AuthenticatedUser;
};

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authService: AuthService,
    private readonly apiKeys: ApiKeyService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<SecuredRequest>();
    const authorization = request.headers.authorization;

    if (
      typeof authorization === 'string' &&
      authorization.startsWith('Bearer sostats_sk_')
    ) {
      const workspaceScoped = this.reflector.getAllAndOverride<boolean>(
        WORKSPACE_SCOPED_KEY,
        [context.getHandler(), context.getClass()],
      );
      if (!workspaceScoped) {
        throw new UnauthorizedException(
          'API keys are only valid for workspace-scoped API endpoints',
        );
      }

      const rawWorkspaceId = request.headers['x-workspace-id'];
      const workspaceId =
        typeof rawWorkspaceId === 'string'
          ? Number.parseInt(rawWorkspaceId, 10)
          : Number.NaN;
      if (!Number.isInteger(workspaceId) || workspaceId <= 0) {
        throw new UnauthorizedException(
          'x-workspace-id is required for API key authentication',
        );
      }

      const user = await this.apiKeys.authenticate(
        authorization.slice('Bearer '.length).trim(),
      );
      if (user.apiKey?.workspaceId !== workspaceId) {
        throw new UnauthorizedException(
          'API key is not valid for this workspace',
        );
      }

      request.user = user;
      return true;
    }

    if (
      process.env.AUTH_DEV_BYPASS === 'true' &&
      process.env.NODE_ENV !== 'production'
    ) {
      const email = request.headers['x-dev-user-email'];
      const name = request.headers['x-dev-user-name'];
      if (typeof email !== 'string' || !email) {
        throw new UnauthorizedException(
          'x-dev-user-email is required when AUTH_DEV_BYPASS=true',
        );
      }
      request.user = {
        ...(await this.authService.resolveUser(
          this.authService.resolveDevelopmentClaims(
            email,
            typeof name === 'string' ? name : undefined,
          ),
        )),
        authMethod: 'development',
      };
      return true;
    }

    if (
      typeof authorization !== 'string' ||
      !authorization.startsWith('Bearer ')
    ) {
      throw new UnauthorizedException('Bearer token is required');
    }

    const claims = this.authService.verifyJwt(
      authorization.slice('Bearer '.length).trim(),
    );
    request.user = {
      ...(await this.authService.resolveUser(claims)),
      authMethod: 'jwt',
    };
    return true;
  }
}
