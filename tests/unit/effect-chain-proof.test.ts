import {describe,it,expect} from 'vitest';
import {effectChainProofScopeMatches,type EffectChainProofWork} from '../../packages/contracts/src/effect-chain-proof.js';
import {effectChainProofWorkSchema} from '../../apps/mcp-server/src/effect-chain-proof.js';

const work:EffectChainProofWork={projectId:'p',sequenceId:'s',sequenceName:'WORKING__test',trackItemId:'video:0:0:source',projectItemId:'source',clipName:'clip',mediaType:'video',trackIndex:0,startTicks:'0',endTicks:'254016000000',componentMatchNames:['Motion','PointFx','PointFx'],components:[{componentIndex:1,componentMatchName:'PointFx',parameterNames:['Position']},{componentIndex:2,componentMatchName:'PointFx',parameterNames:['Position']}]};
const args={expectedProjectId:'p',expectedSequenceId:'s',expectedSequenceName:work.sequenceName,trackItemId:work.trackItemId,expectedProjectItemId:'source',expectedMediaType:'video',expectedTrackIndex:0,expectedStartSeconds:0,expectedEndSeconds:1,expectedClipName:'clip'};
describe('full-chain saved native proof boundary',()=>{
 it('correlates duplicate occurrences with exact clip scope, without caller paths or executable work',()=>{
  expect(effectChainProofScopeMatches('set_effect_values',args,work)).toBe(true);
  expect(effectChainProofWorkSchema.parse(work)).toEqual(work);
  expect(()=>effectChainProofWorkSchema.parse({...work,projectPath:'other'})).toThrow();
  expect(()=>effectChainProofWorkSchema.parse({...work,components:[work.components[0],work.components[0]]})).toThrow();
  expect(()=>effectChainProofWorkSchema.parse({...work,components:[{...work.components[0],componentMatchName:'Motion'}]})).toThrow();
 });
 it.each([{projectId:'other'},{sequenceId:'other'},{trackItemId:'other'},{projectItemId:'other'},{mediaType:'audio'},{trackIndex:1},{startTicks:'1'},{endTicks:'1'},{clipName:'other'}])('rejects changed identity %j',patch=>{
  expect(effectChainProofScopeMatches('set_effect_values',args,{...work,...patch} as EffectChainProofWork)).toBe(false);
 });
 it('cannot attach a whole-chain proof to an unrelated or unscoped request',()=>{
  expect(effectChainProofScopeMatches('query_timeline',args,work)).toBe(false);
  expect(effectChainProofScopeMatches('set_effect_values',{},work)).toBe(false);
  expect(effectChainProofScopeMatches('run_script',args,work)).toBe(false);
 });
});
