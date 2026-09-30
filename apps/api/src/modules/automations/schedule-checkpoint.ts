import { ServiceUnavailableException } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema.js';

type StepLogs = Record<string, unknown> & {
  checkpoint?: Record<string, unknown>;
};

function parseLogs(value: string | null | undefined): StepLogs {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as StepLogs) : {};
  } catch {
    return {};
  }
}

/**
 * First writer wins, so concurrent executions of one schedule step compute
 * identical scheduled_at values (spec 32A §5.2, D3).
 */
export async function claimScheduleStartAt(
  db: PostgresJsDatabase<typeof schema>,
  step: { id: number; logs: string | null },
  proposed: Date,
): Promise<{ startAt: Date; logs: string }> {
  const steps = schema.automationRunSteps;
  const log = parseLogs(step.logs);
  const logs = JSON.stringify({
    ...log,
    checkpoint: { ...log.checkpoint, startAt: proposed.toISOString() },
  });

  const [written] = await db
    .update(steps)
    .set({ logs })
    .where(
      and(
        eq(steps.id, step.id),
        step.logs === null ? isNull(steps.logs) : eq(steps.logs, step.logs),
      ),
    )
    .returning({ id: steps.id });
  if (written) return { startAt: proposed, logs };

  const [latest] = await db
    .select({ logs: steps.logs })
    .from(steps)
    .where(eq(steps.id, step.id));
  const winner = parseLogs(latest?.logs).checkpoint?.startAt;
  if (
    typeof winner !== 'string' ||
    Number.isNaN(new Date(winner).getTime()) ||
    !latest?.logs
  ) {
    throw new ServiceUnavailableException(
      'Schedule step checkpoint changed concurrently; retry the step',
    );
  }
  return { startAt: new Date(winner), logs: latest.logs };
}
