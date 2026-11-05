import {describe,it,expect} from 'vitest';
import {deriveEffectValues} from '../../apps/uxp-plugin/src/effect-derived-values.js';
const component=()=>({matchName:'AE.ADBE AEFilterAutoFramer',params:Array.from({length:14},(_,paramIndex)=>({paramIndex,displayName:({3:'Scale (Merged)',11:'Reframe Scale',12:'Scale (Auto Generated)'} as Record<number,string>)[paramIndex]??'',value:paramIndex===11?100:150,timeVarying:false,keyframes:[],keyframeDetails:[],readStatus:{value:'pass',animation:'pass'}}))});
const plan=(c:ReturnType<typeof component>,value=95)=>[{snapshot:c.params[11],write:{paramIndex:11,value}}];
describe('causal native derived values',()=>{
 it('derives proportional output across generated scales including zero without writing the output',()=>{
  for(const generated of [0,50,150,225.5])for(const input of [0,50,100,175]){
   const c=component();c.params[12].value=generated;c.params[3].value=generated;
   expect(deriveEffectValues(c,plan(c,input))).toEqual({writes:[{paramIndex:3,expectedDisplayName:'Scale (Merged)',expectedValue:generated,value:generated*input/100}],rules:['adobe_auto_reframe_static_scale_v1']});
  }
 });
 it('rejects unproven existing equations, animation, changed schemas and overlapping writes',()=>{
  const broken=component();broken.params[3].value=149;expect(()=>deriveEffectValues(broken,plan(broken))).toThrow('BASELINE_MISMATCH');
  for(const index of [3,11,12]){const c=component();c.params[index].timeVarying=true;expect(()=>deriveEffectValues(c,plan(c))).toThrow('INPUT_UNVERIFIED');}
  const layout=component();layout.params[11].displayName='Other';expect(()=>deriveEffectValues(layout,plan(layout))).toThrow('INPUT_UNVERIFIED');
  const overlap=component();expect(()=>deriveEffectValues(overlap,[...plan(overlap),{snapshot:overlap.params[3],write:{paramIndex:3,value:142.5}}])).toThrow('OVERLAP');
 });
 it('requires explicit overrides to agree and keeps unknown dependencies protected',()=>{
  const c=component(),explicit={paramIndex:3,expectedDisplayName:'Scale (Merged)',expectedValue:150,value:142.5};
  expect(deriveEffectValues(c,plan(c),[explicit]).writes).toEqual([explicit]);
  expect(()=>deriveEffectValues(c,plan(c),[{...explicit,value:141}])).toThrow('RULE_CONFLICT');
  expect(()=>deriveEffectValues(c,plan(c),[{...explicit,expectedValue:149}])).toThrow('RULE_CONFLICT');
  c.matchName='Vendor';expect(deriveEffectValues(c,plan(c))).toEqual({writes:[],rules:[]});
 });
});
