/**
 * Columns of `social_accounts` that may leave the API in responses.
 * Never add `accessToken` or `refreshToken`: even encrypted, credential blobs
 * stay inside the API boundary.
 */
export const PUBLIC_SOCIAL_ACCOUNT_COLUMNS = {
  id: true,
  workspaceId: true,
  brandId: true,
  provider: true,
  providerAccountId: true,
  accountName: true,
  status: true,
  expiresAt: true,
} as const;
