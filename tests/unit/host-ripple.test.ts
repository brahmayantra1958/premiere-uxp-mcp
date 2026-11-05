import {it,expect,vi} from 'vitest';
import {uxpModules} from '../helpers/uxp-modules.js';
const frame=8475667200n,clock=(n:bigint)=>({ticks:String(n),seconds:Number(n)/254016000000});
function fixture(){
  const clips:any[]=[],captions:any[]=[];
  const item=(name:string,start:number,end:number,list:any[])=>{
    const value={name,start:frame*BigInt(start),end:frame*BigInt(end),in:0n,out:frame*BigInt(end-start),
      getProjectItem:()=>({getId:()=>name}),getName:()=>name,getStartTime:()=>clock(value.start),getEndTime:()=>clock(value.end),
      getInPoint:()=>clock(value.in),getOutPoint:()=>clock(value.out),getSpeed:()=>1,isSpeedReversed:()=>false,isDisabled:()=>false,isAdjustmentLayer:()=>false,
      createMoveAction:(t:any)=>()=>{value.start+=BigInt(t.ticks);value.end+=BigInt(t.ticks);},
      // Native actions capture their edit delta when constructed, before the
      // compound transaction runs. An absolute assignment mock hid A2.
      createSetEndAction:(t:any)=>{const delta=BigInt(t.ticks)-value.end;return ()=>{value.end+=delta;};}};
    list.push(value);return value;
  };
  item('a',5,30,clips);item('b',30,40,clips);item('caption',18,35,captions);
  const transitions:any[]=[],nav=vi.fn();
  const track={getTrackItems:(type:number)=>type===2?transitions:clips};
  const sequence={guid:'s',name:'Any sequence',getTimebase:()=>String(frame),getVideoTrackCount:()=>0,getAudioTrackCount:()=>1,getAudioTrack:()=>track,
    getCaptionTrackCount:()=>1,getCaptionTrack:()=>({getTrackItems:()=>captions}),setPlayerPosition:nav};
  const project={guid:'p',path:'C:\\scratch\\any.prproj',getActiveSequence:()=>sequence};
  const load=uxpModules({Project:{getActiveProject:()=>project},Constants:{TrackItemType:{CLIP:1,TRANSITION:2}},TickTime:{createWithTicks:(ticks:string)=>({ticks})}});
  const module=load('apps/uxp-plugin/src/host-ripple.ts');
  const args={expectedProjectId:'p',expectedSequenceId:'s',boundaries:[{atSeconds:clock(20n*frame).seconds,frames:2},{atSeconds:clock(30n*frame).seconds,frames:1}]};
  const split=vi.fn(async({split:s}:any)=>{
    const c=clips.find(c=>c.name===s.expectedProjectItemId&&clock(c.start).seconds===s.expectedStartSeconds)!;
    const cut=BigInt(Math.round(s.atSeconds*254016000000)),oldEnd=c.end,oldOut=c.out;
    const right=item(c.name,0,1,clips);right.start=cut;right.end=oldEnd;right.in=c.in+cut-c.start;right.out=oldOut;
    c.end=cut;c.out=right.in;
    const read=await module.inspectTimelineRipple(args);
    const left=read.items.find((x:any)=>x.mediaType==='audio'&&x.start.ticks===String(c.start));
    // A left piece ending at the first boundary is outside the inspection page.
    return {status:'pass',hostResult:{readback:{left:left??{id:'audio:0:'+c.start+':'+c.name,projectItemId:c.name,mediaType:'audio',trackIndex:0,start:clock(c.start),end:clock(c.end)}}}};
  });
  const execute=vi.fn((_p:any,_label:string,actions:()=>Array<()=>void>)=>{for(const a of actions())a();return true;});
  const ready=async()=>{const p=await module.inspectTimelineRipple(args);return {...p.arguments,expectedPlan:p.plan,expectedItems:p.items,
    captionBaseline:p.plan.changes.filter((c:any)=>c.mediaType==='caption').map((c:any)=>({id:c.id,startTicks:c.startTicks,endTicks:c.endTicks}))};};
  return {module,args,ready,clips,captions,split,execute,nav,transitions,item};
}
it('executes splits and exact all-track shifts while extending the same caption without navigation',async()=>{
  const f=fixture(),before=f.captions[0],args=await f.ready();
  const result=await f.module.rippleTimeline(args,{split:f.split,execute:f.execute});
  expect(result.errors).toEqual([]);expect(result.status).toBe('pass');
  expect(f.split).toHaveBeenCalledTimes(1);expect(f.execute).toHaveBeenCalledTimes(2);
  expect(f.clips.map(c=>[c.start/frame,c.end/frame,c.in/frame,c.out/frame])).toEqual([[5n,20n,0n,15n],[33n,43n,0n,10n],[22n,32n,15n,25n]]);
  expect(f.captions[0]).toBe(before);expect([before.start/frame,before.end/frame]).toEqual([18n,38n]);expect(f.nav).not.toHaveBeenCalled();
});
it('moves then extends a caption crossing a later boundary without applying the first shift twice (A2)',async()=>{
  const f=fixture();f.clips.length=0;f.captions.length=0;
  f.item('cue15',1208,1250,f.captions);f.item('cue16',1252,1310,f.captions);
  f.args.boundaries=[{atSeconds:clock(615n*frame).seconds,frames:52},{atSeconds:clock(1242n*frame).seconds,frames:103},{atSeconds:clock(1872n*frame).seconds,frames:196}];
  const result=await f.module.rippleTimeline(await f.ready(),{split:f.split,execute:f.execute});
  expect(result.status).toBe('pass');expect(result.errors).toEqual([]);
  expect(f.captions.map(c=>[c.start/frame,c.end/frame])).toEqual([[1260n,1405n],[1407n,1465n]]);
  expect(f.split).not.toHaveBeenCalled();
});
it('rejects changed timing, changed source, missing caption baseline and affected transitions before writing',async()=>{
  for(const fault of ['time','source','caption','transition']){
    const f=fixture(),args=await f.ready();
    if(fault==='time')f.clips[0].end+=frame;
    if(fault==='source')f.clips[0].in+=frame;
    if(fault==='caption')args.captionBaseline=[];
    if(fault==='transition')f.transitions.push({getEndTime:()=>clock(25n*frame)});
    const r=await f.module.rippleTimeline(args,{split:f.split,execute:f.execute});
    expect(r).toMatchObject({status:'fail',hostResult:{contentDispatched:false}});expect(f.split).not.toHaveBeenCalled();expect(f.execute).not.toHaveBeenCalled();
  }
});
it('reports unknown native results without retry or restoring newer state',async()=>{
  const f=fixture(),args=await f.ready();f.execute.mockImplementation(()=>false);
  const result=await f.module.rippleTimeline(args,{split:f.split,execute:f.execute});
  expect(result.status).toBe('unverified');expect(f.execute).toHaveBeenCalledTimes(1);expect(f.split).toHaveBeenCalledTimes(1);
});
it('keeps a first split staging rejection no-write, but never erases an earlier split (F)',async()=>{
  for(const priorSplit of [false,true]){
    const f=fixture();if(priorSplit)f.item('c',10,25,f.clips);
    const args=await f.ready(),rejection=()=>{throw Object.assign(Error('SPLIT_STAGING_RANGE_OCCUPIED'),{details:{contentDispatched:false}});};
    if(priorSplit){const original=f.split.getMockImplementation()!;f.split.mockImplementationOnce(original).mockImplementationOnce(rejection);}
    else f.split.mockImplementationOnce(rejection);
    const result=await f.module.rippleTimeline(args,{split:f.split,execute:f.execute});
    expect(result).toMatchObject({status:priorSplit?'unverified':'fail',hostResult:{contentDispatched:priorSplit}});
    expect(f.execute).not.toHaveBeenCalled();expect(f.split).toHaveBeenCalledTimes(priorSplit?2:1);
  }
});
it('stops before caption extension if the committed move does not read back exactly (A2)',async()=>{
  const f=fixture();f.clips.length=0;f.captions.length=0;
  f.item('cue',21,35,f.captions);const args=await f.ready();
  f.execute.mockImplementation((_p:any,_label:string,actions:any)=>{actions().forEach((a:any)=>a());f.captions[0].start+=frame;return true;});
  const result=await f.module.rippleTimeline(args,{split:f.split,execute:f.execute});
  expect(result.status).toBe('unverified');expect(result.errors.join(' ')).toContain('RIPPLE_CAPTION_CHANGED_BEFORE_EXTENSION');
  expect(f.execute).toHaveBeenCalledTimes(1);
});
