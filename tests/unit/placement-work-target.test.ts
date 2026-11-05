import {describe,expect,it,vi} from 'vitest';
import {uxpModules} from '../helpers/uxp-modules.js';

function fixture() {
  const time=(seconds:number)=>({seconds,ticks:String(Math.round(seconds*254016000000))});
  let position=time(0),selected:any[]=[],displayed:any[]=[];
  const items:any[]=[];
  const source={name:'voice.wav',getId:()=> 'voice-source',getMediaFilePath:()=> 'C:/voice.wav'};
  const clip=(seconds:number)=>({getName:()=>source.name,getProjectItem:()=>source,getStartTime:()=>time(seconds),getEndTime:()=>time(seconds+2),getIsSelected(){return selected.includes(this);}});
  const audio={name:'Voice',getTrackItems:(kind:number)=>kind===1?items:[],isMuted:()=>false};
  const video={name:'Video',getTrackItems:()=>[],isMuted:()=>false};
  const selection={addItem:(raw:any)=>{selected.push(raw);return true;},getTrackItems:()=>selected};
  const sequence={guid:'sequence',name:'WORKING__Voice',getVideoTrackCount:()=>1,getAudioTrackCount:()=>1,getCaptionTrackCount:()=>0,
    getAudioTrack:()=>audio,getVideoTrack:()=>video,getTimebase:()=> '8467200000',getEndTime:()=>time(30),
    getSettings:()=>({getVideoFrameRect:()=>({width:1920,height:1080}),getVideoFrameRate:()=>({value:30})}),
    getPlayerPosition:()=>position,setPlayerPosition:(next:any)=>{position=next;return true;},
    clearSelection:()=>{selected=[];displayed=[];},getSelection:()=>selection,
    setSelection:vi.fn((s:any)=>{displayed=[...s.getTrackItems()];return true;})};
  const root={getId:()=> 'root',getItems:()=>[source]};
  const project={guid:'project',path:'C:/scratch/work.prproj',name:'Work',getRootItem:()=>root,getActiveSequence:()=>sequence,
    openSequence:vi.fn(()=>true),setActiveSequence:vi.fn(()=>true),lockedAccess:(f:()=>void)=>f(),
    executeTransaction:(f:any)=>{f({addAction:(action:()=>void)=>action()});return true;}};
  const editor={createOverwriteItemAction:(_source:any,at:any)=>()=>items.push(clip(at.seconds))};
  const targeting:any[]=[];
  const load=uxpModules({Project:{getActiveProject:()=>project},Constants:{TrackItemType:{CLIP:1,TRANSITION:2}},
    TickTime:{createWithSeconds:time,createWithTicks:(ticks:string)=>({ticks,seconds:Number(ticks)/254016000000})},
    SequenceEditor:{getEditor:()=>editor},ClipProjectItem:{cast:(raw:any)=>raw},FolderItem:{cast:(raw:any)=>raw===root?raw:null}},
  {__PREMIERE_MCP_TRACK_TARGETING__:{port:8098,token:'a'.repeat(64),version:'0.1.1',projectPath:project.path,sequenceId:sequence.guid,sequenceName:sequence.name},
    fetch:async(_url:string,options:any)=>{const r=JSON.parse(options.body);targeting.push(r.targets);return {ok:true,json:async()=>({status:'pass',route:'cep_track_targeting',version:'0.1.1',after:['video','audio'].flatMap(mediaType=>r.trackNames[mediaType].map((name:string,trackIndex:number)=>({mediaType,trackIndex,name,targeted:r.targets.some((t:any)=>t.mediaType===mediaType&&t.trackIndex===trackIndex)})))})};}});
  const request=(command:string,args:any={})=>({version:1,id:'placement',command,args,timeoutMs:5000});
  const select=async(seq:any,entries:any[])=>{seq.clearSelection();for(const entry of entries)selection.addItem(entry.raw);await seq.setSelection(selection);};
  return {time,clip,items,load,sequence,project,targeting,request,select,displayed:()=>displayed,setInternalSelection:(raw:any[])=>{selected=raw;}};
}

