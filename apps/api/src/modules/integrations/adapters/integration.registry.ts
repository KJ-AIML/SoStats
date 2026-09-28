import { Injectable } from '@nestjs/common';
import { IntegrationAdapter } from './integration-adapter.interface.js';
import { WordPressAdapter } from './wordpress.adapter.js';
import { RSSAdapter } from './rss.adapter.js';

@Injectable()
export class IntegrationRegistry {
  private adapters: Map<string, IntegrationAdapter> = new Map();

  constructor() {
    this.registerAdapter(new WordPressAdapter());
    this.registerAdapter(new RSSAdapter());
  }

  registerAdapter(adapter: IntegrationAdapter) {
    this.adapters.set(adapter.type, adapter);
  }

  getAdapter(type: string): IntegrationAdapter {
    const adapter = this.adapters.get(type);
    if (!adapter) {
      throw new Error(`Integration adapter for type ${type} not found`);
    }
    return adapter;
  }
}
