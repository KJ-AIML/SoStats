import {
  createHmac,
  timingSafeEqual,
} from 'crypto';

export type WebhookVerification =
  | { ok: true; timestamp: number }
  | { ok: false; reason: string };

export function signWebhookPayload(
  secret: string,
  timestamp: string,
  eventName: string,
  eventId: string,
  rawBody: Buffer,
) {
  return createHmac('sha256', secret)
    .update(timestamp, 'utf8')
    .update('.', 'utf8')
    .update(eventName, 'utf8')
    .update('.', 'utf8')
    .update(eventId, 'utf8')
    .update('.', 'utf8')
    .update(rawBody)
    .digest('hex');
}

export function verifyWebhookSignature(input: {
  secret: string;
  timestamp?: string;
  signature?: string;
  eventName?: string;
  eventId?: string;
  rawBody: Buffer;
  nowMs?: number;
  toleranceSeconds?: number;
}): WebhookVerification {
  const timestamp = String(input.timestamp || '').trim();
  const signature = String(input.signature || '')
    .trim()
    .replace(/^sha256=/i, '');
  const eventName = String(input.eventName || '').trim();
  const eventId = String(input.eventId || '').trim();

  if (!/^\d{10,13}$/.test(timestamp)) {
    return { ok: false, reason: 'Webhook timestamp is missing or invalid' };
  }
  if (!/^[a-f0-9]{64}$/i.test(signature)) {
    return { ok: false, reason: 'Webhook signature is missing or invalid' };
  }
  if (
    !eventName ||
    eventName.length > 100 ||
    !/^[a-z0-9][a-z0-9._:-]*$/i.test(eventName)
  ) {
    return { ok: false, reason: 'Webhook event name is missing or invalid' };
  }
  if (!eventId || eventId.length > 1024) {
    return { ok: false, reason: 'Webhook event id is missing or invalid' };
  }

  const rawTimestamp = Number(timestamp);
  const timestampMs =
    timestamp.length === 13 ? rawTimestamp : rawTimestamp * 1000;
  const nowMs = input.nowMs ?? Date.now();
  const toleranceMs = (input.toleranceSeconds ?? 300) * 1000;

  if (
    !Number.isFinite(timestampMs) ||
    Math.abs(nowMs - timestampMs) > toleranceMs
  ) {
    return { ok: false, reason: 'Webhook timestamp is outside the allowed window' };
  }

  const expected = Buffer.from(
    signWebhookPayload(
      input.secret,
      timestamp,
      eventName,
      eventId,
      input.rawBody,
    ),
    'hex',
  );
  const provided = Buffer.from(signature, 'hex');

  if (
    expected.length !== provided.length ||
    !timingSafeEqual(expected, provided)
  ) {
    return { ok: false, reason: 'Webhook signature does not match' };
  }

  return { ok: true, timestamp: timestampMs };
}
