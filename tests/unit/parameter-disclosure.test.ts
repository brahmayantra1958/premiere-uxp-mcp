import {describe,it,expect,vi} from 'vitest';
import {deriveParameterOrdinal,parameterVisibleProves,type EffectDisclosureWork} from '@premiere-uxp/contracts/effect-disclosure';
import {revealParameter} from '../../apps/uxp-plugin/src/parameter-disclosure.js';
const work:EffectDisclosureWork={sequenceName:'WORKING__test',componentMatchNames:['vendor.fx'],target:{mediaType:'video',trackIndex:0,startTicks:'100',endTicks:'200',clipName:'clip',mediaPath:'C:/clip.mov',componentMatchName:'vendor.fx',componentIndex:0},parameter:{paramIndex:7,name:'Value',expanded:true,disclosureKey:'ECP.Slider.Expanded'}};
const raw=(bits:number[])=>({protocol:1,status:'pass',route:'windows_msaa_parameter_state',premierePid:1,panelHandle:2,selectedClipTab:'WORKING__test • clip',headerIndex:0,viewport:{top:100,height:300},rows:bits.map((state,ordinal)=>({ordinal,index:ordinal+10,role:43,state,top:130+ordinal*50,height:14}))});
describe('exact parameter visibility proof',()=>{
 it.each(['PARAMETER_SCROLL_BUDGET','ACCESSIBILITY_NAME_READ_BUDGET'].flatMap(reason=>[true,false].map(recovers=>({reason,recovers}))))('continues one completed budget failure with fresh native proof ($reason/$recovers)',async({reason,recovers})=>{
  const budget={ordinal:1,readback:{status:'unverified',route:'windows_msaa_parameter_state',reason,dispatchAccepted:true,progress:{steps:6,targetState:8,targetTop:380,viewportTop:100,viewportHeight:300}}};
  let scrolls=0;const write=vi.fn();
  const result=await revealParameter(work,{assertTarget:async()=>{},write,request:async phase=>{
   if(phase==='parameter_inspect')return {ordinal:1,readback:{...raw([0,8,0]),viewport:{top:500,height:300}}};
   return ++scrolls===2&&recovers?{ordinal:1,readback:raw([0,8,0])}:budget;
  }});
  expect(scrolls).toBe(2);expect(write).not.toHaveBeenCalled();expect(result.status).toBe(recovers?'pass':'unverified');expect(result.scrollContinuation.attempts).toBe(1);
 });
 it('requires the complete custom graph region, not just its visible heading',()=>{
  const custom={...work,parameter:{...work.parameter!,disclosureKey:'ECP.Custom.Expanded'}},r:any=raw([8,8]);r.rows[1].index=20;
  const boundary={index:13,name:'Reset Parameter',role:43,state:1048576,top:375,width:20,height:18};r.rows[0].customGraphBoundary=boundary;
  expect(parameterVisibleProves(custom,r,0)).toBe(true);
  for(const patch of [{top:430},{top:160},{index:20},{name:'Other'},{width:0}]){
    const changed=structuredClone(r);Object.assign(changed.rows[0].customGraphBoundary,patch);expect(parameterVisibleProves(custom,changed,0)).toBe(false);
  }
  r.rows[0].customGraphBoundary={...boundary,index:20,name:'UI_DisclosureTriangleButton',state:8};expect(parameterVisibleProves(custom,r,0)).toBe(true);
  r.rows[0].customGraphBoundary.state=32776;expect(parameterVisibleProves(custom,r,0)).toBe(false);
  delete r.rows[0].customGraphBoundary;expect(parameterVisibleProves(custom,r,0)).toBe(false);
 });
 it.each([true,false])('reacquires reconstructed Color rows once without replaying content (%s)',async recovers=>{
  const color:EffectDisclosureWork={...work,target:{...work.target,parameterCount:1},parameter:{paramIndex:0,name:'Color',expanded:true,disclosureKey:'ECP.Slider.Expanded',inlineColor:{indices:[0],timeVarying:false}}};
  const observation:any={...raw([0]),rowMapping:{method:'complete_native_parameter_rows',parameterCount:1,colorIndices:[0]}};
  Object.assign(observation.rows[0],{name:'Toggle animation',width:14,inlineColorControls:['Go to previous keyframe','Go to next keyframe','Add/Remove Keyframe','Reset Parameter'].map((name,i)=>({index:11+i,name,role:43,state:0,width:14,height:14,top:130}))});
  let inspections=0;const write=vi.fn(),request=vi.fn(async phase=>{
   if(phase==='parameter_inspect')inspections++;
   return inspections===2&&recovers?{ordinal:0,readback:observation}:{ordinal:0,readback:{status:'unverified',reason:phase==='parameter_scroll'?'COLOR_ROW_LAYOUT_CHANGED':'offscreen'}};
  });
  const result=await revealParameter(color,{request,write,assertTarget:async()=>{}});
  expect(result.status).toBe(recovers?'pass':'unverified');expect(inspections).toBe(2);expect(write).not.toHaveBeenCalled();expect(result.recovery.attempts).toBe(1);
 });
 it('scrolls an inline Color row by complete native parameter order without a nonexistent arrow write',async()=>{
  const color:EffectDisclosureWork={...work,target:{...work.target,parameterCount:3},parameter:{paramIndex:0,name:'Color',expanded:true,disclosureKey:'ECP.Slider.Expanded',inlineColor:{indices:[0,1],timeVarying:false}}};
  const observation:any={...raw([0,0,0]),rowMapping:{method:'complete_native_parameter_rows',parameterCount:3,colorIndices:[0,1]}};
  Object.assign(observation.rows[0],{name:'애니메이션 켜기/끄기',width:14,inlineColorControls:['이전 키프레임으로 이동','다음 키프레임으로 이동','키프레임 추가/제거','매개 변수 재설정'].map((name,i)=>({index:11+i,name,role:43,state:0,width:14,height:14,top:130}))});
  expect(parameterVisibleProves(color,observation,0)).toBe(true);
  for(const change of ['count','vector','animation','control','viewport']){
   const changed=structuredClone(observation);if(change==='count')changed.rowMapping.parameterCount=2;if(change==='vector')changed.rowMapping.colorIndices=[0,2];if(change==='animation')changed.rows[0].state=8;if(change==='control')changed.rows[0].inlineColorControls[0].name='wrong';if(change==='viewport')changed.viewport.top=500;
   expect(parameterVisibleProves(color,changed,0)).toBe(false);
  }
  const write=vi.fn(),request=vi.fn(async phase=>({status:'pass',ordinal:0,readback:phase==='parameter_inspect'?{...observation,viewport:{top:500,height:300}}:observation}));
  const result=await revealParameter(color,{write,request,assertTarget:async()=>{}});expect(result).toMatchObject({status:'pass',presentation:'inline_color_controls',scope:'exact_parameter'});expect(write).not.toHaveBeenCalled();expect(request.mock.calls.map(c=>c[0])).toEqual(['parameter_inspect','parameter_scroll']);
 });
 it.each([true,false])('rebuilds an exhausted invisible graph once; succeeds only on fresh visibility (%s)',async recovers=>{
  let binds=0,scrolls=0;
  const result=await revealParameter(work,{assertTarget:async()=>{},write:async()=>{},request:async phase=>{
   if(phase==='parameter_baseline'){binds++;return {status:'pass',readback:raw([0,0,0])};}
   if(phase==='parameter_verify'&&recovers&&binds===1)return {status:'pass',ordinal:1,readback:raw([0,8,0])};
   if(phase==='parameter_scroll')scrolls++;
   return {status:'pass',ordinal:1,readback:{...raw([0,32776,0]),steps:64}};
  }});
  expect(result.status).toBe(recovers?'pass':'unverified');expect(binds).toBe(1);expect(scrolls).toBe(recovers?1:2);
  expect(result.recovery.attempts).toBe(1);
 });
 it('rebinds once after scroll reconstruction, never accepts stale ordinal geometry',async()=>{
  const calls:string[]=[];let scans=0;
  const result=await revealParameter(work,{assertTarget:async()=>{},write:async b=>{calls.push('write:'+b);},request:async phase=>{
   calls.push(phase);if(phase==='parameter_inspect')return {ordinal:1,readback:{...raw([0,8,0]),viewport:{top:500,height:300}}};
   if(phase==='parameter_baseline')return {status:'pass',readback:raw([0,0,0])};
   if(phase==='parameter_scroll'&&scans++===0)return {readback:{status:'unverified',reason:'PARAMETER_LAYOUT_CHANGED:10->12'}};
   return {status:'pass',ordinal:1,readback:raw([0,8,0])};
  }});
  expect(result.status).toBe('pass');expect(calls.filter(c=>c==='parameter_inspect')).toHaveLength(2);expect(calls).toContain('write:false');expect(calls).toContain('write:true');
 });
 it('derives one isolated target and rejects ambiguous or cross-window changes',()=>{
  expect(deriveParameterOrdinal(work,raw([0,0,0]),raw([0,8,0]))).toBe(1);
  expect(deriveParameterOrdinal(work,raw([0,0,0]),raw([8,8,0]))).toBeUndefined();
  expect(deriveParameterOrdinal(work,raw([0,0,0]),{...raw([0,8,0]),panelHandle:3})).toBeUndefined();
  expect(parameterVisibleProves(work,raw([0,8,0]),1)).toBe(true);
  expect(parameterVisibleProves(work,raw([0,32776,0]),1)).toBe(false);
  expect(parameterVisibleProves(work,{...raw([0,8,0]),viewport:{top:500,height:300}},1)).toBe(false);
 });
 it('proves inline Point values without pretending the native hidden triangle is visible',()=>{
  const point={...work,parameter:{...work.parameter!,disclosureKey:'ECP.PointParameter.Expanded'}},observation=raw([32776,0]);
  Object.assign(observation.rows[0],{index:10,left:20,inlinePointControls:[15,16].map((index,i)=>({index,name:'UI_HotText',role:42,state:1048576,value:String(i+.5),left:100+i*50,top:130,width:45,height:15}))});observation.rows[1].index=20;
  expect(parameterVisibleProves(point,observation,0)).toBe(true);
  expect(parameterVisibleProves(work,observation,0)).toBe(false);
  for(const patch of [{state:32768},{top:90},{index:20},{role:43},{value:''},{left:5}]){
   const changed:any=structuredClone(observation);Object.assign(changed.rows[0].inlinePointControls[1],patch);expect(parameterVisibleProves(point,changed,0)).toBe(false);
  }
 });
 it('calibrates then scrolls, and does not mistake adapter completion for visible success',async()=>{
  const events:string[]=[],request=vi.fn(async(phase:string)=>{events.push(phase);return phase==='parameter_inspect'?{status:'pass',readback:raw([0,0,0])}:phase==='parameter_baseline'?{status:'pass',readback:raw([0,0,0])}:{status:'pass',ordinal:1,readback:{...raw([0,8,0]),viewport:{top:500,height:300}}};});
  const result=await revealParameter(work,{request,write:async b=>{events.push('write:'+b);},assertTarget:async()=>{}});
  expect(events).toEqual(['parameter_inspect','write:false','parameter_baseline','write:true','parameter_verify','parameter_scroll']);expect(result.status).toBe('unverified');
 });
 it('skips writes only when a fresh bound row already proves visibility',async()=>{const write=vi.fn();expect(await revealParameter(work,{write,request:async()=>({status:'pass',ordinal:1,readback:raw([0,8,0])}),assertTarget:async()=>{}})).toMatchObject({status:'pass',scope:'exact_parameter'});expect(write).not.toHaveBeenCalled();});
 it('retains the requested identity and proof scope despite adapter receipt fields',async()=>{
  const result=await revealParameter(work,{write:async()=>{},request:async()=>({status:'pass',scope:'effect_section',paramIndex:999,expectedDisplayName:'Other',ordinal:1,readback:raw([0,8,0])}),assertTarget:async()=>{}});
  expect(result).toMatchObject({status:'pass',scope:'exact_parameter',paramIndex:7,expectedDisplayName:'Value'});
 });
});
