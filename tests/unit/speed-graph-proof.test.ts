import {it,expect} from 'vitest';
import {speedGraphObservationProves,speedGraphDisplayName,speedGraphLabelProves} from '../../apps/mcp-server/src/speed-graph-proof.js';
const expected={pid:123,panelHandle:456,tab:'Sequence • Clip',headerIndex:2};
const observation=()=>({protocol:1,status:'pass',route:'windows_msaa_parameter_state',premierePid:123,panelHandle:456,selectedClipTab:expected.tab,headerIndex:2,rows:[{index:299,ordinal:0,role:43,state:8,name:'UI_DisclosureTriangleButton',top:100,width:14,height:14}],viewport:{top:40,height:300}});
it('derives the name only from the adjacent native animation control and proves the graph label',()=>{
 for(const [animation,name] of [['애니메이션 켜기/끄기','속도'],['Toggle animation','Speed']]){
  const r=observation(),row={...r.rows[0],animationControl:{index:300,role:43,state:8,top:100,name:animation},graphLabels:[{role:41,name:name+': 100.00'}]};
  expect(speedGraphDisplayName({...r,rows:[row]})).toBe(name);expect(speedGraphLabelProves({...r,rows:[row]},name!)).toBe(true);
  for(const diff of [{name:''},{name:'Animation'},{index:301},{role:41},{top:120}])expect(()=>speedGraphDisplayName({...r,rows:[{...row,animationControl:{...row.animationControl,...diff}}]})).toThrow('NATIVE_LABEL_UNVERIFIED');
  expect(speedGraphLabelProves({...r,rows:[{...row,graphLabels:[{role:41,name:': 100.00'}]}]},name!)).toBe(false);
 }
});
it('proves both actual native states without requiring a dispatch Boolean',()=>{
 for(const state of [0,8]){const r=observation();r.rows[0]!.state=state;expect(speedGraphObservationProves(r,expected)).toBe(true);}
});
it('rejects another process, window, clip, header or a property-only receipt',()=>{
 for(const diff of [{premierePid:124},{panelHandle:457},{selectedClipTab:'Another clip'},{headerIndex:3},{rows:[]},{route:'properties'},{protocol:2}])expect(speedGraphObservationProves({...observation(),...diff},expected)).toBe(false);
});
it('rejects hidden, ambiguous, clipped, unavailable and nonfinite rows',()=>{
 for(const diff of [{state:32776},{state:65544},{state:9},{top:320},{top:0},{top:NaN},{height:0},{name:'Time Remapping'},{ordinal:1}]){
  const r=observation();Object.assign(r.rows[0]!,diff);expect(speedGraphObservationProves(r,expected)).toBe(false);
 }
 const r=observation();r.rows.push({...r.rows[0]!,index:300});expect(speedGraphObservationProves(r,expected)).toBe(false);
});
