import {describe,it,expect,vi} from 'vitest';
import {revealEffectDisclosure} from '../../apps/uxp-plugin/src/effect-disclosure.js';
import {deriveEffectHeaderBinding,effectRevealPlan,resolveEffectObservation,effectDisclosureProves,effectSectionProves,effectQueryScopeProves,type EffectDisclosureWork} from '@premiere-uxp/contracts/effect-disclosure';
const work:EffectDisclosureWork={sequenceName:'WORKING__test',componentMatchNames:['vendor.any','vendor.other','vendor.any'],target:{mediaType:'video',trackIndex:0,startTicks:'100',endTicks:'200',clipName:'clip',mediaPath:'C:\\clip.mov',componentMatchName:'vendor.any',componentIndex:2,parameterCount:2}};
const raw=(bits:boolean[])=>({protocol:1,status:'pass',route:'windows_msaa_effect_state',premierePid:10,panelHandle:20,selectedClipTab:'WORKING__test • clip',headers:bits.map((on,i)=>({role:43,state:on?8:0,height:14,top:180+i*100})),viewport:{role:3,top:153,height:402}});
// Native order differs from UXP. The target group is discovered from transition.
const binding=deriveEffectHeaderBinding(work,raw([false,true,false]),raw([true,true,true]))!;
const state=(on:boolean)=>({...raw([on,true,on]),binding});
function fixture(learn=false){
 const events:string[]=[];
 const services={assertTarget:vi.fn(async()=>{events.push('guard');}),clearSelection:vi.fn(async()=>{events.push('clear');}),restoreSelection:vi.fn(async()=>{events.push('restore');}),yieldToHost:vi.fn(async()=>{events.push('yield');}),request:vi.fn(async(phase:string)=>{events.push(phase);return phase==='clear_verify'?{status:'pass',empty:true}:phase==='inspect'?{status:'pass',available:true,layoutVerified:true,readback:learn?raw([true,true,true]):state(false)}:phase==='write'||phase==='calibrate_write'?{status:'pass',uiVerified:false}:phase==='calibrate_verify'?{status:'pass',layoutVerified:true,readback:raw([false,true,false])}:{status:'pass',readback:state(true)};})};
 return {services,events,run:()=>revealEffectDisclosure(work,services)};
}
describe('effect disclosure derivation and host boundary',()=>{
 it('derives unknown effect groups from controlled transitions rather than UI order',()=>{
  expect(binding.headerIndices).toEqual([0,2]);expect(resolveEffectObservation(work,state(true))?.index).toBe(2);
  expect(effectRevealPlan(work,raw([true,true,true]))).toBe('calibrate');expect(effectRevealPlan(work,state(false))).toBe('write');expect(effectRevealPlan(work,state(true))).toBe('ready');
 });
 it('binds duplicate installed effects to independent component slots',()=>{
  const w={...work,target:{...work.target,disclosureScope:'component' as const}},before=raw([true,true,false]),after=raw([true,true,true]);
  const learned=deriveEffectHeaderBinding(w,before,after)!;
  expect(learned.headerIndices).toEqual([2]);expect(effectDisclosureProves(w,{...after,binding:learned})).toBe(true);
  expect(effectDisclosureProves({...w,target:{...w.target,componentIndex:0}},{...after,binding:learned})).toBe(false);
  expect(deriveEffectHeaderBinding(w,raw([false,true,false]),after)).toBeUndefined();
 });
 it('writes component display only after native clearing and keeps both calibration values',async()=>{
  const w={...work,target:{...work.target,disclosureScope:'component' as const}},f=fixture(true),a=raw([true,true,true]),b=raw([true,true,false]);
  const writeComponentDisclosure=vi.fn(async()=>({status:'pass'}));
  f.services.request.mockImplementation(async phase=>phase==='inspect'?{available:true,layoutVerified:true,readback:a} as any:phase==='clear_verify'?{status:'pass',empty:true}:phase==='calibrate_verify'?{status:'pass',layoutVerified:true,readback:b}:phase==='verify'?{status:'pass',readback:{...a,binding:deriveEffectHeaderBinding(w,b,a)}}:{status:'pass'} as any);
  expect(await revealEffectDisclosure(w,{...f.services,writeComponentDisclosure})).toMatchObject({status:'pass',scope:'component',affectedHeaderIndices:[2]});
  expect(writeComponentDisclosure.mock.calls).toEqual([[false],[true]]);
 });
 it('rejects count-only guesses, partial duplicate transitions and unrelated changes',()=>{
  expect(deriveEffectHeaderBinding(work,raw([false,true,false]),raw([true,true,false]))).toBeUndefined();
  expect(deriveEffectHeaderBinding(work,raw([false,false,false]),raw([true,true,true]))).toBeUndefined();
  expect(effectDisclosureProves(work,raw([true,true,true]))).toBe(false);
  expect(effectDisclosureProves({...work,componentMatchNames:['vendor.other','vendor.any','vendor.any']},state(true))).toBe(false);
  expect(deriveEffectHeaderBinding(work,raw([false,true,false]),{...raw([true,true,true]),panelHandle:30})).toBeUndefined();
 });
 it('generalizes group identity across generated arbitrary names and positions',()=>{
  for(let count=1;count<=32;count++){
   const names=Array.from({length:count},(_,i)=>'vendor.'+(i%3)),target=count-1,name=names[target]!;
   const w={...work,componentMatchNames:names,target:{...work.target,componentIndex:target,componentMatchName:name}};
   const native=[...names].reverse(),b=raw(native.map(n=>n!==name)),a=raw(native.map(()=>true));
   const learned=deriveEffectHeaderBinding(w,b,a);expect(learned).toBeDefined();
   expect(effectDisclosureProves(w,{...a,binding:learned},true)).toBe(true);
   expect(effectDisclosureProves({...w,expanded:false},{...b,binding:learned},true)).toBe(true);
  }
 });
 it('binds effect query navigation to first actual result and its component slot',()=>{
  const actual={...work,trackItemId:'video:0:100:source',target:{...work.target,componentIndex:0}};
  expect(effectQueryScopeProves('query_timeline',{includeEffects:true,ids:[actual.trackItemId]},actual)).toBe(true);
  for(const args of [{includeEffects:false},{includeEffects:true,ids:['other']},{includeEffects:true,mediaType:'audio'},{includeEffects:true,trackIndex:1},{includeEffects:true,nameContains:'other'}])expect(effectQueryScopeProves('query_timeline',args,actual)).toBe(false);
  expect(effectQueryScopeProves('query_timeline',{includeEffects:true},{...actual,expanded:false})).toBe(false);
  expect(effectQueryScopeProves('query_timeline',{includeEffects:true},{...actual,target:work.target})).toBe(false);
 });
 it('learns an unknown layout with two guarded preference cycles and no content edit',async()=>{
  const f=fixture(true);expect(await f.run()).toMatchObject({status:'pass',calibrated:true,affectedHeaderIndices:[0,2],initialObservation:{plan:'calibrate',headerExpanded:[true,true,true]}});
  expect(f.services.request.mock.calls.map(c=>c[0])).toEqual(['inspect','clear_verify','calibrate_write','calibrate_verify','clear_verify','write','verify']);
  expect(f.services.clearSelection).toHaveBeenCalledTimes(2);expect(f.services.restoreSelection).toHaveBeenCalledTimes(2);
 });
 it('retains event boundaries and native verification for a known layout',async()=>{
  const f=fixture();expect(await f.run()).toMatchObject({status:'pass',restored:true,initialObservation:{plan:'write',headerExpanded:[false,true,false]}});
  expect(f.events).toEqual(['guard','inspect','guard','clear','yield','guard','clear_verify','guard','write','guard','restore','yield','guard','verify','guard']);
 });
 it('records an already-ready first observation without adding native calls',async()=>{
  const f=fixture();f.services.request.mockImplementation(async phase=>{f.events.push(phase);return {status:'pass',available:true,layoutVerified:true,readback:state(true)} as any;});
  const result=await f.run();
  expect(result).toMatchObject({status:'pass',changed:false,initialObservation:{plan:'ready',headerExpanded:[true,true,true]}});
  expect(Object.keys(result.initialObservation).sort()).toEqual(['headerExpanded','plan']);
  expect(f.events).toEqual(['guard','inspect']);expect(f.services.clearSelection).not.toHaveBeenCalled();
 });
 it('does not publish a successful initial diagnostic from an incomplete or oversized observation',async()=>{
  for(const observation of [{...raw([true,true,true]),status:'unverified'},raw(Array(129).fill(true))]){
   const f=fixture();f.services.request.mockImplementation(async phase=>{f.events.push(phase);return {status:'pass',available:true,layoutVerified:true,readback:observation} as any;});
   const result=await f.run();expect(result.status).toBe('unverified');expect(result.initialObservation).toBeUndefined();
   expect(f.events).toEqual(['guard','inspect']);
  }
 });
 it('collapses the shared group only through the explicit UI command',async()=>{
  const f=fixture();f.services.request.mockImplementation(async phase=>phase==='clear_verify'?{status:'pass',empty:true}:phase==='inspect'?{available:true,layoutVerified:true,readback:state(true)} as any:phase==='write'?{status:'pass'}:{status:'pass',readback:state(false)} as any);
  expect(await revealEffectDisclosure({...work,expanded:false},f.services)).toMatchObject({status:'pass',changed:true,parameterScroll:{scope:'collapsed_effect_header'}});
  expect(f.services.request.mock.calls.map(c=>c[0])).toEqual(['inspect','clear_verify','write','verify']);
 });
 it('uses actual property count to distinguish a single row from a clipped section',()=>{
  const observed={...state(true),headers:state(true).headers.map((h,i)=>i===2?{...h,top:513}:h)};
  expect(effectSectionProves({...work,target:{...work.target,parameterCount:1}},observed)).toBe(true);
  expect(effectSectionProves(work,observed)).toBe(false);
  expect(effectSectionProves({...work,target:{...work.target,parameterCount:1}},{...observed,viewport:{...observed.viewport,height:401}})).toBe(false);
 });
 it('proves a zero-parameter effect through its visible enable anchor, not its intentionally hidden arrow',()=>{
  const w={...work,target:{...work.target,parameterCount:0}},r=state(true);
  r.headers[2]={...r.headers[2]!,state:32776,enable:{role:43,state:8,top:420,height:16}} as any;
  expect(effectSectionProves(w,r)).toBe(true);
  expect(effectSectionProves(work,r)).toBe(false);
  (r.headers[2] as any).enable.state=32776;expect(effectSectionProves(w,r)).toBe(false);
  delete (r.headers[2] as any).enable;expect(effectSectionProves(w,r)).toBe(false);
 });
 it('scrolls an already expanded offscreen target without preference changes',async()=>{
  const f=fixture(),hidden={...state(true),headers:state(true).headers.map((h,i)=>i===2?{...h,state:32776,top:39}:h)};
  f.services.request.mockImplementation(async phase=>phase==='clear_verify'?{status:'pass',empty:true}:phase==='inspect'?{available:false,layoutVerified:true,readback:hidden} as any:{status:'pass',readback:state(true)});
  expect(await f.run()).toMatchObject({status:'pass'});expect(f.services.clearSelection).not.toHaveBeenCalled();expect(f.services.request.mock.calls.map(c=>c[0])).toEqual(['inspect','scroll']);
 });
 it('does not clear selection if the helper is unavailable',async()=>{
  const f=fixture();f.services.request.mockResolvedValue({status:'unsupported'} as any);expect((await f.run()).status).toBe('unsupported');expect(f.services.clearSelection).not.toHaveBeenCalled();
 });
 it.each(['write','calibrate_write'])('restores selection after an uncertain %s without replay',async phase=>{
  const f=fixture(phase==='calibrate_write');const original=f.services.request.getMockImplementation()!;
  f.services.request.mockImplementation(async p=>p===phase?{status:'unverified'} as any:original(p));
  expect(await f.run()).toMatchObject({status:'unverified',restored:true});expect(f.services.restoreSelection).toHaveBeenCalledOnce();
 });
 it('never restores into a changed project or clip',async()=>{
  const f=fixture();f.services.request.mockImplementation(async phase=>{if(phase==='clear_verify')return {status:'pass',empty:true};if(phase==='write'){f.services.assertTarget.mockRejectedValue(Error('Target changed'));return {status:'pass'};}return {available:true,layoutVerified:true,readback:state(false)} as any;});await expect(f.run()).rejects.toThrow('Target changed');expect(f.services.restoreSelection).not.toHaveBeenCalled();
 });
});
