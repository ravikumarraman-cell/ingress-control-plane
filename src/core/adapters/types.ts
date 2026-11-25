import { Diagnostic, IngressIR } from '../ir/types';

export interface AdapterCapabilities {
  supportsWeightedCanary: boolean;
  supportsGrpc: boolean;
  supportsMtls: boolean;
  supportsConsistentHash: boolean;
  supportsCustomPlugins: boolean;
}

export interface ProxyAdapter {
  id: string;
  name: string;
  vendor: string;
  format: 'json' | 'yaml' | 'conf';
  fileName: string;
  description: string;
  capabilities: AdapterCapabilities;
  compile: (ir: IngressIR) => string;
  validate: (ir: IngressIR) => Diagnostic[];
}

export class AdapterRegistry {
  private adapters = new Map<string, ProxyAdapter>();

  register(adapter: ProxyAdapter): void {
    this.adapters.set(adapter.id, adapter);
  }

  unregister(id: string): void {
    this.adapters.delete(id);
  }

  get(id: string): ProxyAdapter | undefined {
    return this.adapters.get(id);
  }

  list(): ProxyAdapter[] {
    return Array.from(this.adapters.values());
  }
}
