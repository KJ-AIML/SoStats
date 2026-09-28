export type InsightActionType =
  | 'create_campaign'
  | 'repurpose_content'
  | 'reschedule_publication'
  | 'none';

export type AiInsightAction = {
  type: InsightActionType;
  campaign_goal?: string | null;
  audience?: string | null;
  source_content_id?: number | null;
  target_platforms?: string[];
  schedule_id?: number | null;
  suggested_at?: string | null;
};

export type RecommendationEvidence = {
  contentPerformance: Array<{ content_item_id: number }>;
  upcomingSchedules: Array<{ schedule_id: number }>;
  availableChannels: string[];
};

export type SanitizedInsightAction = {
  type: InsightActionType;
  payload: Record<string, unknown>;
};

function normalizeProvider(value?: string | null) {
  const normalized = (value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  return normalized === 'twitter' ? 'x' : normalized;
}

export function sanitizeInsightAction(
  action: AiInsightAction | undefined,
  recommendation: string,
  evidence: RecommendationEvidence,
  now = Date.now(),
): SanitizedInsightAction {
  if (!action || !action.type) {
    return { type: 'none', payload: {} };
  }

  const channelMap = new Map(
    evidence.availableChannels.map((channel) => [
      normalizeProvider(channel),
      channel,
    ]),
  );
  const targetPlatforms = (action.target_platforms || [])
    .map((channel) => channelMap.get(normalizeProvider(channel)))
    .filter((channel): channel is string => Boolean(channel));

  if (action.type === 'repurpose_content') {
    const allowedIds = new Set(
      evidence.contentPerformance.map((item) => item.content_item_id),
    );
    if (
      !action.source_content_id ||
      !allowedIds.has(action.source_content_id)
    ) {
      return { type: 'none', payload: {} };
    }

    return {
      type: 'repurpose_content',
      payload: {
        sourceContentId: action.source_content_id,
        targetPlatforms:
          targetPlatforms.length
            ? targetPlatforms
            : evidence.availableChannels.slice(0, 3),
        campaignGoal: action.campaign_goal || recommendation,
        audience: action.audience || undefined,
      },
    };
  }

  if (action.type === 'reschedule_publication') {
    const allowedSchedules = new Set(
      evidence.upcomingSchedules.map((item) => item.schedule_id),
    );
    const suggested = action.suggested_at
      ? new Date(action.suggested_at)
      : null;

    if (
      !action.schedule_id ||
      !allowedSchedules.has(action.schedule_id) ||
      !suggested ||
      Number.isNaN(suggested.getTime()) ||
      suggested.getTime() <= now ||
      suggested.getTime() > now + 60 * 24 * 60 * 60_000
    ) {
      return { type: 'none', payload: {} };
    }

    return {
      type: 'reschedule_publication',
      payload: {
        scheduleId: action.schedule_id,
        suggestedAt: suggested.toISOString(),
      },
    };
  }

  if (action.type === 'create_campaign') {
    return {
      type: 'create_campaign',
      payload: {
        campaignGoal: action.campaign_goal || recommendation,
        audience: action.audience || undefined,
        targetPlatforms:
          targetPlatforms.length
            ? targetPlatforms
            : evidence.availableChannels.slice(0, 3),
      },
    };
  }

  return { type: 'none', payload: {} };
}
