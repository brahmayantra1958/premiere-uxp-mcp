import { expect, it } from 'vitest';
import { graphicDurationDiagnostics } from '../../apps/uxp-plugin/src/graphic-duration-diagnostics.js';
import { equalSnapshotValue } from '../../apps/uxp-plugin/src/snapshot-equality.js';
import { uxpModules } from '../helpers/uxp-modules.js';

const component = () => [{ componentIndex: 0, matchName: 'AE.ADBE Text', params: [{
  paramIndex: 0, value: 100, timeVarying: false, supportsKeyframes: true,
  keyframes: [], keyframeDetails: [], readStatus: { value: 'pass', animation: 'pass' },
}] }];

it('ignores only object key order and omitted undefined fields, like the existing exact guard', () => {
  const before = [{ a: 1, b: { x: 2 }, absent: undefined }], after = [{ b: { x: 2 }, a: 1 }];
  expect(equalSnapshotValue(before, after)).toBe(true);
  expect(graphicDurationDiagnostics(before, after)).toEqual({ status: 'pass', beforeComponentCount: 1, afterComponentCount: 1, totalDifferences: 0, truncated: false, differences: [] });
});

it.each(['value', 'timeVarying', 'supportsKeyframes', 'readStatus', 'keyframeDetails'] as const)('reports exact %s drift without omitting non-value proof fields', field => {
  const before = component(), after = structuredClone(before);
  const changes = { value: 101, timeVarying: true, supportsKeyframes: false, readStatus: { value: 'pass', animation: 'unverified' }, keyframeDetails: [{ time: { ticks: '1' }, value: 2, interpolation: 'bezier', tangent: { x: 1 } }] };
  Object.assign(after[0]!.params[0]!, { [field]: changes[field] });
  expect(equalSnapshotValue(before, after)).toBe(false);
  const diagnostic = graphicDurationDiagnostics(before, after);
  expect(diagnostic.status).toBe('fail');
  expect(diagnostic.differences.some(difference => difference.path.startsWith('/0/params/0/' + field))).toBe(true);
  expect(before).toEqual(component());
});

it('retains native key ticks, interpolation and tangent paths and JSON-safe scalar evidence', () => {
  const before = [{ params: [{ keyframeDetails: [{ time: { ticks: '100' }, interpolationMode: 3, tangent: { x: 1, y: 2 } }] }] }];
  const after = structuredClone(before); after[0]!.params[0]!.keyframeDetails[0]!.tangent.x = 9;
  expect(graphicDurationDiagnostics(before, after).differences).toEqual([{ path: '/0/params/0/keyframeDetails/0/tangent/x', before: 1, after: 9 }]);
  expect(graphicDurationDiagnostics([{ value: NaN }], [{ value: Infinity }]).differences).toEqual([{ path: '/0/value', before: { type: 'number', value: 'NaN' }, after: { type: 'number', value: 'Infinity' } }]);
});

it('keeps array order significant and exposes topology additions as bounded summaries', () => {
  const before = [{ matchName: 'Motion' }, { matchName: 'Text' }];
  expect(graphicDurationDiagnostics(before, [...before].reverse()).differences.map(d => d.path)).toEqual(['/0/matchName', '/1/matchName']);
  const added = graphicDurationDiagnostics([], [{ params: Array.from({ length: 500 }, () => ({ value: 'x'.repeat(500) })) }]);
  expect(added.differences).toEqual([{ path: '/length', before: 0, after: 1 }, { path: '/0', before: { type: 'undefined' }, after: { type: 'object', fields: 1 } }]);
  expect(JSON.stringify(added).length).toBeLessThan(500);
});

it('caps retained paths at 32 while counting all differences and bounding large text', () => {
  const before = Array.from({ length: 50 }, (_, i) => ({ value: String(i) }));
  const after = before.map(() => ({ value: 'x'.repeat(10000) }));
  const diagnostic = graphicDurationDiagnostics(before, after);
  expect(diagnostic).toMatchObject({ status: 'fail', totalDifferences: 50, truncated: true });
  expect(diagnostic.differences).toHaveLength(32);
  expect(diagnostic.differences[0]!.after).toEqual({ type: 'string', prefix: 'x'.repeat(256), length: 10000, truncated: true });
  expect(JSON.stringify(diagnostic).length).toBeLessThan(13000);
});

it('escapes JSON pointer keys and bounds an oversized path without hiding its truncation', () => {
  expect(graphicDurationDiagnostics([{ 'a/b~c': 1 }], [{ 'a/b~c': 2 }]).differences[0]!.path).toBe('/0/a~1b~0c');
  const key = 'x'.repeat(1000), result = graphicDurationDiagnostics([{ [key]: 1 }], [{ [key]: 2 }]);
  expect(result.differences[0]!.path).toHaveLength(512); expect(result.differences[0]!.pathLength).toBe(1003);
});

