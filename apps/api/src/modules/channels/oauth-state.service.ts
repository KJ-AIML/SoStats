import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'crypto';

export type OAuthStatePayload = {
  workspaceId: number;
  brandId: number;
  provider: string;
  redirectUri: string;
  returnTo: string;
  codeVerifier?: string;
  nonce: string;
  exp: number;
};

@Injectable()
export class OAuthStateService {
  private key() {
    const secret =
      process.env.OAUTH_STATE_SECRET || process.env.ENCRYPTION_KEY;
    if (!secret || Buffer.byteLength(secret, 'utf8') < 32) {
      throw new ServiceUnavailableException(
        'OAUTH_STATE_SECRET must contain at least 32 bytes',
      );
    }
    return createHash('sha256').update(secret, 'utf8').digest();
  }

  seal(
    payload: Omit<OAuthStatePayload, 'nonce' | 'exp'>,
    ttlSeconds = 600,
  ) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key(), iv);
    const full: OAuthStatePayload = {
      ...payload,
      nonce: randomBytes(16).toString('base64url'),
      exp: Date.now() + ttlSeconds * 1000,
    };
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(full), 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    return [
      'v1',
      iv.toString('base64url'),
      tag.toString('base64url'),
      ciphertext.toString('base64url'),
    ].join('.');
  }

  open(value: string): OAuthStatePayload {
    try {
      const [version, ivRaw, tagRaw, ciphertextRaw] = value.split('.');
      if (
        version !== 'v1' ||
        !ivRaw ||
        !tagRaw ||
        !ciphertextRaw
      ) {
        throw new Error('invalid state envelope');
      }

      const decipher = createDecipheriv(
        'aes-256-gcm',
        this.key(),
        Buffer.from(ivRaw, 'base64url'),
      );
      decipher.setAuthTag(Buffer.from(tagRaw, 'base64url'));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(ciphertextRaw, 'base64url')),
        decipher.final(),
      ]).toString('utf8');
      const payload = JSON.parse(plaintext) as OAuthStatePayload;

      if (
        !Number.isInteger(payload.workspaceId) ||
        !Number.isInteger(payload.brandId) ||
        !payload.provider ||
        !payload.redirectUri ||
        !this.validReturnTo(payload.returnTo) ||
        !payload.nonce ||
        !Number.isFinite(payload.exp) ||
        payload.exp < Date.now()
      ) {
        throw new Error('invalid or expired state payload');
      }

      return payload;
    } catch {
      throw new BadRequestException('OAuth state is invalid or expired');
    }
  }

  validReturnTo(value: string) {
    return (
      value.startsWith('/') &&
      !value.startsWith('//') &&
      !value.includes('\n') &&
      !value.includes('\r')
    );
  }
}
