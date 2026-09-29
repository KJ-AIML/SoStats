const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRssOrAtom } = require('../dist/triggers/rss-feed.js');
const { isPublicAddress } = require('../dist/triggers/safe-feed-fetch.js');

test('parses RSS 2.0 entries', () => {
  const feed = parseRssOrAtom(`<?xml version="1.0"?>
    <rss version="2.0"><channel>
      <title>SoStats Blog</title>
      <item>
        <guid>post-2</guid>
        <title><![CDATA[Launch &amp; Learn]]></title>
        <link>https://example.com/post-2</link>
        <pubDate>Mon, 28 Sep 2026 10:00:00 GMT</pubDate>
        <description><![CDATA[<p>Evidence-driven content.</p>]]></description>
      </item>
    </channel></rss>`);

  assert.equal(feed.title, 'SoStats Blog');
  assert.deepEqual(feed.entries[0], {
    externalId: 'post-2',
    title: 'Launch & Learn',
    link: 'https://example.com/post-2',
    publishedAt: '2026-09-28T10:00:00.000Z',
    summary: 'Evidence-driven content.',
  });
});

test('parses Atom alternate links and ids', () => {
  const feed = parseRssOrAtom(`<feed>
    <title>Updates</title>
    <entry>
      <id>tag:example.com,2026:1</id>
      <title>New release</title>
      <link rel="alternate" href="https://example.com/release" />
      <updated>2026-09-29T02:00:00Z</updated>
      <summary>Release notes</summary>
    </entry>
  </feed>`);

  assert.equal(feed.entries[0].externalId, 'tag:example.com,2026:1');
  assert.equal(feed.entries[0].link, 'https://example.com/release');
});

test('rejects private and reserved network addresses', () => {
  assert.equal(isPublicAddress('10.0.0.1'), false);
  assert.equal(isPublicAddress('127.0.0.1'), false);
  assert.equal(isPublicAddress('169.254.1.5'), false);
  assert.equal(isPublicAddress('192.168.1.5'), false);
  assert.equal(isPublicAddress('::1'), false);
  assert.equal(isPublicAddress('2001:db8::1'), false);
  assert.equal(isPublicAddress('8.8.8.8'), true);
});
