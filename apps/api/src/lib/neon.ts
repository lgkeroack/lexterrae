import { neonConfig } from '@neondatabase/serverless';

/**
 * Points the Neon serverless driver at a local Neon proxy (docker-compose `neon-proxy`)
 * instead of Neon's servers. Only used in local development; in production the driver
 * talks to Neon directly using the hostname in DATABASE_URL.
 *
 * @param localProxy host:port of the proxy, e.g. "localhost:4444"
 */
export function useLocalNeonProxy(localProxy: string): void {
  neonConfig.fetchEndpoint = () => `http://${localProxy}/sql`;
  neonConfig.wsProxy = () => `${localProxy}/v2`;
  neonConfig.useSecureWebSocket = false;
  neonConfig.pipelineTLS = false;
  neonConfig.pipelineConnect = false;
}