it('returns metadata drift evidence from the real insertion path while retaining its failure and one duration write', async () => {
  const ticksPerSecond = 254016000000, time = (seconds: number) => ({ seconds, ticks: String(Math.round(seconds * ticksPerSecond)) });
  let inserts = 0, trims = 0, valueReads = 0;
  const items: Array<{ end: number }> = [];
  const wrapper = (item: { end: number }) => ({
    getProjectItem: () => null, getName: () => 'Graphic', getStartTime: () => time(0), getEndTime: () => time(item.end),
    getInPoint: () => time(3600), getOutPoint: () => time(3600 + item.end), isDisabled: () => false, getSpeed: () => 1, isSpeedReversed: () => false, isAdjustmentLayer: () => false,
    getComponentChain: async () => ({ getComponentCount: () => 1, getComponentAtIndex: () => ({
      getParamCount: () => 1, getDisplayName: async () => 'Graphic', getMatchName: async () => 'AE.ADBE Graphic Group',
      getParam: () => ({ displayName: 'Amount', getValueAtTime: async () => { valueReads++; return { value: 100 }; },
        isTimeVarying: () => false, areKeyframesSupported: async () => trims === 0, getKeyframeListAsTickTimes: () => [] }),
    }) }),
    createSetEndAction: (end: { seconds: number }) => () => { item.end = end.seconds; trims++; },
  });
  const sequence = { guid: 's', name: 'S', getTimebase: () => String(ticksPerSecond / 24),
    getSettings: () => ({ getVideoFrameRect: () => ({ width: 1920, height: 1080 }), getVideoFrameRate: () => ({ value: 24 }) }),
    getVideoTrackCount: () => 1, getAudioTrackCount: () => 1, getCaptionTrackCount: () => 0, getEndTime: () => time(5),
    getVideoTrack: () => ({ id: 1, name: 'Graphics', getTrackItems: (type: number) => type === 1 ? items.map(wrapper) : [] }),
    getAudioTrack: () => ({ id: 1, name: 'Audio', getTrackItems: () => [] }),
  };
  const project = { guid: 'p', path: 'C:/fixture.prproj', getActiveSequence: () => sequence,
    lockedAccess: (callback: any) => callback(), executeTransaction: (callback: any) => { callback({ addAction: (action: any) => action() }); return true; } };
  const editor = { insertMogrtFromPath: () => { inserts++; const item = { end: 5 }; items.push(item); return [wrapper(item)]; } };
  const load = uxpModules({ Project: { getActiveProject: () => project }, Constants: { TrackItemType: { CLIP: 1, TRANSITION: 2 } }, SequenceEditor: { getEditor: () => editor },
    TickTime: { TIME_ZERO: time(0), createWithTicks: (ticks: string) => ({ ticks, seconds: Number(ticks) / ticksPerSecond }) } });
  const { PremiereHost } = load('apps/uxp-plugin/src/premiere-host.ts');
  const result = await new PremiereHost().dispatchCommand({ version: 1, id: 'duration-diagnostic', command: 'insert_mogrt_caption', args: {
    expectedProjectId: 'p', expectedSequenceId: 's', expectedSequenceName: 'S', expectedVideoTrackCount: 1, expectedAudioTrackCount: 1, expectedCaptionTrackCount: 0,
    expectedTimelineItemCount: 0, videoTrackIndex: 0, expectedVideoTrackId: 1, expectedVideoTrackName: 'Graphics', audioTrackIndex: 0,
    timeSeconds: 0, durationSeconds: 1 / 24, mogrtPath: 'C:/private/example.mogrt',
  } });
  expect(result.status).toBe('unverified'); // This fixture deliberately has no rollback selection API.
  expect(result.errors.join(';')).toContain('Graphic duration changed component values or animation');
  expect(result.hostResult.rollback.attempted).toBe(true);
  expect(result.hostResult.durationPreservation).toEqual({ status: 'fail', beforeComponentCount: 1, afterComponentCount: 1, totalDifferences: 2, truncated: false,
    differences: [{ path: '/0/params/0/supportsKeyframes', before: true, after: false },
      { path: '/0/params/0/descriptor/keyframeWrite', before: 'native_type_preflight_required', after: 'unsupported' }] });
  expect({ inserts, trims, valueReads }).toEqual({ inserts: 1, trims: 1, valueReads: 2 });
  expect(JSON.stringify(result.hostResult.durationPreservation)).not.toContain('C:/private');
});
