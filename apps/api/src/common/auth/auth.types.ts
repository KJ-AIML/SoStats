export interface AuthenticatedUser {
  id: number;
  subject: string;
  email: string;
  name: string | null;
  authMethod?: 'jwt' | 'development' | 'api_key';
  session?: {
    id: number;
    authMethod: 'jwt' | 'development';
    expiresAt?: Date | null;
  };
  apiKey?: {
    id: number;
    workspaceId: number;
    scopes: Array<'workspace:read' | 'workspace:write'>;
  };
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
