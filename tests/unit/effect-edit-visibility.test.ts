import {describe,it,expect,vi} from 'vitest';
vi.mock('../../apps/uxp-plugin/src/host-work-target.js',()=>({followTimelineWork:async(_r:any,_select:any,run:()=>Promise<any>)=>run()}));
vi.mock('../../apps/uxp-plugin/src/host-context.js',()=>({ppro:{},uxp:{},inspectHostContext:async()=>({activeProject:true,activeSequence:true,projectPath:"C:/test.prproj",projectId:"p",sequenceId:"s",sequenceName:"s"})}));
import {PremiereHost} from '../../apps/uxp-plugin/src/premiere-host.js';
import {workFollow} from '../../apps/uxp-plugin/src/work-follow.js';
import {noteGraphicMutation} from '../../apps/uxp-plugin/src/graphic-lifecycle.js';
import {effectTargetLookupHint} from '../../apps/uxp-plugin/src/effect-target-lookup.js';
describe('effect content is independent from automatic display follow',()=>{
 it('reports panel native cost separately from the unchanged audio quiet period',async()=>{
  vi.useFakeTimers();
  let pending:Promise<any>|undefined;
  try {
   noteGraphicMutation(Date.now()-1000);
   const host=new PremiereHost() as any;
   host.nativeVisibility=vi.fn(async()=>{await new Promise(resolve=>setTimeout(resolve,40));return {status:'pass'};});
   pending=host.revealPanel({version:1,id:'panel-timing',command:'set_effect_values',args:{expectedProjectId:'p',expectedSequenceId:'s',expectedMediaType:'audio'},timeoutMs:5000});
   await vi.advanceTimersByTimeAsync(290);
   expect(await pending).toMatchObject({status:'pass',panelPhaseTimingsMs:{contextBefore:0,nativeRequest:40,audioQuiet:250,contextAfter:0,total:290}});
   expect(host.nativeVisibility).toHaveBeenCalledOnce();
  }finally{await vi.runAllTimersAsync();if(pending)await pending;vi.useRealTimers();}
 });
 it.each(['unverified','throws'])('settles an audio panel reconstruction before content even when native visibility %s',async outcome=>{
  vi.useFakeTimers();
  let pending:Promise<any>|undefined;
  try {
   noteGraphicMutation(Date.now()-1000);
   const host=new PremiereHost() as any;
   host.prepareNativeEffectTime=vi.fn();host.revealEffect=vi.fn();
   host.nativeVisibility=vi.fn(async()=>{if(outcome==='throws')throw Error('NATIVE_PANEL_PROOF_FAILED');return {status:'unverified'};});
   host.dispatchCommand=vi.fn(async()=>({status:'pass'}));
   pending=host.dispatch({version:1,id:'audio-settle',command:'set_effect_values',args:{expectedMediaType:'audio'},timeoutMs:5000});
   await vi.advanceTimersByTimeAsync(250);
   expect(host.nativeVisibility).toHaveBeenCalledOnce();expect(host.dispatchCommand).not.toHaveBeenCalled();
   await vi.advanceTimersByTimeAsync(249);
   expect(host.dispatchCommand).not.toHaveBeenCalled();
   await vi.advanceTimersByTimeAsync(1);
   expect(await pending).toMatchObject({status:'pass',visibility:{status:'unverified'}});
   expect(host.dispatchCommand).toHaveBeenCalledOnce();expect(host.revealEffect).not.toHaveBeenCalled();
  }finally{await vi.runAllTimersAsync();if(pending)await pending;vi.useRealTimers();}
 });
 it.each(['set_effect_values','set_effect_keyframes','edit_effect_keyframes','remove_effect','set_transform','set_basic_grade','set_audio_level','apply_color_adjustments','scale_clip_to_fill'])('reveals Effect Controls for %s but dispatches even when the disclosure fails',async command=>{
  const host=new PremiereHost() as any;
  host.prepareNativeEffectTime=vi.fn();host.revealPanel=vi.fn(async()=>({status:'pass'}));host.revealEffect=vi.fn(async()=>({status:'unverified',reason:'VIEWPORT_RESIZED'}));
  host.dispatchCommand=vi.fn(async()=>({status:'pass'}));
  const result=await host.dispatch({version:1,id:'one',command,args:{},timeoutMs:1000});
  expect(result).toMatchObject({status:'pass',visibility:{status:'pass',effectExpansion:{status:'unverified'}}});
  expect(host.dispatchCommand).toHaveBeenCalledOnce();expect(host.revealPanel).toHaveBeenCalledOnce();expect(host.revealEffect).toHaveBeenCalledOnce();
 });
 it('keeps the content result when the panel reveal itself throws',async()=>{
  const host=new PremiereHost() as any;
  host.prepareNativeEffectTime=vi.fn();host.revealPanel=vi.fn(async()=>{throw Error('PANEL_GONE');});host.revealEffect=vi.fn();
  host.dispatchCommand=vi.fn(async()=>({status:'pass'}));
  const result=await host.dispatch({version:1,id:'one',command:'set_transform',args:{},timeoutMs:1000});
  expect(result).toMatchObject({status:'pass',visibility:{status:'unverified',reason:'PANEL_GONE'}});expect(host.revealEffect).not.toHaveBeenCalled();expect(host.dispatchCommand).toHaveBeenCalledOnce();
 });
 it.each(['effect_section','exact_parameter'])('leaves parameter identity/value checks to content preflight, independent of display: %s',async scope=>{
  const host=new PremiereHost() as any;
  host.prepareNativeEffectTime=vi.fn();host.revealPanel=vi.fn(async()=>({status:'pass'}));host.revealEffect=vi.fn(async()=>({status:'pass',parameterScroll:{status:'pass',scope}}));
  host.dispatchCommand=vi.fn(async()=>({status:'pass'}));
  const result=await host.dispatch({version:1,id:'one',command:'set_effect_values',args:{parameters:[{paramIndex:3,expectedDisplayName:'Value',value:1}]},timeoutMs:1000});
  expect(host.dispatchCommand).toHaveBeenCalledOnce();expect(result.status).toBe('pass');expect(result.visibility.parameterScroll).toEqual({status:'pass',scope});
 });
 it('discloses the appended effect after insertion without hiding the completed content when that fails',async()=>{
  const host=new PremiereHost() as any;
  host.prepareNativeEffectTime=vi.fn();host.revealPanel=vi.fn(async()=>({status:'pass'}));host.revealEffect=vi.fn(async()=>({status:'unverified'}));
  host.dispatchCommand=vi.fn(async()=>({status:'pass',hostResult:{componentIndex:0},after:[{matchName:'effect'}]}));
  const result=await host.dispatch({version:1,id:'one',command:'apply_video_effect',args:{},timeoutMs:1000});
  expect(result.status).toBe('pass');expect(host.dispatchCommand).toHaveBeenCalledOnce();
  expect(host.revealEffect).toHaveBeenCalledOnce();expect(host.revealEffect.mock.calls[0][0].args).toMatchObject({componentIndex:0,componentMatchName:'effect'});
  expect(result.visibility.effectExpansion.status).toBe('unverified');
 });
 it('performs no display work when automatic follow is turned off',async()=>{
  workFollow.enabled=false;
  try{
   const host=new PremiereHost() as any;
   host.prepareNativeEffectTime=vi.fn();host.revealPanel=vi.fn(async()=>({status:'pass'}));host.revealEffect=vi.fn(async()=>({status:'pass'}));
   host.dispatchCommand=vi.fn(async()=>({status:'pass',hostResult:{componentIndex:0},after:[{matchName:'effect'}]}));
   for(const command of ['set_transform','apply_video_effect'])expect((await host.dispatch({version:1,id:command,command,args:{},timeoutMs:1000})).status).toBe('pass');
   expect(host.revealPanel).not.toHaveBeenCalled();expect(host.revealEffect).not.toHaveBeenCalled();
  }finally{workFollow.enabled=true;}
 });
 it.each(['apply_audio_effect','apply_video_effect'])('keeps the exact target numeric hint through %s post-add disclosure and drops it on completion',async command=>{
  const host=new PremiereHost() as any;
  const args={expectedProjectId:'p',expectedSequenceId:'s',trackItemId:'audio:0:0:source'};
  let followArgs:any;
  host.prepareNativeEffectTime=vi.fn();host.revealPanel=vi.fn(async()=>({status:'pass'}));
  host.dispatchCommand=vi.fn(async()=>{
   Object.assign(effectTargetLookupHint(args)!,{id:args.trackItemId,index:119});
   return {status:'pass',hostResult:{componentIndex:2},after:[{},{},{matchName:'effect'}]};
  });
  host.revealEffect=vi.fn(async(request:any)=>{
   followArgs=request.args;
   expect(followArgs).not.toBe(args);
   expect(effectTargetLookupHint(followArgs)).toBe(effectTargetLookupHint(args));
   expect(effectTargetLookupHint(followArgs)).toEqual({id:args.trackItemId,index:119});
   return {status:'pass'};
  });
  expect((await host.dispatch({version:1,id:command,command,args,timeoutMs:1000})).status).toBe('pass');
  expect(host.revealEffect).toHaveBeenCalledOnce();
  expect(effectTargetLookupHint(args)).toBeUndefined();expect(effectTargetLookupHint(followArgs)).toBeUndefined();
 });
});
