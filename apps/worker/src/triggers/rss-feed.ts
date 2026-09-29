function decodeXml(value: string) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#([0-9]+);/g, (_, decimal: string) =>
      String.fromCodePoint(Number.parseInt(decimal, 10)),
    )
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&amp;/gi, '&');
}

function stripMarkup(value: string) {
  return decodeXml(value.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function elementBlocks(xml: string, tag: string) {
  const expression = new RegExp(
    `<(?:[A-Za-z0-9_-]+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:[A-Za-z0-9_-]+:)?${tag}>`,
    'gi',
  );
  return [...xml.matchAll(expression)].map((match) => match[1]);
}

function tagText(block: string, names: string[]) {
  for (const name of names) {
    const expression = new RegExp(
      `<(?:[A-Za-z0-9_-]+:)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:[A-Za-z0-9_-]+:)?${name}>`,
      'i',
    );
    const match = expression.exec(block);
    if (match?.[1]) return stripMarkup(match[1]);
  }
  return undefined;
}

function atomLink(block: string) {
  const links = [...block.matchAll(/<link\b([^>]*)\/?\s*>/gi)];
  for (const match of links) {
    const attrs = match[1] || '';
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1];
    const rel = /\brel\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1];
    if (href && (!rel || rel === 'alternate')) return decodeXml(href);
  }
  return links
    .map((match) =>
      /\bhref\s*=\s*["']([^"']+)["']/i.exec(match[1] || '')?.[1],
    )
    .find(Boolean);
}

function normalizedDate(value?: string) {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value.slice(0, 100) : parsed.toISOString();
}

export type ParsedFeedEntry = {
  externalId: string;
  title?: string;
  link?: string;
  publishedAt?: string;
  summary?: string;
};

export type ParsedFeed = {
  title?: string;
  entries: ParsedFeedEntry[];
};

export function parseRssOrAtom(xml: string): ParsedFeed {
  const source = xml.trim();
  if (!/<(?:rss|feed|rdf:RDF)\b/i.test(source)) {
    throw new Error('Response is not an RSS or Atom feed');
  }

  const rssItems = elementBlocks(source, 'item');
  const atomEntries = rssItems.length ? [] : elementBlocks(source, 'entry');
  const blocks = rssItems.length ? rssItems : atomEntries;
  const isAtom = !rssItems.length && atomEntries.length > 0;

  const firstEntryIndex = blocks.length ? source.indexOf(blocks[0]) : source.length;
  const header = source.slice(0, Math.max(0, firstEntryIndex));
  const title = tagText(header, ['title']);

  const entries: ParsedFeedEntry[] = [];
  for (const block of blocks.slice(0, 50)) {
    const itemTitle = tagText(block, ['title']);
    const link = isAtom ? atomLink(block) : tagText(block, ['link']);
    const publishedAt = normalizedDate(
      tagText(block, isAtom ? ['published', 'updated'] : ['pubDate', 'date']),
    );
    const summary = tagText(
      block,
      isAtom ? ['summary', 'content'] : ['description', 'encoded', 'content'],
    );
    const explicitId = tagText(block, isAtom ? ['id'] : ['guid', 'id']);
    const externalId =
      explicitId || link || [itemTitle, publishedAt].filter(Boolean).join('|');

    if (!externalId) continue;
    entries.push({
      externalId: externalId.slice(0, 1024),
      title: itemTitle?.slice(0, 1000),
      link: link?.slice(0, 2048),
      publishedAt,
      summary: summary?.slice(0, 12_000),
    });
  }

  return { title, entries };
}
