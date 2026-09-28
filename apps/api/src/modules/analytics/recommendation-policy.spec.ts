import { describe, expect, it } from 'vitest';
import { sanitizeInsightAction } from './recommendation-policy.js';

const evidence = {
  contentPerformance: [{ content_item_id: 11 }, { content_item_id: 22 }],
  upcomingSchedules: [{ schedule_id: 40 }],
  availableChannels: ['linkedin', 'x'],
};

describe('recommendation action policy', () => {
  it('accepts repurpose only for observed content ids and connected channels', () => {
    expect(
      sanitizeInsightAction(
        {
          type: 'repurpose_content',
          source_content_id: 11,
          target_platforms: ['LinkedIn', 'instagram'],
          campaign_goal: 'Expand the winning concept',
        },
        'Repurpose the winner',
        evidence,
      ),
    ).toEqual({
      type: 'repurpose_content',
      payload: {
        sourceContentId: 11,
        targetPlatforms: ['linkedin'],
        campaignGoal: 'Expand the winning concept',
        audience: undefined,
      },
    });
  });

  it('downgrades an invented source id to no action', () => {
    expect(
      sanitizeInsightAction(
        {
          type: 'repurpose_content',
          source_content_id: 999,
          target_platforms: ['linkedin'],
        },
        'Repurpose it',
        evidence,
      ),
    ).toEqual({ type: 'none', payload: {} });
  });

  it('accepts only known future schedule ids and bounded timestamps', () => {
    const now = Date.parse('2026-10-01T00:00:00.000Z');

    expect(
      sanitizeInsightAction(
        {
          type: 'reschedule_publication',
          schedule_id: 40,
          suggested_at: '2026-10-03T10:00:00.000Z',
        },
        'Move the post',
        evidence,
        now,
      ),
    ).toEqual({
      type: 'reschedule_publication',
      payload: {
        scheduleId: 40,
        suggestedAt: '2026-10-03T10:00:00.000Z',
      },
    });

    expect(
      sanitizeInsightAction(
        {
          type: 'reschedule_publication',
          schedule_id: 41,
          suggested_at: '2026-10-03T10:00:00.000Z',
        },
        'Move the post',
        evidence,
        now,
      ),
    ).toEqual({ type: 'none', payload: {} });
  });

  it('filters campaign targets to connected channels', () => {
    expect(
      sanitizeInsightAction(
        {
          type: 'create_campaign',
          target_platforms: ['twitter', 'tiktok', 'linkedin'],
        },
        'Create more content around this pattern',
        evidence,
      ),
    ).toEqual({
      type: 'create_campaign',
      payload: {
        campaignGoal: 'Create more content around this pattern',
        audience: undefined,
        targetPlatforms: ['x', 'linkedin'],
      },
    });
  });
});
