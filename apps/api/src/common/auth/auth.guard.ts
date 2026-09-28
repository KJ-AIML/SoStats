import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { AuthService } from './auth.service.js';
import { IS_PUBLIC_KEY } from './public.decorator.js';
import type { AuthenticatedUser } from './auth.types.js';

type SecuredRequest = FastifyRequest & { user?: AuthenticatedUser };

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authService: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<SecuredRequest>();

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
      request.user = await this.authService.resolveUser(
        this.authService.resolveDevelopmentClaims(
          email,
          typeof name === 'string' ? name : undefined,
        ),
      );
      return true;
    }

    const authorization = request.headers.authorization;
    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Bearer token is required');
    }

    const claims = this.authService.verifyJwt(
      authorization.slice('Bearer '.length).trim(),
    );
    request.user = await this.authService.resolveUser(claims);
    return true;
  }
}
