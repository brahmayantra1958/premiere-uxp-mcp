import {it,expect,vi} from 'vitest';
import {uxpModules} from '../helpers/uxp-modules.js';
import {hostResponseReceipt} from '../../apps/mcp-server/src/host-operation-receipt.js';
import {lockFixture} from '../helpers/track-lock-fixture.js';

it.each(['video','audio','caption'] as const)('runs mute-only %s edits without a rename transaction and verifies actual mute readback',async mediaType=>{
  for(const apply of [true,false]){
    let muted=false;
    const forbidden=()=>vi.fn(()=>{throw Error('A mute-only edit must not enter a rename transaction');});
    const rename=forbidden(),lockedAccess=forbidden(),executeTransaction=forbidden();
    const isMuted=vi.fn(()=>muted),setMute=vi.fn((value:boolean)=>{if(apply)muted=value;return true;});
    const track={id:0,name:'Original track',getTrackItems:()=>[],isMuted,setMute,createSetNameAction:rename};
    const sequence={guid:'s',name:'Sequence',getSettings:()=>({getVideoFrameRect:()=>({width:1920,height:1080}),getVideoFrameRate:()=>({value:30})}),getEndTime:()=>({seconds:0,ticks:'0'}),
      getVideoTrackCount:()=>mediaType==='video'?1:0,getAudioTrackCount:()=>mediaType==='audio'?1:0,getCaptionTrackCount:()=>mediaType==='caption'?1:0,
      getVideoTrack:()=>track,getAudioTrack:()=>track,getCaptionTrack:()=>track};
    const project={guid:'p',path:'C:/audit.prproj',getActiveSequence:()=>sequence,lockedAccess,executeTransaction};
    const load=uxpModules({Project:{getActiveProject:()=>project},Constants:{TrackItemType:{CLIP:1,TRANSITION:2}}});
    const {PremiereHost}=load('apps/uxp-plugin/src/premiere-host.ts');
    const result=await new PremiereHost().dispatch({id:`mute-${mediaType}-${apply}`,command:'set_track_state',args:{expectedProjectId:'p',expectedSequenceId:'s',edits:[{mediaType,trackIndex:0,muted:true}]}});
    expect(result.status).toBe(apply?'pass':'fail');expect(result.hostResult).toMatchObject({renameResult:true,muteResult:true});
    const rows=mediaType==='caption'?'captionTrackStates':'tracks';
    expect(result.before[rows][0]).toMatchObject({name:'Original track',muted:false});
    expect(result.after[rows][0]).toMatchObject({name:'Original track',muted:apply});
    if(!apply)expect(result.errors).toContain(`Track mute mismatch: ${mediaType} 0`);
    expect(setMute).toHaveBeenCalledExactlyOnceWith(true);expect(isMuted.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(rename).not.toHaveBeenCalled();expect(lockedAccess).not.toHaveBeenCalled();expect(executeTransaction).not.toHaveBeenCalled();
  }
});

it.each([true,false])('runs lock-only edits through the bounded helper without any rename transaction and verifies locks (apply=%s)',async apply=>{
  const native=lockFixture();
  if(!apply)native.tracks[1]!.setLocked.mockImplementation(()=>{});
  const forbidden=()=>vi.fn(()=>{throw Error('A lock-only edit must not enter a UXP rename transaction');});
  const rename=forbidden(),lockedAccess=forbidden(),executeTransaction=forbidden();
  const names=native.tracks.map(track=>track.name);
  for(const track of native.tracks)Object.assign(track,{createSetNameAction:rename});
  const sequence={guid:native.scope.sequenceId,name:native.scope.sequenceName,getVideoTrackCount:()=>2,getAudioTrackCount:()=>1,getVideoTrack:(index:number)=>native.tracks[index],getAudioTrack:()=>native.tracks[2]};
  const project={guid:'p',path:native.scope.projectPath,getActiveSequence:()=>sequence,lockedAccess,executeTransaction};
  const fetch=vi.fn(async(_url:string,options:any)=>({ok:true,json:async()=>native.execute(JSON.parse(options.body))}));
  const load=uxpModules({Project:{getActiveProject:()=>project}},{fetch,__PREMIERE_MCP_TRACK_LOCK__:{port:8095,token:'c'.repeat(64),version:'0.1.0'}});
  const {PremiereHost}=load('apps/uxp-plugin/src/premiere-host.ts');
  const result=await new PremiereHost().dispatch({id:`lock-only-${apply}`,command:'set_track_locks',args:{expectedProjectId:'p',expectedSequenceId:sequence.guid,edits:native.request().edits}});
  expect(result.status).toBe(apply?'pass':'unverified');expect(fetch).toHaveBeenCalledTimes(1);
  if(apply){
    expect(result.before).toEqual(expect.arrayContaining([expect.objectContaining({mediaType:'video',trackIndex:1,locked:true})]));
    expect(result.after).toEqual(expect.arrayContaining([expect.objectContaining({mediaType:'video',trackIndex:1,locked:false})]));
    expect(result.hostResult).toMatchObject({unrequestedLocksPreserved:true,mutePreserved:true});
  }
  expect(native.tracks.map(track=>track.locked)).toEqual([false,!apply,false]);expect(native.tracks.map(track=>track.name)).toEqual(names);
  expect(rename).not.toHaveBeenCalled();expect(lockedAccess).not.toHaveBeenCalled();expect(executeTransaction).not.toHaveBeenCalled();
});

it.each([false,true])('identity-only timeline edits skip native transactions but still require final item readback (disappears=%s)',async disappears=>{
  let snapshots=0;
  const forbidden=()=>vi.fn(()=>{throw Error('An identity-only edit must not create a native action or transaction');});
  const rename=forbidden(),disable=forbidden(),lockedAccess=forbidden(),executeTransaction=forbidden();
  const time=(seconds:number)=>({seconds,ticks:String(seconds*254016000000)});
  const item={getProjectItem:()=>({getId:()=> 'source'}),getName:()=> 'Clip',getStartTime:()=>time(0),getEndTime:()=>time(1),getInPoint:()=>time(3),getOutPoint:()=>time(4),isDisabled:()=>false,getSpeed:()=>1,isSpeedReversed:()=>false,isAdjustmentLayer:()=>false,createSetNameAction:rename,createSetDisabledAction:disable};
  const track={id:1,name:'Video',isMuted:()=>false,getTrackItems:(type:number)=>type===1&&!(disappears&&snapshots>1)?[item]:[]};
  const sequence={guid:'s',name:'Sequence',getSettings:()=>{snapshots++;return {getVideoFrameRect:()=>({width:1920,height:1080}),getVideoFrameRate:()=>({value:30})};},getEndTime:()=>time(1),getVideoTrackCount:()=>1,getAudioTrackCount:()=>0,getCaptionTrackCount:()=>0,getVideoTrack:()=>track};
  const project={guid:'p',path:'C:/audit.prproj',getActiveSequence:()=>sequence,lockedAccess,executeTransaction};
  const load=uxpModules({Project:{getActiveProject:()=>project},Constants:{TrackItemType:{CLIP:1,TRANSITION:2}}});
  const {PremiereHost}=load('apps/uxp-plugin/src/premiere-host.ts');
  const result=await new PremiereHost().dispatch({id:`identity-only-${disappears}`,command:'set_timeline_item_state',args:{expectedProjectId:'p',expectedSequenceId:'s',edits:[{trackItemId:'video:0:0:source'}]}});
  expect(snapshots).toBe(2);expect(result.before.items).toHaveLength(1);expect(result.after.items).toHaveLength(disappears?0:1);
  expect(result.status).toBe(disappears?'fail':'pass');
  if(disappears)expect(result.errors).toContain('Timeline item disappeared during readback: video:0:0:source');
  else expect(result.after.items).toEqual(result.before.items);
  expect(rename).not.toHaveBeenCalled();expect(disable).not.toHaveBeenCalled();expect(lockedAccess).not.toHaveBeenCalled();expect(executeTransaction).not.toHaveBeenCalled();
});

// Regression coverage executes the actual host queue with fake Adobe objects.
it.each(['available','removed','other-project'])('keeps track edits pinned after user navigation (%s)',async mode=>{
  const makeTrack=(name:string)=>({id:0,name,muted:false,getTrackItems:()=>[],isMuted(){return this.muted;},createSetNameAction(value:string){return ()=>{this.name=value;};},setMute(value:boolean){this.muted=value;return true;}});
  const aTrack=makeTrack('Old'),bTrack=makeTrack('New');
  const makeSequence=(guid:string,track:any)=>({guid,name:guid,getSettings:()=>({getVideoFrameRect:()=>({width:1920,height:1080}),getVideoFrameRate:()=>({value:30})}),getEndTime:()=>({seconds:0,ticks:'0'}),getVideoTrackCount:()=>0,getAudioTrackCount:()=>1,getCaptionTrackCount:()=>0,getAudioTrack:()=>track});
  const a=makeSequence('a',aTrack),b=makeSequence('b',bTrack);
  let active=a;
  const project={guid:'p',path:'C:/audit.prproj',getActiveSequence:()=>active,getSequences:()=>mode==='removed'&&active===b?[b]:[a,b],lockedAccess:(fn:any)=>fn(),executeTransaction:(fn:any)=>{fn({addAction:(action:any)=>action()});active=b;if(mode==='other-project')project.guid='other';return true;}};
  const load=uxpModules({Project:{getActiveProject:()=>project},Constants:{TrackItemType:{CLIP:1,TRANSITION:2}}});
  const {PremiereHost}=load('apps/uxp-plugin/src/premiere-host.ts'),host=new PremiereHost();
  const request={id:'audit',command:'set_track_state',args:{expectedProjectId:'p',expectedSequenceId:'a',edits:[{mediaType:'audio',trackIndex:0,name:'New',muted:true}]}};
  if(mode==='available'){
    const result=await host.dispatch(request);
    expect(aTrack.muted).toBe(true);
    expect(result).toMatchObject({status:'pass',actualTarget:{sequenceId:'a'},after:{id:'a'}});
  }else{
    await expect(host.dispatch(request)).rejects.toMatchObject({code:mode==='removed'?'SEQUENCE_PRECONDITION_FAILED':'PROJECT_PRECONDITION_FAILED',details:undefined});
    expect(aTrack.muted).toBe(false);
    // The rename already ran; this must not release the receipt as no-write.
    expect(aTrack.name).toBe('New');
  }
  expect(bTrack.muted).toBe(false);
  expect(active).toBe(b);
});

it('includes target identity on marker collection reads',async()=>{
  const project={guid:'p',getActiveSequence:()=>({guid:'s',name:'S'})};
  const load=uxpModules({Project:{getActiveProject:()=>project}});
  const {followTimelineWork}=load('apps/uxp-plugin/src/host-work-target.ts');
  const result=await followTimelineWork({id:'markers',command:'inspect_markers',args:{expectedProjectId:'p',expectedSequenceId:'s'}},vi.fn(),async()=>[{id:'marker'}],vi.fn());
  expect(result.items).toEqual([{id:'marker'}]);
  expect(result.actualTarget).toMatchObject({projectId:'p',sequenceId:'s'});
});

it('classifies missing-parent bin preflight without an uncertain write',async()=>{
  const transaction=vi.fn(),project={guid:'p',path:'C:/audit.prproj',getActiveSequence:()=>({guid:'s',name:'S'}),getRootItem:()=>({getId:()=> 'root',getItems:()=>[]}),executeTransaction:transaction};
  const load=uxpModules({Project:{getActiveProject:()=>project}});
  const {PremiereHost}=load('apps/uxp-plugin/src/premiere-host.ts');
  let error:any;
  try{await new PremiereHost().dispatch({id:'bin',command:'create_bin',args:{expectedProjectId:'p',expectedSequenceId:'s',parentBinId:'missing',name:'New'}});}catch(e){error=e;}
  expect(transaction).not.toHaveBeenCalled();
  expect(error.code).toBe('PROJECT_ITEM_NOT_FOUND');
  const receipt=hostResponseReceipt({version:1,id:'bin',ok:false,durationMs:0,error:{code:error.code,message:error.message,details:error.details}}, {},{commandId:'bin',command:'create_bin',startedAt:'2026-09-24T00:00:00Z',completedAt:'2026-09-24T00:00:00Z'});
  expect(receipt).toMatchObject({status:'fail',errorClassification:'preflight',hostResult:{contentDispatched:false}});
});
