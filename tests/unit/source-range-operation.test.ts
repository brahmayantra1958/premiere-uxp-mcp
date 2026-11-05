import { afterEach, expect, it, vi } from 'vitest';
import path from 'node:path';
import { sourceRangePlacementOperation } from '../../apps/mcp-server/src/source-range-operation.js';
import * as capture from '../../apps/mcp-server/src/program-frame-tools.js';
import { HostExecutor } from '../../apps/mcp-server/src/host-executor.js';
import { AuditLog, ReceiptStore } from '../../apps/mcp-server/src/audit.js';
import { freshTestDirectory } from '../helpers/workspace.js';
import recordedCapabilities from '../fixtures/placement-capabilities-20261103.json';

const args = { expectedProjectId: 'p', expectedSequenceId: 's', expectedSequenceName: 'Sequence', placements: [{ projectItemId: 'original', timeSeconds: 10, videoTrackIndex: 0, audioTrackIndex: 0, mode: 'overwrite', requireEmpty: true, expectedMediaTypes: ['video'], sourceRange: { inPointSeconds: 2, outPointSeconds: 5 } }], renderChecks: [{ timeSeconds: 11, expectedSha256: 'a'.repeat(64) }] };
function fixture(fault = '') {
  const items = [{ id: 'video:0:start:original', projectItemId: 'original', mediaType: 'video', trackIndex: 0, start: { seconds: 10, ticks: '2540160000000' }, end: { ticks: '3302208000000' }, inPoint: { ticks: '508032000000' }, outPoint: { ticks: '1270080000000' } }];
  const placement = { status: fault === 'preflight' ? 'fail' : fault === 'apply' ? 'unverified' : 'pass', hostResult: { sourceRangeProtocol: 1, sourceMarksRestored: true, placedItemIds: items.map(item => item.id), contentDispatched: fault !== 'preflight' }, after: { items, editability: [{ handles: { headSeconds: 2, tailSeconds: 7 } }] }, errors: ['fixture'] };
  const read = vi.fn(async (command?: string) => command === 'query_timeline' ? { items: fault === 'late-edit' ? [] : items, page: {} } : { premiereVersion: '26.5.0', uxpVersion: '8.0', runtimeCompatibility: { status: 'compatible', requiredPremiereVersion: '26.3.0' }, hostContext: { activeProject: true, activeSequence: true }, unsupported: [], write: [{ name: 'sourceRangePlacement', supported: fault !== 'old-panel' }], read: [{ name: 'programMonitorFrame', supported: true }] });
  const mutate = vi.fn(async () => placement);
  const frame = vi.spyOn(capture, 'captureProgramFrameEvidence').mockImplementation(async () => {
    if (fault === 'capture') throw Error('frame unavailable');
    return { bytes: Buffer.alloc(0), receipt: { projectId: fault === 'target' ? 'changed' : 'p', sequenceId: 's', sequenceName: 'Sequence', frame: { requestedSeconds: 11, timeSeconds: 11, ticks: '2794176000000', sha256: fault === 'black' ? '0'.repeat(64) : 'a'.repeat(64) } } };
  });
  const host = { read, mutate, mutateLocal: vi.fn(async (_command: any, _args: any, run: () => Promise<any>) => run()) };
  return { host, read, mutate, frame, placement };
}
afterEach(() => vi.restoreAllMocks());
it('requires a reviewed frame reference before dispatching a video source range', async () => {
  const f = fixture(); const r = await sourceRangePlacementOperation(f.host as any, {} as any, { ...args, renderChecks: undefined }, 'root');
  expect(r).toMatchObject({ status: 'fail', result: { contentDispatched: false } }); expect(f.mutate).not.toHaveBeenCalled(); expect(f.frame).not.toHaveBeenCalled();
});
it.each(['old-panel', 'preflight', 'apply', 'capture', 'black', 'target', 'late-edit'])('preserves dispatch and render proof boundaries for %s', async fault => {
  const f = fixture(fault); const r = await sourceRangePlacementOperation(f.host as any, {} as any, args, 'root');
  expect(r.status).toBe(['old-panel', 'preflight'].includes(fault) ? 'fail' : 'unverified');
  expect(f.mutate).toHaveBeenCalledTimes(fault === 'old-panel' ? 0 : 1);
  expect(f.frame).toHaveBeenCalledTimes(['old-panel', 'preflight', 'apply'].includes(fault) ? 0 : 1);
});
it('returns sampled render proof with handles only after the frame matches', async () => {
  const f = fixture(); const r = await sourceRangePlacementOperation(f.host as any, {} as any, args, 'root');
  expect(r).toMatchObject({ status: 'pass', result: { editability: [{ handles: { headSeconds: 2, tailSeconds: 7 } }], renderVerification: { status: 'pass' } } });
  expect(f.mutate).toHaveBeenCalledExactlyOnceWith('place_clips', expect.not.objectContaining({ renderChecks: expect.anything() }), 'root:place', { timeoutMs: 120_000 });
});
it('correlates placed IDs and exact ticks even when the seconds view rounds differently', async () => {
  const f = fixture(); f.placement.after.items[0].start.seconds = 10.000000000000002;
  expect((await sourceRangePlacementOperation(f.host as any, {} as any, args, 'root')).status).toBe('pass');
});
it('retains audio audition as unverified without pretending a frame proves sound', async () => {
  const f = fixture(); const request = structuredClone(args); request.placements[0].expectedMediaTypes = ['audio']; request.renderChecks = [];
  expect(await sourceRangePlacementOperation(f.host as any, {} as any, request, 'root')).toMatchObject({ status: 'pass', result: { renderVerification: { status: 'not_applicable' }, audioVerification: { status: 'unverified' } } });
  expect(f.frame).not.toHaveBeenCalled();
});
it('uses the real durable root lease: a black-frame failure locks later writes and a replay never places again', async () => {
  const f = fixture('black');
  const directory = await freshTestDirectory('source-range-operation-lease');
  const receipts = new ReceiptStore(path.join(directory, 'idempotency.json'));
  const requests: string[] = [];
  const bridge = { call: async (request: any) => { requests.push(request.command); return { version: 1, id: request.id, ok: true, result: request.command === 'get_capabilities' ? await f.read() : f.placement, durationMs: 0 }; } };
  const host = new HostExecutor(bridge as any, new AuditLog(path.join(directory, 'audit.jsonl')), receipts, 5000);
  const r = await sourceRangePlacementOperation(host, {} as any, args, 'real-root');
  expect(r.status).toBe('unverified'); expect(requests.filter(v => v === 'place_clips')).toHaveLength(1);
  expect((await receipts.inspectRecovery())?.commandId).toBe('real-root');
  expect((await sourceRangePlacementOperation(host, {} as any, args, 'real-root')).status).toBe('unverified');
  expect(requests.filter(v => v === 'place_clips')).toHaveLength(1);
  await expect(host.mutate('place_clips', args, 'next-intent')).rejects.toThrow('MUTATION_IN_PROGRESS_OR_UNVERIFIED');
});
it('reproduces the reported audio preflight using the recorded catalog without mutation or quarantine', async () => {
  const directory = await freshTestDirectory('source-range-discovery-preflight');
  const receipts = new ReceiptStore(path.join(directory, 'idempotency.json'));
  const calls: any[] = [];
  const bridge = {call: async (request: any) => {calls.push(request); return {version: 1, id: request.id, ok: true, result: recordedCapabilities, durationMs: 0};}};
  const host = new HostExecutor(bridge as any, new AuditLog(path.join(directory, 'audit.jsonl')), receipts, 5000);
  const request = {...args, placements: [{...args.placements[0], timeSeconds: 23.2, audioTrackIndex: 3, expectedMediaTypes: ['audio'], sourceRange: {inPointSeconds: 0.2, outPointSeconds: 2.4}}], renderChecks: undefined};
  const result = await sourceRangePlacementOperation(host, {} as any, request, 'recorded-audio-preflight');
  expect(result).toMatchObject({status: 'fail', hostResult: {contentDispatched: false, placementCapabilities: {sourceRange: {status: 'unsupported'}, fullOriginalThenExactTrim: {status: 'pass', automatic: false}}}});
  expect(result.errors[0]).toContain('SOURCE_RANGE_PANEL_PROTOCOL_REQUIRED');
  expect(calls.map(call => call.command)).toEqual(['get_capabilities']);
  expect(await receipts.inspectRecovery()).toBeUndefined();
});
