import { Injectable, NotFoundException } from '@nestjs/common';
import { SocialPublisherPort } from './ports/SocialPublisherPort.js';
import { LinkedInPublisherAdapter } from './adapters/LinkedInPublisherAdapter.js';

@Injectable()
export class ProviderRegistry {
  private readonly providers = new Map<string, SocialPublisherPort>();

  constructor(linkedIn: LinkedInPublisherAdapter) {
    this.registerProvider(linkedIn);
  }

  registerProvider(provider: SocialPublisherPort) {
    this.providers.set(provider.providerName, provider);
  }

  getProvider(providerName: string): SocialPublisherPort {
    const provider = this.providers.get(providerName);
    if (!provider) {
      throw new NotFoundException(`Provider '${providerName}' not supported`);
    }
    return provider;
  }
}
