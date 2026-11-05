import {describe,it,expect} from 'vitest';
import {firstEffectParameter,effectParameterScopeProves} from '@premiere-uxp/contracts/effect-disclosure';
describe('first requested parameter scope',()=>{
 const parameter={paramIndex:4,name:'Rotation',expanded:true,disclosureKey:'ECP.Angle.Expanded'};
 it('uses one common ordering for reads, values and keyframe batches',()=>{
  for(const args of [{paramIndex:4,expectedDisplayName:'Rotation'},{parameters:[{paramIndex:4,expectedDisplayName:'Rotation'},{paramIndex:5}]},{keyframes:[{parameterName:'rotation'}]},{operations:[{paramIndex:4,expectedDisplayName:'Rotation'}]},{values:{Rotation:3,Other:1}}])expect(effectParameterScopeProves(args,parameter)).toBe(true);
  expect(firstEffectParameter({})).toBeUndefined();
 });
 it('rejects a callback targeting another row or changing the requested state',()=>{
  const args={parameters:[{paramIndex:4,expectedDisplayName:'Rotation'}]};
  for(const p of [{...parameter,paramIndex:5},{...parameter,name:'Scale'},{...parameter,expanded:false},undefined])expect(effectParameterScopeProves(args,p)).toBe(false);
  expect(effectParameterScopeProves({},parameter)).toBe(false);
 });
});
