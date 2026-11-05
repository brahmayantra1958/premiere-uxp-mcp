import {describe,it,expect} from 'vitest';
import {deriveDependencyGraph,type EffectDependencyGraph} from '../../apps/uxp-plugin/src/effect-dependency-graph.js';
import {deriveEffectValues} from '../../apps/uxp-plugin/src/effect-derived-values.js';
import {effectDependencies} from '../../apps/mcp-server/src/tool-inputs.js';
const component=()=>({matchName:'Vendor',params:[100,150,150,300].map((value,paramIndex)=>({paramIndex,displayName:['Input','Factor','Scaled','Double'][paramIndex],value,timeVarying:false,keyframes:[],keyframeDetails:[],readStatus:{value:'pass',animation:'pass'}}))});
const graph:EffectDependencyGraph={componentMatchName:'Vendor',parameterNames:['Input','Factor','Scaled','Double'],rules:[
 {id:'double',outputParamIndex:3,nodes:[{op:'multiply',args:[{paramIndex:2},2]}]},
 {id:'scaled',outputParamIndex:2,nodes:[{op:'multiply',args:[{paramIndex:0},{paramIndex:1}]},{op:'divide',args:[{nodeIndex:0},100]}]},
]};
const plan=(c:ReturnType<typeof component>,value=50)=>[{snapshot:c.params[0],write:{paramIndex:0,value}}];
describe('declared native dependency graphs',()=>{
 it('establishes explicit apply links without pretending their old values were a native relation',()=>{
  const c=component();c.params[2].value=12;c.params[3].value=24;
  expect(()=>deriveDependencyGraph(c,plan(c,100),graph)).toThrow('BASELINE_MISMATCH');
  const apply={...graph,mode:'apply' as const};expect(effectDependencies.parse(apply)).toEqual(apply);
  const r=deriveEffectValues(c,plan(c,100),[],apply);
  expect(r.linkedWrites?.map(w=>[w.paramIndex,w.expectedValue,w.value])).toEqual([[2,12,150],[3,24,300]]);
  expect(deriveEffectValues(component(),plan(component()),[],graph).linkedWrites).toBeUndefined();
 });
 it('admits an empty native animation mode only by explicit policy, never actual keys',()=>{
  const c=component();c.params[2].timeVarying=true;
  expect(()=>deriveDependencyGraph(c,plan(c),graph)).toThrow('STATIC_VALUE');
  expect(deriveDependencyGraph(c,plan(c),graph,true).writes[0]?.value).toBe(75);
  (c.params[2].keyframes as unknown[]).push({ticks:'1'});
  expect(()=>deriveDependencyGraph(c,plan(c),graph,true)).toThrow('STATIC_VALUE');
 });
 it('derives Point and Color outputs through explicit typed fields without writing outputs',()=>{
  const c:any=component();c.params=[
   {...c.params[0],value:[10,20],descriptor:{inputKind:'point'}},
   {...c.params[1],value:2},
   {...c.params[2],value:{x:20,y:40},descriptor:{inputKind:'point'}},
   {...c.params[3],value:{red:.2,green:.4,blue:.5,alpha:1},descriptor:{inputKind:'color'}}
  ];
  const g:EffectDependencyGraph={componentMatchName:c.matchName,parameterNames:c.params.map((p:any)=>p.displayName),rules:[
   {id:'point',outputParamIndex:2,nodes:[{op:'multiply',args:[{paramIndex:0,field:'x'},{paramIndex:1}]},{op:'multiply',args:[{paramIndex:0,field:'y'},{paramIndex:1}]},{op:'point',args:[{nodeIndex:0},{nodeIndex:1}]}]},
   {id:'color',outputParamIndex:3,nodes:[{op:'divide',args:[{paramIndex:2,field:'x'},100]},{op:'divide',args:[{paramIndex:2,field:'y'},100]},{op:'color',args:[{nodeIndex:0},{nodeIndex:1},.5,1]}]}
  ]};expect(effectDependencies.parse(g)).toEqual(g);
  const r=deriveDependencyGraph(c,[{snapshot:c.params[0],write:{paramIndex:0,value:{kind:'point',x:15,y:25}}}],g);
  expect(r.writes.map(w=>w.value)).toEqual([{kind:'point',x:30,y:50},{kind:'color',red:.3,green:.5,blue:.5,alpha:1}]);
  expect(c.params[0].value).toEqual([10,20]);
  const wrong=structuredClone(g);(wrong.rules[0]!.nodes[0]!.args[0] as any).field='red';expect(()=>deriveDependencyGraph(c,[],wrong)).toThrow('FIELD_MISMATCH');
  expect(()=>deriveDependencyGraph(c,[{snapshot:c.params[1],write:{paramIndex:1,value:10}}],g)).toThrow('TYPED_VALUE');
 });
 it('computes multiple dependent outputs before dispatch in topological order',()=>{
  expect(effectDependencies.parse(graph)).toEqual(graph);const c=component();
  expect(deriveDependencyGraph(c,plan(c),graph)).toEqual({writes:[{paramIndex:2,expectedDisplayName:'Scaled',expectedValue:150,value:75},{paramIndex:3,expectedDisplayName:'Double',expectedValue:300,value:150}],rules:['declared:scaled','declared:double']});
  expect(c.params.map(p=>p.value)).toEqual([100,150,150,300]);
 });
 it('rejects cycles, forward nodes, duplicate outputs and changed names',()=>{
  const c=component(),cycle=structuredClone(graph);cycle.rules[1].nodes[0].args[0]={paramIndex:3};expect(()=>deriveDependencyGraph(c,plan(c),cycle)).toThrow('CYCLE');
  const forward=structuredClone(graph);forward.rules[1].nodes[0].args[0]={nodeIndex:1};expect(()=>deriveDependencyGraph(c,plan(c),forward)).toThrow('NODE_REFERENCE');
  expect(()=>deriveDependencyGraph(c,plan(c),{...graph,rules:[...graph.rules,graph.rules[0]]})).toThrow('DUPLICATE');
  c.params[1].displayName='Other';expect(()=>deriveDependencyGraph(c,plan(c),graph)).toThrow('SCHEMA_CHANGED');
 });
 it('rejects invalid before-state, animation, zero division and overlapping direct outputs',()=>{
  const bad=component();bad.params[2].value=149;expect(()=>deriveDependencyGraph(bad,plan(bad),graph)).toThrow('BASELINE_MISMATCH');
  const animated=component();animated.params[1].timeVarying=true;expect(()=>deriveDependencyGraph(animated,plan(animated),graph)).toThrow('STATIC_VALUE');
  const zero=structuredClone(graph);zero.rules[1].nodes[1].args[1]=0;expect(()=>deriveDependencyGraph(component(),plan(component()),zero)).toThrow('NONFINITE');
  const c=component();expect(()=>deriveDependencyGraph(c,[...plan(c),{snapshot:c.params[2],write:{paramIndex:2,value:75}}],graph)).toThrow('OVERLAP');
 });
 it('requires explicit derived expectations to agree with the graph, not weaken it',()=>{
  const c=component();expect(()=>deriveEffectValues(c,plan(c),[{paramIndex:2,expectedValue:150,value:70}],graph)).toThrow('RULE_CONFLICT');
  expect(deriveEffectValues(c,plan(c),[],graph).writes).toHaveLength(2);
  expect(deriveDependencyGraph(c,plan(c,100),graph).writes).toEqual([]);
 });
 it('applies the same relation over a broad numeric domain including zero and fractional factors',()=>{
  for(const factor of [0,.1,50,150,201.3])for(const input of [0,.01,50,100,175]){const c=component();c.params[1].value=factor;c.params[2].value=factor;c.params[3].value=factor*2;
   const r=deriveDependencyGraph(c,plan(c,input),graph);if(input!==100){expect(r.writes[0]?.value).toBeCloseTo(input*factor/100);if(factor!==0)expect(r.writes[1]?.value).toBeCloseTo(input*factor/50);}
  }
 });
});
