import { IntegrationAdapter } from './integration-adapter.interface.js';

export class WordPressAdapter implements IntegrationAdapter {
  type = 'wordpress';

  async connect(config: any): Promise<boolean> {
    // dummy implementation
    console.log('Connecting to WordPress with config:', config);
    return true;
  }

  async disconnect(): Promise<boolean> {
    // dummy implementation
    console.log('Disconnecting from WordPress');
    return true;
  }

  async fetchData(_params: any): Promise<any> {
    return { posts: [] };
  }

  async pushData(_data: any): Promise<any> {
    return { success: true, postId: '123' };
  }
}
