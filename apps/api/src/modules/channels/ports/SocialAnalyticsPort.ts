export type SocialMetricTotals = {
  impressions?: number;
  reach?: number;
  shares?: number;
  reactions?: number;
  comments?: number;
  clicks?: number;
  saves?: number;
  sends?: number;
};

export class ProviderAnalyticsError extends Error {
  readonly retryable: boolean;
  readonly permissionDenied: boolean;
  readonly statusCode?: number;

  constructor(
    message: string,
    options: {
      retryable?: boolean;
      permissionDenied?: boolean;
      statusCode?: number;
    } = {},
  ) {
    super(message);
    this.name = 'ProviderAnalyticsError';
    this.retryable = options.retryable ?? false;
    this.permissionDenied = options.permissionDenied ?? false;
    this.statusCode = options.statusCode;
  }
}

export interface SocialAnalyticsPort {
  readonly providerName: string;

  fetchPostMetrics(
    platformPostId: string,
    accessToken: string,
  ): Promise<SocialMetricTotals>;
}
