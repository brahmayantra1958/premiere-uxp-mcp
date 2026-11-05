import {expect, it} from 'vitest';
import {effectStateProjection} from '../../packages/contracts/src/effect-state.js';
import recorded from '../fixtures/effect-state-20261103.json';

it('compares recorded atomic keyframe readback and enriched timeline readback as the same content', () => {
  expect(effectStateProjection(recorded.queried)).toEqual(effectStateProjection(recorded.afterKeys));
});

it.each([
  ['native key time', (chain: any[]) => {chain[0].params[1].keyframeDetails[1].time.ticks = '1';}],
  ['key value', (chain: any[]) => {chain[0].params[1].keyframeDetails[1].value = 0.5;}],
  ['interpolation mode', (chain: any[]) => {chain[0].params[1].keyframeDetails[1].interpolationMode = 5;}],
  ['native tangent', (chain: any[]) => {chain[0].params[1].keyframeDetails[1].nativePointFields = [5, 0, 0, 2];}],
  ['key list', (chain: any[]) => {chain[0].params[1].keyframes.pop();}],
  ['animation flag', (chain: any[]) => {chain[0].params[1].timeVarying = false;}],
  ['read proof', (chain: any[]) => {chain[0].params[1].readStatus.animation = 'unverified';}],
  ['static Balance', (chain: any[]) => {chain[2].params[1].value = 0.25;}],
  ['sample time', (chain: any[]) => {chain[0].params[1].sampledAt.ticks = '1';}],
  ['sample value', (chain: any[]) => {chain[0].params[1].value = 0.5;}],
  ['component identity', (chain: any[]) => {chain[0].matchName = 'Other';}],
] as const)('retains %s in the preservation guard', (_name, change) => {
  const actual = structuredClone(recorded.afterKeys); change(actual);
  expect(effectStateProjection(actual)).not.toEqual(effectStateProjection(recorded.afterKeys));
});

it('does not rewrite either observation while projecting it', () => {
  const before = structuredClone(recorded.queried);
  effectStateProjection(recorded.queried);
  expect(recorded.queried).toEqual(before);
});
