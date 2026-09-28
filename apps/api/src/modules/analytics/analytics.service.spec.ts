import { describe, expect, it } from 'vitest';
import {
  addMetrics,
  analyticsIntervalMs,
  asNumericMetrics,
  subtractMetrics,
} from './analytics.service.js';

describe('analytics metric helpers', () => {
  it('keeps only finite numeric provider metrics', () => {
    expect(
      asNumericMetrics({
        impressions: 100,
        clicks: 4,
        label: 'ignored',
        invalid: Number.NaN,
      }),
    ).toEqual({
      impressions: 100,
      clicks: 4,
    });
  });

  it('calculates snapshot deltas including provider corrections', () => {
    expect(
      subtractMetrics(
        { impressions: 120, reactions: 8 },
        { impressions: 100, reactions: 10 },
      ),
    ).toEqual({
      impressions: 20,
      reactions: -2,
    });
  });

  it('adds deltas into a daily rollup', () => {
    expect(
      addMetrics(
        { impressions: 20, reactions: 2 },
        { impressions: 15, clicks: 3 },
      ),
    ).toEqual({
      impressions: 35,
      reactions: 2,
      clicks: 3,
    });
  });

  it('uses a slower collection cadence as posts age', () => {
    const hour = 60 * 60_000;
    const day = 24 * hour;

    expect(analyticsIntervalMs(2 * hour)).toBe(hour);
    expect(analyticsIntervalMs(2 * day)).toBe(6 * hour);
    expect(analyticsIntervalMs(10 * day)).toBe(day);
    expect(analyticsIntervalMs(31 * day)).toBeNull();
  });
});
