type JsonRecord = Record<string, unknown>;

export class SoStatsApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly payload?: unknown,
  ) {
    super(message);
    this.name = "SoStatsApiError";
  }
}

export type WorkspaceRecord = {
  id: number;
  name: string;
  slug: string;
  timezone: string;
  role?: string;
};

export type WorkspaceSettingsRecord = {
  workspace: WorkspaceRecord & {
    createdAt?: string;
    updatedAt?: string;
  };
  members: Array<{
    id: number;
    userId: number;
    name?: string | null;
    email?: string | null;
    role: string;
    createdAt?: string;
    updatedAt?: string;
    isCurrentUser: boolean;
  }>;
  permissions: {
    canManageWorkspace: boolean;
    canManageMembers: boolean;
    canDeleteWorkspace: boolean;
  };
  security: {
    authMode: "development_bypass" | "bearer_jwt" | string;
    developmentBypassEnabled: boolean;
    jwtIssuerConfigured: boolean;
    jwtAudienceConfigured: boolean;
    productionRequiresBearerToken: boolean;
  };
  productCapabilities: {
    teamRoles: boolean;
    workspaceTimezone: boolean;
    invitations: boolean;
    apiKeys: boolean;
    notificationPreferences: boolean;
    auditLog: boolean;
    workspacePublishPolicy: boolean;
  };
};

