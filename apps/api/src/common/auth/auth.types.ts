export interface AuthenticatedUser {
  id: number;
  subject: string;
  email: string;
  name: string | null;
}

export interface JwtClaims {
  sub: string;
  email?: string;
  name?: string;
  exp?: number;
  nbf?: number;
  iss?: string;
  aud?: string | string[];
}
