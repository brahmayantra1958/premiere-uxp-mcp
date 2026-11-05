import type { ProjectSnapshot } from '@premiere-uxp/contracts';
import type { ExistingSequenceStructureEdit } from '../../apps/mcp-server/src/existing-sequence-structure.js';
import type { SequenceArchiveSnapshot } from '../../apps/mcp-server/src/premiere-sequence-archive.js';

export function structurePreservationFixture() {
  const time = (ticks: string) => ({ ticks, seconds: Number(ticks) / 100 });
  const track = (mediaType: 'video' | 'audio', index: number, itemCount: number, transitionCount = 0) => ({ mediaType, index, id: index + 1, name: `${mediaType} ${index + 1}`, muted: false, itemCount, transitionCount });
  const item = (mediaType: 'video' | 'audio', trackIndex: number) => ({ id: `${mediaType}:${trackIndex}`, name: mediaType, projectItemId: `source-${mediaType}`, mediaType, trackIndex, start: time('100'), end: time('200'), inPoint: time('0'), outPoint: time('100'), speed: 1, reversed: false, disabled: false, adjustmentLayer: false });
  const sequence = { id: 'f8bfff22-1e33-4ebe-90d4-654fcaa225d2', name: 'Demo', videoTracks: 3, audioTracks: 2, captionTracks: 1, width: 1920, height: 1080, frameRate: 25, duration: time('200'), itemLimit: 1000, itemsTruncated: false,
    items: [item('video', 1), item('audio', 1)], tracks: [track('video', 0, 0), track('video', 1, 1, 1), track('video', 2, 0), track('audio', 0, 0), track('audio', 1, 1)],
    captionTrackStates: [{ index: 0, id: 1, name: 'Captions', muted: false, itemCount: 1, transitionCount: 0 as const }],
    transitions: [{ id: 'transition:1:100:Dissolve', name: 'Dissolve', matchName: 'Dissolve', trackIndex: 1, start: time('100'), end: time('110'), duration: time('10') }] };
  const param = { paramIndex: 0, displayName: 'Amount', value: 12, valueKind: 'number', nativeValueType: null, valueReadMethod: 'getValueAtTime', timeVarying: true, supportsKeyframes: true, sampledAt: time('0'), sampleTimeBasis: 'native_component', keyframes: [time('0')], keyframeDetails: [{ time: time('0'), value: 12, interpolation: 'linear', interpolationMode: 0 }], readStatus: { value: 'pass', animation: 'pass' }, readErrors: [] };
  const project: ProjectSnapshot = { projectId: 'project-1', projectName: 'demo.prproj', projectPath: 'C:/scratch/demo.prproj', capturedAt: '2026-11-04T00:00:00.000Z', activeSequence: sequence, sequences: [{ id: sequence.id, name: sequence.name }], projectItems: [], projectItemLimit: 500, projectItemsTruncated: false, offlineMediaIds: [], proxyAttachments: [], markers: [], mogrtItems: [], effects: sequence.items.map(row => ({ trackItemId: row.id, name: row.name, mediaType: row.mediaType, components: [{ componentIndex: 0, displayName: 'Effect', matchName: row.mediaType + '-effect', params: [structuredClone(param)] }] })), audioState: [], unsupportedFields: [] };
  const archive: SequenceArchiveSnapshot = { projectPath: project.projectPath, sequenceName: sequence.name, sequenceUid: sequence.id, trackCounts: { video: 3, audio: 2, caption: 1 }, totalItems: 3, tracks: [
    ...sequence.tracks.map(row => ({ ...row, uid: `uid-${row.mediaType}-${row.index}`, empty: row.itemCount === 0 })),
    { ...sequence.captionTrackStates[0]!, mediaType: 'caption', uid: 'caption-uid', empty: false, style: { binaryHash: 'template-token', contentSha256: 'template-sha', fontPostScriptName: 'ArialMT', fontSize: 48, byteLength: 200 }, captionCues: [{ index: 0, itemObjectId: 'item-1', blockObjectId: 'block-1', binaryHash: 'cue-token', contentSha256: 'cue-sha', preservedStyleSha256: 'style-sha', text: 'Caption', startTicks: '100', endTicks: '200', fontPostScriptName: 'ArialMT', fontSize: 48, fillColor: { r: 10, g: 20, b: 30 }, byteLength: 250 }] },
  ] };
  const removals = archive.tracks.filter(row => row.index === 0 && row.mediaType !== 'caption').map(row => ({ mediaType: row.mediaType, index: row.index, id: row.id, uid: row.uid, name: row.name, expectedHostName: row.name, expectedItemCount: 0 as const, expectedTransitionCount: 0 as const }));
  const edit: ExistingSequenceStructureEdit = { expectedProjectId: project.projectId, expectedSequenceId: sequence.id, expectedProjectPath: project.projectPath, expectedSequenceName: sequence.name, expectedSequenceUid: sequence.id, removeTracks: removals };
  const after = structuredClone({ sequence, project, archive });
  after.sequence.videoTracks--; after.sequence.audioTracks--;
  after.sequence.tracks = after.sequence.tracks.filter(row => row.index !== 0).map(row => ({ ...row, index: row.index - 1 }));
  after.sequence.items.forEach(row => { row.trackIndex--; row.id += ':reopened'; });
  after.sequence.transitions.forEach(row => { row.trackIndex--; row.id = 'regenerated-transition'; });
  after.project.activeSequence = after.sequence;
  (after.project.effects as any[]).forEach(row => { row.trackItemId += ':reopened'; });
  after.archive.trackCounts.video--; after.archive.trackCounts.audio--;
  after.archive.tracks = after.archive.tracks.filter(row => !removals.some(target => row.uid === target.uid)).map(row => ({ ...row, index: row.mediaType === 'caption' ? row.index : row.index - 1 }));
  const cue = after.archive.tracks.at(-1)!.captionCues![0]!;
  cue.itemObjectId = 'new-item'; cue.blockObjectId = 'new-block'; cue.binaryHash = 'new-token';
  return { sequence, project, archive, removals, edit, after };
}
