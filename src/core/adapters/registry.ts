import { envoyAdapter } from './envoy';
import { k8sGatewayAdapter } from './k8sGateway';
import { nginxAdapter } from './nginx';
import { traefikAdapter } from './traefik';
import { AdapterRegistry } from './types';

export const adapterRegistry = new AdapterRegistry();

adapterRegistry.register(envoyAdapter);
adapterRegistry.register(nginxAdapter);
adapterRegistry.register(traefikAdapter);
adapterRegistry.register(k8sGatewayAdapter);

export type { AdapterCapabilities, ProxyAdapter } from './types';
export { AdapterRegistry } from './types';
