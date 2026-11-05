import {beforeEach,describe,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({helper:vi.fn(),ready:vi.fn(),source:vi.fn()}));
vi.mock('../../apps/mcp-server/src/cep-caption-helper.js',()=>({runCepCaptionHelper:state.helper,assertCaptionHelperReady:state.ready}));
vi.mock('../../apps/mcp-server/src/active-edit-target.js',()=>({readActiveEditTarget:async()=>({projectPath:'C:/fixture.prproj',projectId:'p',sequenceName:'Sequence',sequenceId:'s'})}));
vi.mock('../../apps/mcp-server/src/caption-srt-source.js',()=>({readCaptionSrt:state.source}));
import {registerCaptionTool} from '../../apps/mcp-server/src/caption-tools.js';

const frame='10594584000',F=BigInt(frame);
const sourceCues=[{number:1,startTicks:String(52n*254016000n),endTicks:String(94n*254016000n),text:'첫 자막'},
  {number:2,startTicks:String(94n*254016000n),endTicks:String(136n*254016000n),text:'둘째 자막'}];
beforeEach(()=>{
  state.helper.mockReset().mockResolvedValue({status:'pass',outcome:{saved:false}});state.ready.mockReset().mockResolvedValue(undefined);
  state.source.mockReset().mockResolvedValue({sourcePath:'C:/captions.srt',scratchPath:'C:/scratch/hash.srt',sha256:'source-hash',cues:sourceCues});
});

function fixture(options:{early?:boolean;freshFrame?:string;missingCapability?:boolean;timingThrows?:boolean;wrongTrack?:boolean;finalReadThrows?:boolean}={}){
  let handler:any,definition:any,sequenceReads=0,capabilityReads=0;
  const oldTrack={index:0,id:5,name:'Existing C1',muted:false,itemCount:3};
  const newTrack={index:1,id:6,name:'Imported',muted:false,itemCount:2};
  const before={id:'s',videoTracks:1,audioTracks:1,captionTracks:1,captionTrackStates:[oldTrack],itemsTruncated:false,
    items:[{id:'av',projectItemId:'media',mediaType:'video',trackIndex:0,start:{ticks:'0'},end:{ticks:String(10n*F)},inPoint:{ticks:'0'},outPoint:{ticks:String(10n*F)},speed:1,reversed:false,disabled:false}]};
  const host={read:vi.fn(async(command:string,args:any)=>{
    if(command==='inspect_caption_import_capabilities')return {exactTrackGuards:true,projectId:'p',sequenceId:'s',
      ...(!options.missingCapability?{frameTicks:capabilityReads++&&options.freshFrame?options.freshFrame:frame}:{})};
    if(command==='inspect_sequence'){
      if(sequenceReads++===0)return before;
      if(options.finalReadThrows&&sequenceReads===3)throw Error('Final preservation read failed');
      return {...before,captionTracks:2,captionTrackStates:[oldTrack,{...newTrack}]};
    }
    if(command==='inspect_caption_track'){
      expect(args).toMatchObject({expectedProjectId:'p',expectedSequenceId:'s',expectedSequenceName:'Sequence',trackIndex:1,expectedTrackId:'6',expectedTrackName:'New captions'});
      if(options.timingThrows)throw Error('Caption timing read timed out');
      const offset=options.early?0n:1n;
      return {status:'partial',projectId:'p',sequenceId:'s',sequenceName:'Sequence',frameTicks:frame,captionTrackCount:2,
        track:{...newTrack,id:options.wrongTrack?'999':'6'},items:sourceCues.map((_cue,index)=>({index,id:null,text:null,startTicks:String((BigInt(index)+offset)*F),endTicks:String((BigInt(index)+offset+1n)*F)}))};
    }
    throw Error('Unexpected host read: '+command);
  }),mutate:vi.fn(async(command:string,args:any)=>{
    expect(command).toBe('finalize_caption_import');expect(args).toMatchObject({trackIndex:1,expectedTrackId:6});
    newTrack.name=args.name;newTrack.muted=args.muted;return {status:'pass',errors:[]};
  }),mutateLocal:vi.fn(async(_command:string,_args:any,run:any)=>{const outcome=await run();return {status:outcome.status,hostResult:outcome.result,errors:outcome.errors};})};
  registerCaptionTool({registerTool:(_name:any,schema:any,run:any)=>{definition=schema;handler=run;}} as any,host as any,{} as any);
  const args={expectedProjectId:'p',expectedSequenceId:'s',expectedSequenceName:'Sequence',srtPath:'C:/captions.srt',timeSeconds:0,trackName:'New captions',muted:false,placementMode:'insert',videoTrackIndex:0,audioTrackIndex:0};
  return {host,args,oldTrack,definition,run:async(overrides:Record<string,unknown>={})=>(await handler({...args,...overrides})).structuredContent};
}

