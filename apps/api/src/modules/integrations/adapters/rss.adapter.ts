import { IntegrationAdapter } from './integration-adapter.interface.js';

export class RSSAdapter implements IntegrationAdapter {
  type = 'rss';

  async connect(config: any): Promise<boolean> {
    // dummy implementation
    console.log('Connecting to RSS with config:', config);
    return true;
  }

  async disconnect(): Promise<boolean> {
    // dummy implementation
    console.log('Disconnecting from RSS');
    return true;
  }

  async fetchData(_params: any): Promise<any> {
    return { items: [] };
  }
}
