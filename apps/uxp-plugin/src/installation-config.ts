type Targeting = { port: number; token: string; version: string };
type Deployment = { scratchRoot: string; runtimeLauncher?: string; trackTargeting?: Targeting | null; trackLock?: Targeting | null };
// Local builds and Setup generate the dist sidecar for this installation.
// The distributed source placeholder contains no machine path or credential.
const value = (globalThis as typeof globalThis & { __PREMIERE_MCP_DEPLOYMENT__?: Deployment }).__PREMIERE_MCP_DEPLOYMENT__;
export const deployment: Deployment = value ?? { scratchRoot: '' };
if (deployment.trackTargeting && (deployment.trackTargeting.port !== 8098 ||
  !/^[a-f0-9]{64}$/.test(deployment.trackTargeting.token) ||
  !['0.1.0', '0.1.1', '0.1.2'].includes(deployment.trackTargeting.version))) throw Error('Invalid local track targeting configuration');
if (deployment.trackLock && (deployment.trackLock.port !== 8095 || !/^[a-f0-9]{64}$/.test(deployment.trackLock.token) || deployment.trackLock.version !== '0.1.0')) throw Error('Invalid local track lock configuration');