describe('collaborative placement',()=>{
  const args={expectedProjectId:'project',expectedSequenceId:'sequence',placements:[{projectItemId:'voice-source',timeSeconds:3,videoTrackIndex:0,audioTrackIndex:0,mode:'overwrite',requireEmpty:true,expectedDurationSeconds:2,expectedMediaTypes:['audio']}]};
  it('places the requested stream, then selects the actual inserted clip and targets its real track',async()=>{
    const f=fixture(),{PremiereHost}=f.load('apps/uxp-plugin/src/premiere-host.ts'),notify=vi.fn();
    const result=await new PremiereHost(notify).dispatch(f.request('place_clips',args));
    expect(result).toMatchObject({status:'pass',hostResult:true,workTarget:{phase:'after_command',clipSelection:'pass',playhead:{seconds:3},tracks:[{mediaType:'audio',trackIndex:0}],itemIds:[`audio:0:${f.time(3).ticks}:voice-source`]}});
    expect(result.placedItemIds).toHaveLength(1);expect(result.after.sequenceId).toBe('sequence');
    expect(f.displayed()).toEqual(f.items);expect(f.targeting.at(-1)).toEqual([{mediaType:'audio',trackIndex:0}]);
    expect(f.project.openSequence).toHaveBeenCalledOnce();expect(notify).toHaveBeenCalledTimes(2);
  });
  it('places without selecting clips, targeting tracks or moving the view when automatic follow is off',async()=>{
    const f=fixture(),{PremiereHost}=f.load('apps/uxp-plugin/src/premiere-host.ts'),notify=vi.fn();
    f.load('apps/uxp-plugin/src/work-follow.ts').workFollow.enabled=false;
    const result=await new PremiereHost(notify).dispatch(f.request('place_clips',args));
    expect(result).toMatchObject({status:'pass',hostResult:true});expect(result.workTarget).toBeUndefined();
    expect(f.sequence.getPlayerPosition().seconds).toBe(0);expect(f.displayed()).toEqual([]);
    expect(f.targeting).toEqual([]);expect(f.project.openSequence).not.toHaveBeenCalled();expect(f.sequence.setSelection).not.toHaveBeenCalled();expect(notify).not.toHaveBeenCalled();
  });
  it.each(['place_clips','place_voiceover','place_music','place_on_new_layer'])('selects all proven destinations in request order for %s',async command=>{
    const f=fixture(),host=f.load('apps/uxp-plugin/src/host-work-target.ts');
    const ids=[12,3].map(t=>`audio:0:${f.time(t).ticks}:voice-source`);
    const result=await host.followTimelineWork(f.request(command,{timeSeconds:12,audioTrackIndex:0}),f.select,async()=>{
      f.items.push(f.clip(3),f.clip(12));return {status:'pass',hostResult:true,placedItemIds:ids};
    },vi.fn());
    expect(result.workTarget).toMatchObject({phase:'after_command',itemIds:ids,playhead:{seconds:12},tracks:[{mediaType:'audio',trackIndex:0}]});
    expect(f.displayed()).toEqual([f.items[1],f.items[0]]);
  });
  it.each(['missing','selection-failed'])('keeps a passing placement PASS when post-insertion follow fails (%s), without replay',async failure=>{
    const f=fixture(),host=f.load('apps/uxp-plugin/src/host-work-target.ts');
    const dispatch=vi.fn(async()=>{f.items.push(f.clip(3));return {status:'pass',hostResult:true,...(failure==='missing'?{}:{placedItemIds:[`audio:0:${f.time(3).ticks}:voice-source`]})};});
    const select=async(seq:any,entries:any[])=>{if(entries.length)throw Error('Host selection rejected');return f.select(seq,entries);};
    const result=await host.followTimelineWork(f.request('place_clips',{timeSeconds:3}),select,dispatch,vi.fn());
    expect(result.status).toBe('pass');expect(result.workTarget).toMatchObject({status:'unverified',phase:'after_command'});
    expect(dispatch).toHaveBeenCalledOnce();expect(f.items).toHaveLength(1);
  });
  it('rejects a newly occupied requested interval before dispatch',async()=>{
    const f=fixture();f.items.push(f.clip(4));const {PremiereHost}=f.load('apps/uxp-plugin/src/premiere-host.ts');
    const result=await new PremiereHost().dispatch(f.request('place_clips',args));expect(result).toMatchObject({status:'fail',hostResult:{contentDispatched:false}});expect(result.errors[0]).toContain('destination range');expect(f.items).toHaveLength(1);
  });
  it('preserves unrelated user clips outside the requested interval',async()=>{
    const f=fixture(),user=f.clip(20);f.items.push(user);const {PremiereHost}=f.load('apps/uxp-plugin/src/premiere-host.ts');
    const result=await new PremiereHost().dispatch(f.request('place_clips',args));expect(result.status).toBe('pass');expect(f.items[0]).toBe(user);expect(f.items).toHaveLength(2);
  });
  it.each(['missing-stream','duration'])('does not report a wrong placement as PASS: %s',async fault=>{
    const f=fixture(),{PremiereHost}=f.load('apps/uxp-plugin/src/premiere-host.ts');
    const p={...args.placements[0],...(fault==='missing-stream'?{expectedMediaTypes:['video','audio']}:{expectedDurationSeconds:3})};
    const result=await new PremiereHost().dispatch(f.request('place_clips',{...args,placements:[p]}));expect(result.status).toBe('unverified');expect(f.items).toHaveLength(1);
  });
  it('rejects a stale project before any placement',async()=>{
    const f=fixture(),{PremiereHost}=f.load('apps/uxp-plugin/src/premiere-host.ts');
    const result=await new PremiereHost().dispatch(f.request('place_clips',{...args,expectedProjectId:'other'}));expect(result).toMatchObject({status:'fail',hostResult:{contentDispatched:false}});expect(f.items).toEqual([]);
  });
});
