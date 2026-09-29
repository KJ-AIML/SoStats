import { createHash } from 'crypto';

type JsonObject = Record<string, unknown>;

export type NormalizedWebhookItem = {
  externalId: string;
  title?: string;
  link?: string;
  publishedAt?: string;
  summary?: string;
  status?: string;
  postType?: string;
};

function asObject(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function text(value: unknown, max = 12_000): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

function rendered(value: unknown, max = 12_000) {
  if (typeof value === 'string') return text(value, max);
  const object = asObject(value);
  return text(object.rendered, max);
}

function decodeEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

function plain(value?: string, max = 12_000) {
  if (!value) return undefined;
  const normalized = decodeEntities(value)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized ? normalized.slice(0, max) : undefined;
}

function scalarId(value: unknown) {
  if (typeof value === 'string') return text(value, 1024);
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function stableFallback(rawBody: Buffer) {
  return createHash('sha256').update(rawBody).digest('hex');
}

export function normalizeWebhookPayload(input: {
  sourceType: 'generic' | 'wordpress';
  body: unknown;
  rawBody: Buffer;
  eventId?: string;
}): NormalizedWebhookItem {
  const root = asObject(input.body);
  const data = asObject(root.data);
  const post =
    Object.keys(asObject(root.post)).length > 0
      ? asObject(root.post)
      : Object.keys(data).length > 0
        ? data
        : root;

  if (input.sourceType === 'wordpress') {
    const id =
      post.id ??
      post.ID ??
      root.post_id ??
      root.id;
    const title = plain(rendered(post.title, 1000), 1000);
    const link =
      text(post.link, 2048) ||
      text(post.permalink, 2048) ||
      text(post.url, 2048);
    const publishedAt =
      text(post.date_gmt, 100) ||
      text(post.date, 100) ||
      text(post.publishedAt, 100) ||
      text(root.publishedAt, 100);
    const excerpt = plain(rendered(post.excerpt), 12_000);
    const content = plain(rendered(post.content), 12_000);
    const status = text(post.status, 100);
    const postType =
      text(post.type, 100) ||
      text(root.post_type, 100);

    const externalId =
      text(input.eventId, 1024) ||
      (id !== undefined && id !== null
        ? `wordpress:${scalarId(id)?.slice(0, 255) || 'unknown'}:${publishedAt || ''}`
        : stableFallback(input.rawBody));

    return {
      externalId,
      title,
      link,
      publishedAt,
      summary: excerpt || content,
      status,
      postType,
    };
  }

  const externalId =
    text(input.eventId, 1024) ||
    text(root.externalId, 1024) ||
    text(root.eventId, 1024) ||
    scalarId(root.id) ||
    stableFallback(input.rawBody);

  return {
    externalId,
    title:
      plain(rendered(root.title, 1000), 1000) ||
      plain(text(root.name, 1000), 1000),
    link:
      text(root.link, 2048) ||
      text(root.url, 2048),
    publishedAt:
      text(root.publishedAt, 100) ||
      text(root.published_at, 100) ||
      text(root.date, 100),
    summary:
      plain(rendered(root.summary), 12_000) ||
      plain(rendered(root.excerpt), 12_000) ||
      plain(rendered(root.content), 12_000) ||
      plain(text(root.description), 12_000),
    status: text(root.status, 100),
    postType: text(root.type, 100),
  };
}
