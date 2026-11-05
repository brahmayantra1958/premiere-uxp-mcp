import {expect, it} from 'vitest';
import {placementCapabilities, placementCapabilityStatus} from '../../apps/mcp-server/src/placement-capabilities.js';
import recorded from '../fixtures/placement-capabilities-20261103.json';

it('recognizes the recorded 0.15.1 catalog as lacking sourceRange but retaining original + trim', () => {
  expect(placementCapabilities(recorded)).toMatchObject({
    sourceRange: {status: 'unsupported', videoStatus: 'unsupported'},
    fullOriginalThenExactTrim: {status: 'pass', automatic: false},
    recommendedRoute: {audio: 'full_original_then_exact_trim', video: 'full_original_then_exact_trim'},
  });
});
it('does not infer sourceRange from a new-looking version or from any unrelated support', () => {
  expect(placementCapabilities({...recorded, panelVersion: '999.0.0'}).sourceRange.status).toBe('unsupported');
});
it('requires rendered-frame capability for video while allowing the advertised audio route', () => {
  const catalog = {...recorded, read: [], write: [...recorded.write, {name: 'sourceRangePlacement', supported: true}]};
  expect(placementCapabilities(catalog)).toMatchObject({sourceRange: {status: 'pass', videoStatus: 'unsupported'}, recommendedRoute: {audio: 'source_range', video: 'full_original_then_exact_trim'}});
  expect(placementCapabilities({...catalog, read: recorded.read}).recommendedRoute.video).toBe('source_range');
});
it.each([undefined, {}, {write: [{name: 'sourceRangePlacement', supported: 'true'}]}, {write: [{name: 'sourceRangePlacement', supported: true}, {name: 'sourceRangePlacement', supported: false}]}])('keeps unreadable/ambiguous support unverified (%j)', catalog => {
  expect(placementCapabilities(catalog)).toMatchObject({sourceRange: {status: 'unverified'}, recommendedRoute: {audio: 'inspect_capabilities_or_manual_edit'}});
});
it('does not recommend the two-step route when exact trim is absent', () => {
  expect(placementCapabilities({...recorded, write: recorded.write.filter(cap => cap.name !== 'exactClipTrim')})).toMatchObject({fullOriginalThenExactTrim: {status: 'unsupported'}, recommendedRoute: {audio: 'inspect_capabilities_or_manual_edit'}});
});
it('requires actual boolean true, and shares the exact predicate with dispatch', () => {
  expect(placementCapabilityStatus({write: [{name: 'sourceRangePlacement', supported: false}]}, 'write', 'sourceRangePlacement')).toBe('unsupported');
  expect(placementCapabilityStatus({write: [{name: 'sourceRangePlacement', supported: true}]}, 'write', 'sourceRangePlacement')).toBe('pass');
});
