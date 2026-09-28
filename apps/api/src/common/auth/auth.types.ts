export interface AuthenticatedUser {
  id: number;
  subject: string;
  email: string;
  name: string | null;
}

export interface JwtClaims {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  exp?: number;
  nbf?: number;
  iss?: string;
  aud?: string | string[];
}
