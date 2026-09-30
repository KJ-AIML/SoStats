import { NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { ProviderPublishError } from '../channels/ports/SocialPublisherPort.js';
import { decideFailure, LeaseLostError } from './publication-outcome.js';

describe('decideFailure (spec §6.1)', () => {
  const unknown = new ProviderPublishError('lost', {
    outcomeUnknown: true,
    errorClass: 'network_transient',
  });
  const retryable = new ProviderPublishError('slow down', {
    retryable: true,
    errorClass: 'rate_limit',
  });
  const terminal = new ProviderPublishError('bad', {
    errorClass: 'invalid_request',
  });

  it.each([
    [
      unknown,
      true,
      {
        kind: 'unknown',
        errorClass: 'network_transient',
        contractViolation: false,
      },
    ],
    [
      unknown,
      false,
      {
        kind: 'unknown',
        errorClass: 'network_transient',
        contractViolation: true,
      },
    ],
    [retryable, true, { kind: 'retry', errorClass: 'rate_limit' }],
    [retryable, false, { kind: 'retry', errorClass: 'rate_limit' }],
    [terminal, true, { kind: 'terminal', errorClass: 'invalid_request' }],
    [terminal, false, { kind: 'terminal', errorClass: 'invalid_request' }],
    [
      new TypeError('boom'),
      true,
      { kind: 'unknown', errorClass: 'internal', contractViolation: false },
    ],
    [new TypeError('boom'), false, { kind: 'retry', errorClass: 'internal' }],
    [
      new NotFoundException('asset gone'),
      false,
      { kind: 'terminal', errorClass: 'invalid_request' },
    ],
    [
      new NotFoundException('asset gone'),
      true,
      { kind: 'unknown', errorClass: 'internal', contractViolation: false },
    ],
    [new LeaseLostError(1, 2), false, { kind: 'lease_lost' }],
  ])('%s with marker=%s', (error, markerSet, expected) => {
    expect(decideFailure(error, markerSet)).toEqual(expected);
  });

  it('derives an error class when an adapter omits one', () => {
    expect(
      new ProviderPublishError('x', { outcomeUnknown: true }).errorClass,
    ).toBe('unknown_outcome');
    expect(new ProviderPublishError('x', { retryable: true }).errorClass).toBe(
      'transient_provider',
    );
    expect(new ProviderPublishError('x').errorClass).toBe('permanent_provider');
  });
});