describe('caption import timing integration',()=>{
  it('passes complete live timing proof without implying text/style proof or touching existing C1',async()=>{
    const f=fixture(),value=await f.run();
    expect(value).toMatchObject({status:'pass',hostResult:{track:{index:1,id:6},creation:{verified:true},timingVerification:{status:'pass',summary:{matchedCueCount:2}},textVerification:{status:'unverified'},preservation:{avUnchanged:true,otherCaptionTrackMetadataUnchanged:true},projectSaved:false}});
    expect(state.helper).toHaveBeenCalledTimes(1);expect(f.host.mutate).toHaveBeenCalledTimes(1);
    expect(f.oldTrack).toEqual({index:0,id:5,name:'Existing C1',muted:false,itemCount:3});
    expect(state.helper.mock.calls[0]![0]).toMatchObject({srtPath:'C:/scratch/hash.srt',expectedCaptionTracksBefore:1});
  });
  it('retains the created track and exact per-cue deltas for a native one-frame-early import',async()=>{
    const f=fixture({early:true}),value=await f.run();
    expect(value).toMatchObject({status:'unverified',hostResult:{contentDispatched:true,track:{index:1,id:6,name:'New captions'},creation:{verified:true},source:{sha256:'source-hash'},timingVerification:{status:'unverified',summary:{startFrameDeltaCounts:{'-1':2},endFrameDeltaCounts:{'-1':2}}},preservation:{avUnchanged:true}}});
    expect(value.errors).toContain('CAPTION_TIMING_MISMATCH');expect(state.helper).toHaveBeenCalledTimes(1);expect(f.host.mutate).toHaveBeenCalledTimes(1);
  });
  it('supports an explicit expected-tick verification plan without modifying helper input',async()=>{
    const f=fixture({early:true}),expectedTimingPlan={frameTicks:frame,cues:[{startTicks:'0',endTicks:frame},{startTicks:frame,endTicks:String(2n*F)}]};
    const value=await f.run({expectedTimingPlan});
    expect(value).toMatchObject({status:'pass',hostResult:{timingVerification:{policy:'explicit_expected_tick_plan',verificationOnly:true}}});
    expect(state.helper.mock.calls[0]![0]).not.toHaveProperty('expectedTimingPlan');expect(state.helper.mock.calls[0]![0].srtPath).toBe('C:/scratch/hash.srt');
    expect(sourceCues[0]!.startTicks).toBe(String(52n*254016000n));
  });
  it('refuses a wrong explicit frame grid before lease or helper dispatch',async()=>{
    const f=fixture(),value=await f.run({expectedTimingPlan:{frameTicks:'8475667200',cues:sourceCues}});
    expect(value.status).toBe('fail');expect(value.errors.join(' ')).toContain('CAPTION_EXPECTED_TIMING_FRAME_MISMATCH');
    expect(f.host.mutateLocal).not.toHaveBeenCalled();expect(state.helper).not.toHaveBeenCalled();
  });
  it.each([{missingCapability:true},{freshFrame:'8475667200'}])('does not create a track without stable exact native frame ticks: %j',options=>{
    const f=fixture(options);return f.run().then(value=>{
      expect(value.status).toBe('fail');expect(state.helper).not.toHaveBeenCalled();expect(f.host.mutate).not.toHaveBeenCalled();
      if(options.freshFrame)expect(value.hostResult.contentDispatched).toBe(false);
    });
  });
  it('retains created-track identity when a later live timing read throws',async()=>{
    const f=fixture({timingThrows:true}),value=await f.run();
    expect(value).toMatchObject({status:'unverified',hostResult:{contentDispatched:true,track:{id:6,index:1},creation:{verified:true},helperStatus:'pass',trackStateOperationId:expect.stringContaining(':track-state')}});
    expect(value.errors.join(' ')).toContain('Caption timing read timed out');expect(state.helper).toHaveBeenCalledTimes(1);
  });
  it('retains acquired actual timing proof when the final preservation read throws',async()=>{
    const f=fixture({finalReadThrows:true}),value=await f.run();
    expect(value).toMatchObject({status:'unverified',hostResult:{track:{id:6},timingVerification:{status:'pass',cues:expect.arrayContaining([expect.objectContaining({actualStartTicks:frame})])}}});
    expect(value.errors.join(' ')).toContain('Final preservation read failed');expect(state.helper).toHaveBeenCalledTimes(1);
  });
  it('refuses a different native caption identity even when all times match',async()=>{
    const value=await fixture({wrongTrack:true}).run();
    expect(value.status).toBe('unverified');expect(value.hostResult.timingVerification.errors).toContain('CAPTION_TIMING_TRACK_IDENTITY_UNVERIFIED');
    expect(value.hostResult.track.id).toBe(6);expect(value.hostResult.timingReadbackTarget.track.id).toBe('999');
  });
});