export type KnowledgeSourceRecord = {
  id: number;
  workspaceId: number;
  brandId: number;
  sourceType: "text" | "url" | "file" | string;
  title: string;
  sourceUrl?: string | null;
  mimeType?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
  status:
    | "uploading"
    | "uploaded"
    | "processing"
    | "ready"
    | "failed"
    | string;
  activeVersion: number;
  processingVersion?: number | null;
  embeddingModel?: string | null;
  chunkCount: number;
  metadata?: Record<string, unknown>;
  lastError?: string | null;
  uploadCompletedAt?: string | null;
  processedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type BrandRecord = {
  id: number;
  workspaceId: number;
  name: string;
  description?: string | null;
  websiteUrl?: string | null;
  voiceProfiles?: Array<{ id: number; tone: string; style?: string | null; guidelines?: string | null }>;
  audiences?: Array<{ id: number; name: string; demographics?: string | null; painPoints?: string | null }>;
  products?: Array<{ id: number; name: string; description?: string | null; features?: string | null }>;
  pillars?: Array<{ id: number; name: string; description?: string | null }>;
  rules?: Array<{ id: number; ruleType: string; description: string }>;
};

export type CampaignRecord = {
  id: number;
  workspaceId: number;
  brandId?: number | null;
  name: string;
  description?: string | null;
  goal?: string | null;
  status: string;
  generationContext?: {
    knowledgeEvidence?: Array<{
      chunkId: number;
      sourceId: number;
      sourceTitle: string;
      sourceUrl?: string | null;
      versionNumber?: number;
      similarity: number;
    }>;
  } | Record<string, unknown>;
  channels?: Array<{ id: number; platform: string }>;
  pillars?: Array<{ id: number; pillar: string }>;
  contentItems?: ContentRecord[];
};

export type ContentVariantRecord = {
  id: number;
  contentItemId: number;
  socialAccountId?: number | null;
  platform?: string | null;
  content: string;
  status: string;
  scheduledAt?: string | null;
  publishedAt?: string | null;
};

export type ContentRecord = {
  id: number;
  workspaceId: number;
  brandId?: number | null;
  campaignId?: number | null;
  title: string;
  description?: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  campaign?: CampaignRecord | null;
  variants?: ContentVariantRecord[];
  scheduledPublications?: ScheduleRecord[];
};

export type ProviderCapabilitiesRecord = {
  text: boolean;
  images: boolean;
  video: boolean;
  carousel: boolean;
  analytics: boolean;
  nativeScheduling: boolean;
  requiresMedia?: boolean;
  mediaMimeTypes?: string[];
  maxMediaItems?: number;
};

export type SocialAccountRecord = {
  id: number;
  workspaceId: number;
  brandId: number;
  brand?: { id: number; name: string } | null;
  provider: string;
  providerAccountId: string;
  accountName?: string | null;
  expiresAt?: string | null;
  status: string;
  supported?: boolean;
  capabilities?: ProviderCapabilitiesRecord | null;
  credentialState?:
    | "active"
    | "no_expiry"
    | "expiring"
    | "refresh_required"
    | "expired"
    | "disconnected"
    | "missing_token"
    | string;
  hasRefreshToken?: boolean;
  publishingReady?: boolean;
  analyticsReady?: boolean;
  activeScheduleCount?: number;
  publishedCount?: number;
  lastPublishedAt?: string | null;
  latestAnalyticsAt?: string | null;
  updatedAt?: string;
};

export type SocialProviderRecord = {
  provider: string;
  capabilities: ProviderCapabilitiesRecord;
  oauth?: {
    pkce: boolean;
  };
};


export type PublicationResultRecord = {
  id: number;
  platformPostId?: string | null;
  platformPostUrl?: string | null;
  errorType?: string | null;
  errorMessage?: string | null;
  createdAt: string;
};

export type PublicationJobRecord = {
  id: number;
  status: string;
  attempts: number;
  lastAttemptAt?: string | null;
  nextAttemptAt?: string | null;
  results?: PublicationResultRecord[];
};

export type ScheduleRecord = {
  id: number;
  contentItemId: number;
  variantId?: number | null;
  workspaceId: number;
  socialAccountId: number;
  scheduledAt: string;
  status: string;
  createdAt?: string;
  updatedAt?: string;
  contentItem?: ContentRecord;
  variant?: ContentVariantRecord | null;
  socialAccount?: SocialAccountRecord;
  jobs?: PublicationJobRecord[];
};

export type AnalyticsOverview = {
  workspaceId: number;
  windowStart?: string;
  windowEnd?: string;
  rangeDays?: number;
  selectedChannel?: string;
  availableChannels?: string[];
  totals: Record<string, number>;
  daily: Array<{
    id: number;
    date: string;
    metrics: Record<string, number>;
  }>;
  hasData: boolean;
  latestSnapshotAt?: string | null;
  trackedPosts?: number;
  publishedCount?: number;
  syncWindowDays?: number;
  channelBreakdown?: Array<{
    provider: string;
    accountCount: number;
    accountNames: string[];
    totals: Record<string, number>;
    trackedPosts: number;
    latestSnapshotAt?: string | null;
  }>;
  contentPerformance?: Array<{
    contentItemId: number;
    title: string;
    provider: string;
    accountName: string;
    platformPostId: string;
    metrics: Record<string, number>;
    snapshotAt: string;
  }>;
};

export type AiInsightRecord = {
  id: number;
  workspaceId: number;
  brandId?: number | null;
  generationId: string;
  summary?: string | null;
  finding: string;
  evidence: string[];
  recommendation: string;
  impactEstimate?: string | null;
  confidence: "low" | "medium" | "high";
  actionType:
    | "create_campaign"
    | "repurpose_content"
    | "reschedule_publication"
    | "none";
  actionPayload: Record<string, unknown>;
  status:
    | "pending"
    | "executing"
    | "executed"
    | "failed"
    | "dismissed"
    | "superseded"
    | "informational";
  result?: Record<string, unknown> | null;
  error?: string | null;
  executedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AutomationVersionRecord = {
  id: number;
  automationId: number;
  versionNumber: number;
  workflowDefinition: unknown;
  publishedAt?: string | null;
  createdAt: string;
};

export type AutomationRunStepRecord = {
  id: number;
  runId: number;
  stepId: string;
  status: string;
  startedAt?: string | null;
  completedAt?: string | null;
  logs?: string | null;
  error?: string | null;
  createdAt: string;
};

export type AutomationRunRecord = {
  id: number;
  automationId: number;
  versionId: number;
  status: string;
  startedAt?: string | null;
  completedAt?: string | null;
  error?: string | null;
  createdAt: string;
  steps?: AutomationRunStepRecord[];
  version?: AutomationVersionRecord;
};

export type AutomationTriggerRecord = {
  id: number;
  automationId: number;
  type: string;
  config: Record<string, unknown>;
  status: string;
  publicId?: string | null;
  endpointUrl?: string | null;
  nextPollAt?: string | null;
  lastPolledAt?: string | null;
  lastTriggeredAt?: string | null;
  lastReceivedAt?: string | null;
  lastError?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AutomationRecord = {
  id: number;
  name: string;
  description?: string | null;
  triggerType: string;
  status: string;
  versions?: AutomationVersionRecord[];
  runs?: AutomationRunRecord[];
  triggers?: AutomationTriggerRecord[];
};

export type AssetRecord = {
  id: number;
  workspaceId: number;
  brandId?: number | null;
  fileName: string;
  fileType: "image" | "video" | string;
  mimeType: string;
  size: number;
  publicUrl?: string | null;
  viewUrl?: string | null;
  status: "uploading" | "uploaded" | "processing" | "ready" | "failed" | string;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
  processingError?: string | null;
  uploadCompletedAt?: string | null;
  processedAt?: string | null;
  usageCount?: number;
  usages?: Array<{
    id: number;
    contentItemId?: number | null;
    contentTitle?: string | null;
    contentStatus?: string | null;
    variantId?: number | null;
    variantPlatform?: string | null;
  }>;
  tags?: Array<{ id: number; tag: string }>;
  createdAt?: string;
  updatedAt?: string;
};

export type WorkspaceSnapshot = {
  workspace: WorkspaceRecord;
  brand: BrandRecord | null;
  brands: BrandRecord[];
  campaigns: CampaignRecord[];
  content: ContentRecord[];
  calendar: ScheduleRecord[];
  analytics: AnalyticsOverview;
  insights: AiInsightRecord[];
  channels: SocialAccountRecord[];
  providers: SocialProviderRecord[];
  automations: AutomationRecord[];
  assets: AssetRecord[];
  knowledge: KnowledgeSourceRecord[];
  errors: string[];
};

const API_URL = (process.env.SOSTATS_API_URL || "http://localhost:4000").replace(/\/$/, "");

function authHeaders(): HeadersInit {
  const token = process.env.SOSTATS_API_TOKEN;
  if (token) return { authorization: `Bearer ${token}` };

  if (process.env.NODE_ENV !== "production") {
    return {
      "x-dev-user-email": process.env.SOSTATS_DEV_EMAIL || "dev@sostats.local",
      "x-dev-user-name": process.env.SOSTATS_DEV_NAME || "SoStats Dev",
    };
  }

  throw new Error(
    "SOSTATS_API_TOKEN must be configured for the web server in production",
  );
}

async function parseResponse(response: Response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export async function backendRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(authHeaders());
  new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  if (init.body && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });
  const payload = await parseResponse(response);

  if (!response.ok) {
    throw new SoStatsApiError(
      `SoStats API request failed: ${response.status} ${response.statusText}`,
      response.status,
      payload,
    );
  }

  return payload as T;
}

export async function resolveWorkspace(
  workspaceSlug: string,
): Promise<WorkspaceRecord> {
  let workspaces = await backendRequest<WorkspaceRecord[]>("/workspaces");
  const exact = workspaces.find((workspace) => workspace.slug === workspaceSlug);
  if (exact) return exact;

  if (workspaceSlug === "demo" && workspaces[0]) {
    return workspaces[0];
  }

  const canBootstrap =
    process.env.NODE_ENV !== "production" &&
    process.env.SOSTATS_DEV_AUTO_WORKSPACE !== "false";

  if (workspaceSlug === "demo" && canBootstrap && workspaces.length === 0) {
    await backendRequest<WorkspaceRecord>("/workspaces", {
      method: "POST",
      body: JSON.stringify({ name: "SoStats Studio" }),
    });
    workspaces = await backendRequest<WorkspaceRecord[]>("/workspaces");
    if (workspaces[0]) return workspaces[0];
  }

  throw new SoStatsApiError(
    `Workspace "${workspaceSlug}" was not found`,
    404,
  );
}

export async function workspaceRequest<T>(
  workspaceSlug: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const workspace = await resolveWorkspace(workspaceSlug);
  const headers = new Headers(init.headers);
  headers.set("x-workspace-id", String(workspace.id));
  return backendRequest<T>(path, { ...init, headers });
}

async function safe<T>(
  label: string,
  task: Promise<T>,
  fallback: T,
  errors: string[],
): Promise<T> {
  try {
    return await task;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    errors.push(`${label}: ${detail}`);
    return fallback;
  }
}

export async function loadWorkspaceSnapshot(
  workspaceSlug: string,
): Promise<WorkspaceSnapshot> {
  const workspace = await resolveWorkspace(workspaceSlug);
  const errors: string[] = [];

  const [
    brands,
    campaigns,
    content,
    calendar,
    analytics,
    insights,
    channels,
    providers,
    automations,
    assets,
    knowledge,
  ] = await Promise.all([
    safe("brands", workspaceRequest<BrandRecord[]>(workspaceSlug, "/brands"), [], errors),
    safe("campaigns", workspaceRequest<CampaignRecord[]>(workspaceSlug, "/v1/campaigns"), [], errors),
    safe("content", workspaceRequest<ContentRecord[]>(workspaceSlug, "/v1/content"), [], errors),
    safe("calendar", workspaceRequest<ScheduleRecord[]>(workspaceSlug, "/v1/calendar"), [], errors),
    safe(
      "analytics",
      workspaceRequest<AnalyticsOverview>(workspaceSlug, "/v1/analytics/overview"),
      {
        workspaceId: workspace.id,
        totals: {},
        daily: [],
        hasData: false,
        latestSnapshotAt: null,
        trackedPosts: 0,
        syncWindowDays: 30,
      },
      errors,
    ),
    safe(
      "insights",
      workspaceRequest<AiInsightRecord[]>(workspaceSlug, "/v1/analytics/insights?limit=30"),
      [],
      errors,
    ),
    safe("channels", workspaceRequest<SocialAccountRecord[]>(workspaceSlug, "/v1/channels"), [], errors),
    safe(
      "providers",
      workspaceRequest<SocialProviderRecord[]>(workspaceSlug, "/v1/channels/providers"),
      [],
      errors,
    ),
    safe("automations", workspaceRequest<AutomationRecord[]>(workspaceSlug, "/v1/automations"), [], errors),
    safe("assets", workspaceRequest<AssetRecord[]>(workspaceSlug, "/v1/assets"), [], errors),
    safe(
      "knowledge",
      workspaceRequest<KnowledgeSourceRecord[]>(workspaceSlug, "/v1/knowledge"),
      [],
      errors,
    ),
  ]);

  const firstBrand = brands[0] || null;
  const brand = firstBrand
    ? await safe(
        "brand",
        workspaceRequest<BrandRecord>(workspaceSlug, `/brands/${firstBrand.id}`),
        firstBrand,
        errors,
      )
    : null;

  return {
    workspace,
    brand,
    brands,
    campaigns,
    content,
    calendar,
    analytics,
    insights,
    channels,
    providers,
    automations,
    assets,
    knowledge,
    errors,
  };
}

export function jsonBody(value: JsonRecord) {
  return JSON.stringify(value);
}
