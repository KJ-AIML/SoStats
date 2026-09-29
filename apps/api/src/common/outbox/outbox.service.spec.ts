import { describe, expect, it, vi } from 'vitest';
import { OutboxService } from './outbox.service.js';

function auditInsertChain() {
  const onConflictDoNothing = vi.fn().mockResolvedValue(undefined);
  const values = vi.fn().mockReturnValue({ onConflictDoNothing });
  const insert = vi.fn().mockReturnValue({ values });
  return { insert, values, onConflictDoNothing };
}

function updateChain() {
  const where = vi.fn().mockResolvedValue(undefined);
  const set = vi.fn().mockReturnValue({ where });
  return { update: vi.fn().mockReturnValue({ set }), set, where };
}

describe('OutboxService', () => {
  it('materializes an audit event once and marks the outbox row completed', async () => {
    const now = new Date();
    const event = {
      id: 7,
      workspaceId: 77,
      topic: 'audit.append',
      dedupeKey: 'audit:ownership:77:7',
      payload: {
        workspaceId: 77,
        actorUserId: 10,
        actorEmail: 'owner@example.com',
        authMethod: 'jwt',
        apiKeyId: null,
        action: 'workspace.ownership_transferred',
        targetType: 'workspace_member',
        targetId: '2',
        metadata: { newOwnerUserId: 20 },
      },
      status: 'processing',
      attempts: 0,
      availableAt: now,
      leaseToken: 'lease-123',
      leaseExpiresAt: new Date(Date.now() + 60_000),
      processedAt: null,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    };

    const auditInsert = auditInsertChain();
    const txUpdate = updateChain();
    const tx = {
      query: {
        outboxEvents: {
          findFirst: vi.fn().mockResolvedValue(event),
        },
      },
      insert: auditInsert.insert,
      update: txUpdate.update,
    };
    const transaction = vi.fn(
      async (callback: (value: typeof tx) => unknown) => callback(tx),
    );
    const db = {
      query: {
        outboxEvents: {
          findFirst: vi.fn().mockResolvedValue(event),
        },
      },
      transaction,
    };

    const service = new OutboxService(db as never);
    await expect(service.execute(7, 'lease-123')).resolves.toEqual({
      status: 'completed',
      outboxEventId: 7,
    });

    expect(auditInsert.values).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 77,
        sourceOutboxEventId: 7,
        action: 'workspace.ownership_transferred',
        targetType: 'workspace_member',
        targetId: '2',
        metadata: { newOwnerUserId: 20 },
      }),
    );
    expect(txUpdate.set).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'completed',
        leaseToken: null,
        leaseExpiresAt: null,
      }),
    );
  });

  it('acknowledges an already completed event after response loss', async () => {
    const transaction = vi.fn();
    const service = new OutboxService({
      query: {
        outboxEvents: {
          findFirst: vi.fn().mockResolvedValue({
            id: 7,
            status: 'completed',
          }),
        },
      },
      transaction,
    } as never);

    await expect(service.execute(7, 'old-lease')).resolves.toEqual({
      status: 'completed',
      outboxEventId: 7,
    });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('rejects a stale lease without running the event handler', async () => {
    const transaction = vi.fn();
    const service = new OutboxService({
      query: {
        outboxEvents: {
          findFirst: vi.fn().mockResolvedValue({
            id: 7,
            status: 'processing',
            leaseToken: 'new-lease',
            leaseExpiresAt: new Date(Date.now() + 60_000),
          }),
        },
      },
      transaction,
    } as never);

    await expect(service.execute(7, 'old-lease')).resolves.toEqual({
      status: 'stale_lease',
      outboxEventId: 7,
    });
    expect(transaction).not.toHaveBeenCalled();
  });

  it('uses dedupe keys and treats a conflict as an idempotent no-op', async () => {
    const returning = vi.fn().mockResolvedValue([]);
    const onConflictDoNothing = vi.fn().mockReturnValue({ returning });
    const values = vi.fn().mockReturnValue({ onConflictDoNothing });
    const executor = {
      insert: vi.fn().mockReturnValue({ values }),
    };
    const service = new OutboxService({} as never);

    await expect(
      service.enqueue(executor as never, {
        workspaceId: 77,
        topic: 'audit.append',
        dedupeKey: 'audit:event:77:1',
        payload: { safe: true },
      }),
    ).resolves.toBeNull();

    expect(onConflictDoNothing).toHaveBeenCalledTimes(1);
  });
});
