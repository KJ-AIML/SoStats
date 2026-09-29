import { describe, expect, it } from 'vitest';
import { isPublicKnowledgeAddress } from './safe-knowledge-fetch.js';

describe('knowledge URL public-network policy', () => {
  it('rejects private and documentation IPv4 networks', () => {
    for (const address of [
      '10.0.0.1',
      '127.0.0.1',
      '169.254.10.20',
      '172.16.0.1',
      '192.168.1.2',
      '192.0.2.10',
      '198.51.100.10',
      '203.0.113.10',
    ]) {
      expect(isPublicKnowledgeAddress(address)).toBe(false);
    }
    expect(isPublicKnowledgeAddress('8.8.8.8')).toBe(true);
  });

  it('rejects local, mapped and documentation IPv6 addresses', () => {
    expect(isPublicKnowledgeAddress('::1')).toBe(false);
    expect(isPublicKnowledgeAddress('::ffff:127.0.0.1')).toBe(false);
    expect(isPublicKnowledgeAddress('fd00::1')).toBe(false);
    expect(isPublicKnowledgeAddress('fe80::1')).toBe(false);
    expect(isPublicKnowledgeAddress('2001:db8::1')).toBe(false);
    expect(isPublicKnowledgeAddress('2606:4700:4700::1111')).toBe(true);
  });
});
