import { Injectable, NotFoundException } from '@nestjs/common';
import { SocialPublisherPort } from './ports/SocialPublisherPort.js';
import { SocialAnalyticsPort } from './ports/SocialAnalyticsPort.js';
import { LinkedInPublisherAdapter } from './adapters/LinkedInPublisherAdapter.js';

type SocialProviderAdapter = SocialPublisherPort & Partial<SocialAnalyticsPort>;

@Injectable()
export class ProviderRegistry {
  private readonly providers = new Map<string, SocialProviderAdapter>();

  constructor(linkedIn: LinkedInPublisherAdapter) {
    this.registerProvider(linkedIn);
  }

  registerProvider(provider: SocialProviderAdapter) {
    this.providers.set(provider.providerName, provider);
  }

  hasProvider(providerName: string) {
    return this.providers.has(providerName);
  }

  getProvider(providerName: string): SocialPublisherPort {
    const provider = this.providers.get(providerName);
    if (!provider) {
      throw new NotFoundException(`Provider '${providerName}' not supported`);
    }
    return provider;
  }

  getAnalyticsProvider(providerName: string): SocialAnalyticsPort {
    const provider = this.providers.get(providerName);
    if (!provider || typeof provider.fetchPostMetrics !== 'function') {
      throw new NotFoundException(
        `Provider '${providerName}' does not support analytics ingestion`,
      );
    }
    return provider as SocialAnalyticsPort;
  }

  describeProvider(providerName: string) {
    const provider = this.providers.get(providerName);
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
}
