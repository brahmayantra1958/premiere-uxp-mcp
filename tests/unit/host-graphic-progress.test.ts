import {it,expect} from 'vitest';
import {uxpModules} from '../helpers/uxp-modules.js';

it.each(['none','values','source-bounds'])('reacquires graphics and rejects final value/source drift after trim (drift=%s)',async(drift)=>{
  const ticksPerSecond=254016000000;
  const time=(seconds:number)=>({seconds,ticks:String(Math.round(seconds*ticksPerSecond))});
  const items:Array<{end:number}>=[];
  let epoch=0,componentReads=0,trims=0,sourceDelta=0;
  const wrapper=(item:{end:number})=>{
    const acquired=epoch;
    return {getProjectItem:()=>null,getName:()=> 'Graphic',getStartTime:()=>time(0),getEndTime:()=>time(item.end),getInPoint:()=>time(3600+sourceDelta),getOutPoint:()=>time(3600+sourceDelta+item.end),isDisabled:()=>false,getSpeed:()=>1,isSpeedReversed:()=>false,isAdjustmentLayer:()=>false,
      getComponentChain:async()=>{expect(acquired).toBe(epoch);componentReads++;if(trims&&drift==='source-bounds')sourceDelta=1;return {getComponentCount:()=>1,getComponentAtIndex:()=>({getParamCount:()=>1,getParam:()=>({displayName:'Value',getValueAtTime:async()=>({value:drift==='values'&&trims?99:100}),isTimeVarying:()=>false,areKeyframesSupported:async()=>true,getKeyframeListAsTickTimes:()=>[]}),getDisplayName:async()=> 'Graphic',getMatchName:async()=>{epoch++;return 'AE.ADBE Graphic Group';}})};},
      createSetEndAction:(end:{seconds:number})=>{expect(acquired).toBe(epoch);return ()=>{item.end=end.seconds;trims++;epoch++;};}};
  };
  const sequence={guid:'s',name:'S',getTimebase:()=>String(ticksPerSecond/24),getSettings:()=>({getVideoFrameRect:()=>({width:1920,height:1080}),getVideoFrameRate:()=>({value:24})}),getVideoTrackCount:()=>1,getAudioTrackCount:()=>1,getCaptionTrackCount:()=>0,getEndTime:()=>time(5),
    getVideoTrack:()=>({id:1,name:'Graphics',getTrackItems:(type:number)=>type===1?items.map(wrapper):[]}),getAudioTrack:()=>({id:1,name:'Audio',getTrackItems:()=>[]})};
  const project={guid:'p',path:'C:/fixture.prproj',getActiveSequence:()=>sequence,lockedAccess:(f:any)=>f(),executeTransaction:(f:any)=>{f({addAction:(a:any)=>a()});return true;}};
  const editor={insertMogrtFromPath:()=>{const item={end:5};items.push(item);return [wrapper(item)];}};
  const load=uxpModules({Project:{getActiveProject:()=>project},Constants:{TrackItemType:{CLIP:1,TRANSITION:2}},SequenceEditor:{getEditor:()=>editor},TickTime:{TIME_ZERO:time(0),createWithTicks:(ticks:string)=>({ticks,seconds:Number(ticks)/ticksPerSecond})}});
  const {PremiereHost}=load('apps/uxp-plugin/src/premiere-host.ts'),{CommandExecutionLedger}=load('apps/uxp-plugin/src/command-execution-ledger.ts'),{HostCommandQueue}=load('apps/uxp-plugin/src/host-command-queue.ts');
  const request={version:1,id:'graphic',command:'insert_mogrt_caption',timeoutMs:5000,args:{expectedProjectId:'p',expectedSequenceId:'s',expectedSequenceName:'S',expectedVideoTrackCount:1,expectedAudioTrackCount:1,expectedCaptionTrackCount:0,expectedTimelineItemCount:0,videoTrackIndex:0,expectedVideoTrackId:1,expectedVideoTrackName:'Graphics',audioTrackIndex:0,timeSeconds:0,durationSeconds:1/24,mogrtPath:'C:/private/example.mogrt'}};
  const ledger=new CommandExecutionLedger();ledger.begin(request);
  const result=await new HostCommandQueue().run(request,()=>new PremiereHost().dispatchCommand(request));
  expect(result.status).toBe(drift==='none'?'pass':'unverified');expect(componentReads).toBeGreaterThan(3);expect(trims).toBe(1);expect(items[0]!.end).toBe(1/24);
  if(drift==='values')expect(result.errors.join(';')).toContain('Graphic duration changed component values or animation');
  if(drift==='source-bounds')expect(result.errors.join(';')).toContain('Graphic source bounds changed across final timeline and component readback');
  if(drift==='none')expect(result.hostResult.sourceBoundsProof).toEqual({status:'pass',basis:'fresh_timeline_and_settled_component_readback',item:result.hostResult.insertedItem});
  else expect(result.hostResult.sourceBoundsProof).toBeUndefined();
  expect(result.hostResult.insertedComponents[0].matchName).toBe('AE.ADBE Graphic Group');
  ledger.complete({version:1,id:'graphic',ok:true,result,durationMs:1});
  const observed=ledger.inspect(['graphic']).commands[0];expect(observed.state).toBe('complete');expect(observed.diagnostics.activeCalls).toEqual([]);
  expect(observed.diagnostics.recentCalls.some((call:any)=>call.phase==='graphic.components.final'&&call.method==='getComponentChain')).toBe(true);
  expect(JSON.stringify(observed.diagnostics)).not.toContain('C:/private');
});
