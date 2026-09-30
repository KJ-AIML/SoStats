import { vi } from 'vitest';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../src/db/schema.js';
import { AuditLogService } from '../../src/common/audit/audit-log.service.js';
import { OutboxService } from '../../src/common/outbox/outbox.service.js';
import type { WorkspaceAccessService } from '../../src/common/workspace/workspace-access.service.js';
import type { ChannelCredentialService } from '../../src/modules/channels/channel-credential.service.js';
import type { ProviderRegistry } from '../../src/modules/channels/ProviderRegistry.js';
import type {
  PublishContext,
  PublishResult,
  SocialPublisherPort,
} from '../../src/modules/channels/ports/SocialPublisherPort.js';
import type { MediaService } from '../../src/modules/media/media.service.js';
import { PublicationLedger } from '../../src/modules/publishing/publication-ledger.js';
import {
  loadPublishingConfig,
  type PublishingConfig,
} from '../../src/modules/publishing/publishing.config.js';
import { PublishingService } from '../../src/modules/publishing/publishing.service.js';

/** Real transactional audit: `enqueue` writes `outbox_events` in the caller's transaction. */
export function testAudit(db: PostgresJsDatabase<typeof schema>) {
  return new AuditLogService(
    db,
    {} as WorkspaceAccessService,
    new OutboxService(db),
  );
}

export type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
};

export function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export class ScriptedAdapter implements SocialPublisherPort {
  readonly providerName = 'x';
  readonly capabilities = {
    text: true,
    images: false,
    video: false,
    carousel: false,
    analytics: false,
    nativeScheduling: false,
  };
  calls = 0;
  sent = 0;

  constructor(
    private readonly script: (
      context: PublishContext,
      adapter: ScriptedAdapter,
    ) => Promise<PublishResult>,
  ) {}

  publishPost(_content: string, _token: string, context: PublishContext) {
    this.calls += 1;
    return this.script(context, this);
  }

  /** Marker, then count the simulated external request. */
  async send(context: PublishContext) {
    await context.beforeSideEffect({ operationType: 'test_create_post' });
    this.sent += 1;
  }

  getAuthUrl(): string {
    throw new Error('not used');
  }
  exchangeToken(): Promise<never> {
    throw new Error('not used');
  }
  refreshAccessToken(): Promise<never> {
    throw new Error('not used');
  }
}

export function buildPublishing(
  db: PostgresJsDatabase<typeof schema>,
  adapter: SocialPublisherPort,
  options: {
    config?: Partial<PublishingConfig>;
    credentials?: Partial<ChannelCredentialService>;
    media?: Partial<MediaService>;
  } = {},
) {
  const config = { ...loadPublishingConfig({}), ...options.config };
  const ledger = new PublicationLedger(db, config, testAudit(db));
  const audit = { record: vi.fn(async () => undefined) };
  const service = new PublishingService(
    db,
    { getProvider: () => adapter } as unknown as ProviderRegistry,
    (options.credentials ?? {
      getValidAccessToken: async () => 'token',
    }) as unknown as ChannelCredentialService,
    (options.media ?? {
      getProviderPublishMedia: async () => [],
    }) as unknown as MediaService,
    audit as unknown as AuditLogService,
    ledger,
    config,
  );
  return { service, ledger, audit, config };
}
