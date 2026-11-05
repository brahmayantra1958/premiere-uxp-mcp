import { randomUUID } from 'node:crypto';
import type { HostExecutor } from './host-executor.js';
import type { PathPolicy } from './path-policy.js';
import { captureProgramFrameEvidence } from './program-frame-tools.js';
import { placementCapabilities, placementCapabilityStatus } from './placement-capabilities.js';

/** The public source-range result combines structural and rendered evidence in
 * one durable root lease. A matching model with wrong pixels is UNVERIFIED.
 * Reference hashes must come from independently reviewed expected compositions,
 * never from the newly inserted clip being tested. Audio audition stays separate. */
export async function sourceRangePlacementOperation(host: HostExecutor, paths: PathPolicy, args: Record<string, any>, operationId?: string) {
  const id = operationId ?? randomUUID();
  return host.mutateLocal('place_clips', args, async () => {
    let contentDispatched = false;
    const frames: unknown[] = [];
    let placement: any;
    let discovery: ReturnType<typeof placementCapabilities> | undefined;
    try {
      const p = args.placements?.[0], checks = args.renderChecks ?? [];
      if (args.placements?.length !== 1 || !p?.sourceRange || !args.expectedSequenceName) throw Error('SOURCE_RANGE_REQUIRES_ONE_PLACEMENT_AND_NAMED_TARGET');
      const video = p.expectedMediaTypes?.includes('video');
      if (video && checks.length === 0) throw Error('SOURCE_RANGE_RENDER_REFERENCE_REQUIRED: prepare independent capture_program_frame hashes before video placement');
      const end = p.timeSeconds + p.sourceRange.outPointSeconds - p.sourceRange.inPointSeconds;
      if (checks.some((check: any) => check.timeSeconds < p.timeSeconds || check.timeSeconds >= end)) throw Error('SOURCE_RANGE_RENDER_TIME_OUTSIDE_CLIP');
      const capabilities = await host.read('get_capabilities') as any;
      discovery = placementCapabilities(capabilities);
      if (placementCapabilityStatus(capabilities, 'write', 'sourceRangePlacement') !== 'pass') throw Error('SOURCE_RANGE_PANEL_PROTOCOL_REQUIRED: no edit dispatched; inspect get_agent_context.placementCapabilities or get_capabilities before choosing a supported original-media route; do not reload/deploy during active editing');
      if (video && placementCapabilityStatus(capabilities, 'read', 'programMonitorFrame') !== 'pass') throw Error('SOURCE_RANGE_CAPTURE_UNSUPPORTED');
      const { renderChecks: _checks, ...hostArgs } = args; void _checks;
      contentDispatched = true;
      placement = await host.mutate('place_clips', hostArgs, id + ':place', { timeoutMs: 120_000 });
      if (placement.status !== 'pass') {
        contentDispatched = placement.hostResult?.contentDispatched !== false;
        return { status: contentDispatched ? 'unverified' as const : 'fail' as const, result: { contentDispatched, placement, frames }, errors: placement.errors };
      }
      if (placement.hostResult?.sourceRangeProtocol !== 1 || placement.hostResult?.sourceMarksRestored !== true) throw Error('SOURCE_RANGE_HOST_PROOF_MISSING');
      const placedIds = placement.hostResult.placedItemIds;
      const placed = placement.after?.items?.filter((item: any) => placedIds?.includes(item.id)) ?? [];
      if (!Array.isArray(placedIds) || placedIds.length !== p.expectedMediaTypes.length || new Set(placedIds).size !== placedIds.length || placed.length !== placedIds.length) throw Error('SOURCE_RANGE_FINAL_TARGET_MISSING');
      const pins = { expectedProjectId: args.expectedProjectId, expectedSequenceId: args.expectedSequenceId, expectedSequenceName: args.expectedSequenceName };
      for (const check of checks) {
        const { receipt } = await captureProgramFrameEvidence(host, paths, { ...pins, timeSeconds: check.timeSeconds });
        frames.push(receipt);
        if (receipt.projectId !== pins.expectedProjectId || receipt.sequenceId !== pins.expectedSequenceId || receipt.sequenceName !== pins.expectedSequenceName || receipt.frame.requestedSeconds !== check.timeSeconds
          || placed.some((item: any) => BigInt(receipt.frame.ticks) < BigInt(item.start.ticks) || BigInt(receipt.frame.ticks) >= BigInt(item.end.ticks))) throw Error('SOURCE_RANGE_RENDER_TARGET_CHANGED');
        if (receipt.frame.sha256 !== check.expectedSha256) throw Error('SOURCE_RANGE_RENDER_MISMATCH: program frame differs from the reviewed reference; inspect black/missing/occluded output, never replay');
      }
      const current = await host.read('query_timeline', { ...pins, ids: placed.map((item: any) => item.id), limit: 20 }) as any;
      const signature = (item: any) => JSON.stringify([item.id, item.projectItemId, item.mediaType, item.trackIndex, item.start?.ticks, item.end?.ticks, item.inPoint?.ticks, item.outPoint?.ticks, item.disabled, item.speed, item.reversed]);
      if (current.page?.hasMore || current.page?.scanTruncated || current.items?.length !== placed.length || placed.some((item: any) => !current.items.some((fresh: any) => signature(fresh) === signature(item)))) throw Error('SOURCE_RANGE_CHANGED_DURING_RENDER_PROOF');
      return { status: 'pass' as const, result: { contentDispatched, placement, editability: placement.after?.editability,
        renderVerification: { status: video ? 'pass' : 'not_applicable', scope: 'sampled_composited_frames_only', frames },
        audioVerification: { status: p.expectedMediaTypes?.includes('audio') ? 'unverified' : 'not_applicable', reason: 'Audition or compare exported audio separately' } } };
    } catch (error) {
      return { status: contentDispatched ? 'unverified' as const : 'fail' as const, result: { contentDispatched, placement, ...(discovery ? { placementCapabilities: discovery } : {}), renderVerification: { status: 'unverified', frames } }, errors: [String(error)] };
    }
  }, id);
}
