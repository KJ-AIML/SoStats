import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, timingSafeEqual } from 'crypto';

type InternalRequest = {
  headers: Record<string, string | string[] | undefined>;
};

function digest(value: string) {
  return createHash('sha256').update(value, 'utf8').digest();
}

@Injectable()
export class WorkerTokenGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.WORKER_API_TOKEN;
    if (!expected) {
      throw new ServiceUnavailableException(
        'WORKER_API_TOKEN must be configured for internal worker routes',
      );
    }

    const request = context.switchToHttp().getRequest<InternalRequest>();
    const provided = request.headers['x-worker-token'];

    if (
      typeof provided !== 'string' ||
      !timingSafeEqual(digest(provided), digest(expected))
    ) {
      throw new UnauthorizedException('Invalid worker token');
    }

    return true;
  }
}
