import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { parseResolutionBody } from './schedule-resolution.js';

describe('parseResolutionBody (32B-1 §7.1)', () => {
  it('parses the three actions and trims text', () => {
    expect(
      parseResolutionBody({
        action: 'mark_published',
        platformPostId: '  123  ',
        platformPostUrl: 'https://x.com/a/status/123',
        note: ' checked ',
      }),
    ).toEqual({
      action: 'mark_published',
      platformPostId: '123',
      platformPostUrl: 'https://x.com/a/status/123',
      note: 'checked',
    });
    expect(
      parseResolutionBody({
        action: 'confirm_absent',
        scheduledAt: '2026-10-01T09:00:00.000+07:00',
      }),
    ).toEqual({
      action: 'confirm_absent',
      scheduledAt: new Date('2026-10-01T02:00:00.000Z'),
    });
    expect(parseResolutionBody({ action: 'cancel' })).toEqual({ action: 'cancel' });
  });

  it('accepts a valid leap day and an offset timestamp', () => {
    expect(
      parseResolutionBody({ action: 'confirm_absent', scheduledAt: '2028-02-29T09:00:00Z' }),
    ).toEqual({
      action: 'confirm_absent',
      scheduledAt: new Date('2028-02-29T09:00:00Z'),
    });
    expect(
      parseResolutionBody({ action: 'confirm_absent', scheduledAt: '2026-12-31T23:59:59-05:00' }),
    ).toMatchObject({ scheduledAt: new Date('2027-01-01T04:59:59Z') });
  });

  it('treats whitespace-only optional text as absent (Review Focus 4)', () => {
    expect(
      parseResolutionBody({ action: 'mark_published', platformPostId: '   ', note: '' }),
    ).toEqual({ action: 'mark_published' });
  });

  it.each([
    [{}, /action/],
    [{ action: 'retry' }, /action/],
    [{ action: 'confirm_absent' }, /scheduledAt/],
    [{ action: 'confirm_absent', scheduledAt: 'tomorrow' }, /scheduledAt/],
    [{ action: 'confirm_absent', scheduledAt: '2026-10-01T09:00' }, /scheduledAt/],
    [{ action: 'confirm_absent', scheduledAt: '2026-02-30T09:00:00Z' }, /scheduledAt/],
    [{ action: 'confirm_absent', scheduledAt: '2026-04-31T09:00:00Z' }, /scheduledAt/],
    [{ action: 'confirm_absent', scheduledAt: '2026-02-29T09:00:00Z' }, /scheduledAt/],
    [{ action: 'confirm_absent', scheduledAt: '2026-13-01T09:00:00Z' }, /scheduledAt/],
    [{ action: 'confirm_absent', scheduledAt: '2026-10-01T24:00:00Z' }, /scheduledAt/],
    [{ action: 'confirm_absent', scheduledAt: '0000-01-01T00:00:00.000Z' }, /scheduledAt/],
    [{ action: 'mark_published', platformPostId: 'x'.repeat(256) }, /platformPostId/],
    [{ action: 'mark_published', platformPostId: 42 }, /platformPostId/],
    [{ action: 'mark_published', platformPostUrl: 'http://x.com/p/1' }, /platformPostUrl/],
    [{ action: 'mark_published', platformPostUrl: 'javascript:alert(1)' }, /platformPostUrl/],
    [{ action: 'mark_published', platformPostUrl: `https://x.com/${'a'.repeat(1024)}` }, /platformPostUrl/],
    [{ action: 'cancel', note: 'n'.repeat(501) }, /note/],
  ])('rejects %j with a 400', (body, message) => {
    expect(() => parseResolutionBody(body)).toThrow(BadRequestException);
    expect(() => parseResolutionBody(body)).toThrow(message);
  });
});
