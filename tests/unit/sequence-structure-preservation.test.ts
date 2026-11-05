import { describe, expect, it } from 'vitest';
import { trackRemovalArchivePreservation, trackRemovalHostPreservation } from '../../apps/mcp-server/src/sequence-structure-preservation.js';
import { structurePreservationFixture } from '../fixtures/sequence-structure-preservation.js';

describe('track removal preservation', () => {
  it('permits exact middle-track remaps and regenerated wrapper/object IDs only', () => {
    const f = structurePreservationFixture();
    expect(trackRemovalHostPreservation(f.sequence, f.project, f.removals)).toBe(trackRemovalHostPreservation(f.after.sequence, f.after.project, []));
    expect(trackRemovalArchivePreservation(f.archive, f.removals)).toBe(trackRemovalArchivePreservation(f.after.archive, []));
    expect(f.after.sequence.tracks.some(row => row.itemCount === 0)).toBe(true); // Not the native all-empty operation.
  });
  it('allows only the known recreated Graphic Group slot while retaining all graphic effect content', () => {
    const f = structurePreservationFixture();
    for (const state of [f, f.after]) {
      state.sequence.items[0]!.projectItemId = '';
      const row = (state.project.effects as any[])[0];
      row.components.push({ componentIndex: 1, matchName: 'AE.ADBE Graphic Group', params: [] }, { componentIndex: 2, matchName: 'AE.ADBE Text', params: [] });
    }
    const chain = (f.after.project.effects as any[])[0].components;
    chain.unshift(chain.splice(1, 1)[0]); chain.forEach((row: any, index: number) => { row.componentIndex = index; });
    const before = trackRemovalHostPreservation(f.sequence, f.project, f.removals);
    expect(trackRemovalHostPreservation(f.after.sequence, f.after.project, [])).toBe(before);
    chain[1].params[0].value++;
    expect(trackRemovalHostPreservation(f.after.sequence, f.after.project, [])).not.toBe(before);
  });
  it.each(['clip-range', 'source-range', 'source', 'speed', 'flags', 'track-name', 'track-id', 'mute', 'effect-value', 'key-value', 'key-mode', 'effect-order', 'transition-time', 'transition-kind', 'marker', 'offline'] as const)('detects same-count corruption: %s', fault => {
    const f = structurePreservationFixture(), after = f.after, item = after.sequence.items[0]!, component = (after.project.effects as any[])[0]!.components[0], param = component.params[0];
    if (fault === 'clip-range') item.end.ticks = '201';
    if (fault === 'source-range') item.inPoint.ticks = '1';
    if (fault === 'source') item.projectItemId = 'wrong-source';
    if (fault === 'speed') item.speed = 2;
    if (fault === 'flags') item.disabled = true;
    if (fault === 'track-name') after.sequence.tracks[0]!.name = 'renamed';
    if (fault === 'track-id') after.sequence.tracks[0]!.id = 99;
    if (fault === 'mute') after.sequence.tracks[0]!.muted = true;
    if (fault === 'effect-value') param.value++;
    if (fault === 'key-value') param.keyframeDetails[0].value++;
    if (fault === 'key-mode') param.keyframeDetails[0].interpolationMode++;
    if (fault === 'effect-order') component.matchName = 'replaced';
    if (fault === 'transition-time') after.sequence.transitions[0]!.end.ticks = '111';
    if (fault === 'transition-kind') after.sequence.transitions[0]!.matchName = 'different';
    if (fault === 'marker') after.project.markers.push({ id: 'new', name: 'new', start: { ticks: '0', seconds: 0 }, duration: { ticks: '0', seconds: 0 }, comments: '', type: 'Comment', colorIndex: 0 });
    if (fault === 'offline') after.project.offlineMediaIds.push('lost');
    expect(trackRemovalHostPreservation(f.sequence, f.project, f.removals)).not.toBe(trackRemovalHostPreservation(after.sequence, after.project, []));
  });
  it.each(['text', 'startTicks', 'fontPostScriptName', 'fontSize', 'fillColor', 'contentSha256', 'preservedStyleSha256', 'template'] as const)('preserves every caption field: %s', field => {
    const f = structurePreservationFixture(), track = f.after.archive.tracks.at(-1)!, cue = track.captionCues![0]!;
    if (field === 'template') track.style!.contentSha256 = 'changed-template';
    else (cue as any)[field] = field === 'fontSize' ? 55 : field === 'fillColor' ? { r: 99, g: 20, b: 30 } : 'changed';
    expect(trackRemovalArchivePreservation(f.archive, f.removals)).not.toBe(trackRemovalArchivePreservation(f.after.archive, []));
  });
  it.each(['truncated', 'effect-missing', 'effect-duplicate', 'param-unverified', 'param-partial-keys', 'transition-missing', 'item-race', 'track-race', 'duplicate-target'] as const)('fails closed on missing or contradictory evidence: %s', fault => {
    const f = structurePreservationFixture(), effects = f.project.effects as any[];
    if (fault === 'truncated') f.sequence.itemsTruncated = true;
    if (fault === 'effect-missing') effects.pop();
    if (fault === 'effect-duplicate') effects.push(structuredClone(effects[0]));
    if (fault === 'param-unverified') effects[0].components[0].params[0].readStatus.value = 'unverified';
    if (fault === 'param-partial-keys') effects[0].components[0].params[0].keyframeDetails = [];
    if (fault === 'transition-missing') f.sequence.transitions = [];
    if (fault === 'item-race') { f.project.activeSequence = structuredClone(f.sequence); f.project.activeSequence.items[0]!.start.ticks = '2'; }
    if (fault === 'track-race') { f.project.activeSequence = structuredClone(f.sequence); f.project.activeSequence.tracks[0]!.name = 'raced'; }
    if (fault === 'duplicate-target') f.removals.push(f.removals[0]!);
    expect(() => trackRemovalHostPreservation(f.sequence, f.project, f.removals)).toThrow();
  });
});
