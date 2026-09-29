import { Injectable, NotFoundException } from '@nestjs/common';
import { SocialPublisherPort } from './ports/SocialPublisherPort.js';
import { SocialAnalyticsPort } from './ports/SocialAnalyticsPort.js';
import { LinkedInPublisherAdapter } from './adapters/LinkedInPublisherAdapter.js';
import { XPublisherAdapter } from './adapters/XPublisherAdapter.js';
import { FacebookPublisherAdapter } from './adapters/FacebookPublisherAdapter.js';
import { InstagramPublisherAdapter } from './adapters/InstagramPublisherAdapter.js';

type SocialProviderAdapter = SocialPublisherPort & Partial<SocialAnalyticsPort>;

function normalizeProvider(providerName: string) {
  const value = providerName.trim().toLowerCase();
  return value === 'twitter' ? 'x' : value;
}

@Injectable()
export class ProviderRegistry {
  private readonly providers = new Map<string, SocialProviderAdapter>();

  constructor(
    linkedIn: LinkedInPublisherAdapter,
    x: XPublisherAdapter,
    facebook: FacebookPublisherAdapter,
    instagram: InstagramPublisherAdapter,
  ) {
    this.registerProvider(linkedIn);
    this.registerProvider(x);
    this.registerProvider(facebook);
    this.registerProvider(instagram);
  }

  registerProvider(provider: SocialProviderAdapter) {
    this.providers.set(provider.providerName, provider);
  }

  hasProvider(providerName: string) {
    return this.providers.has(normalizeProvider(providerName));
  }

  getProvider(providerName: string): SocialPublisherPort {
    const normalized = normalizeProvider(providerName);
    const provider = this.providers.get(normalized);
    if (!provider) {
      throw new NotFoundException(`Provider '${providerName}' not supported`);
    }
    return provider;
  }

  getAnalyticsProvider(providerName: string): SocialAnalyticsPort {
    const normalized = normalizeProvider(providerName);
    const provider = this.providers.get(normalized);
    if (!provider || typeof provider.fetchPostMetrics !== 'function') {
      throw new NotFoundException(
        `Provider '${providerName}' does not support analytics ingestion`,
      );
    }
    return provider as SocialAnalyticsPort;
  }

  describeProvider(providerName: string) {
    const provider = this.providers.get(normalizeProvider(providerName));
    if (!provider) {
      return {
        supported: false,
        capabilities: null,
      };
    }

    return {
      supported: true,
      capabilities: provider.capabilities,
    };
  }

  listProviders() {
    return [...this.providers.values()].map((provider) => ({
      provider: provider.providerName,
      capabilities: provider.capabilities,
    }));
  }
}
