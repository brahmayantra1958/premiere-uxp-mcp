import type { HostExecutor } from './host-executor.js';
import { placementCapabilities } from './placement-capabilities.js';

/** Server-side enrichment also works with older panels. This performs only
 * serial discovery reads; no placement, recovery, save, build or Reload. */
export async function agentContextWithPlacement(host: Pick<HostExecutor, 'read'>, args: Record<string, unknown>) {
  const context = await host.read('get_agent_context', args) as Record<string, unknown>;
  if (context.status !== 'ready') return { ...context, placementCapabilities: placementCapabilities(undefined, 'Context is not ready; query capabilities after opening the intended target') };
  try {
    const capabilities = await host.read('get_capabilities');
    return { ...context, placementCapabilities: placementCapabilities(capabilities) };
  } catch (error) {
    // Preserve useful project/sequence discovery when optional capability
    // observation fails, but never turn that failure into supported/fallback.
    return { ...context, placementCapabilities: placementCapabilities(undefined, String(error)) };
  }
}
