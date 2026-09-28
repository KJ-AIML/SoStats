import { Injectable, NotFoundException } from '@nestjs/common';
import { SocialPublisherPort } from './ports/SocialPublisherPort.js';
import { LinkedInPublisherAdapter } from './adapters/LinkedInPublisherAdapter.js';

@Injectable()
export class ProviderRegistry {
  private providers = new Map<string, SocialPublisherPort>();

  constructor() {
    // We could inject these, but manual instantiation is simpler for dummy adapters
    this.registerProvider(new LinkedInPublisherAdapter());
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
