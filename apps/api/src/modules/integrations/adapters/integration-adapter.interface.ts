export interface IntegrationAdapter {
  type: string;
  connect(config: any): Promise<boolean>;
  disconnect(): Promise<boolean>;
  fetchData?(params: any): Promise<any>;
  pushData?(data: any): Promise<any>;
}
