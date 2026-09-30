import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { parseExecuteBody } from './publishing.controller.js';

describe('parseExecuteBody', () => {
  const version = '2026-09-30T00:00:00.000Z';

  it('accepts a numeric string generation from JSON', () => {
    expect(
      parseExecuteBody({
        expectedVersion: version,
        expectedDispatchGeneration: '3',
      }),
    ).toEqual({
      expectedVersion: version,
      expectedDispatchGeneration: 3,
      queueJobId: undefined,
    });
  });

  it('treats a missing generation as a legacy version-only request', () => {
    expect(parseExecuteBody({ expectedVersion: version })).toEqual({
      expectedVersion: version,
      expectedDispatchGeneration: undefined,
      queueJobId: undefined,
    });
  });

  it.each([
    { expectedVersion: version, expectedDispatchGeneration: 'abc' },
    { expectedVersion: version, expectedDispatchGeneration: 0 },
    { expectedVersion: 'not-a-date' },
    {},
    null,
  ])('rejects %j with 400', (body) => {
    expect(() => parseExecuteBody(body)).toThrow(BadRequestException);
  });

  it('normalizes a non-canonical valid date to ISO milliseconds', () => {
    expect(
      parseExecuteBody({ expectedVersion: '2026-09-30T02:00:00+02:00' })
        .expectedVersion,
    ).toBe('2026-09-30T00:00:00.000Z');
  });

  it('keeps a string queue job id and drops anything else', () => {
    expect(
      parseExecuteBody({ expectedVersion: version, queueJobId: 'job-1' })
        .queueJobId,
    ).toBe('job-1');
    expect(
      parseExecuteBody({ expectedVersion: version, queueJobId: 7 }).queueJobId,
    ).toBeUndefined();
  });
});
