import { vi } from 'vitest';
import type {
  ProviderCheckpoint,
  PublishContext,
} from '../../src/modules/channels/ports/SocialPublisherPort.js';

export function testPublishContext(overrides: Partial<PublishContext> = {}) {
  const beforeSideEffect = vi.fn(
    async (_checkpoint: ProviderCheckpoint) => undefined,
  );
  return {
    signal: new AbortController().signal,
    beforeSideEffect,
    ...overrides,
  };
}
