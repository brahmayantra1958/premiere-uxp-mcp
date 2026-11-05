import {it,expect,vi} from 'vitest';
import {uxpModules} from '../helpers/uxp-modules.js';

// Mirrors the saved A1 list: native clone insertion orders a track, whereas a
// TrackItem move can change timestamps without reinserting its collection slot.
// This proves the adapter's response to that state, not Premiere rendering.
function fixture(mediaType='video',fault=''){
  const frame=10594584000n,time=(ticks:bigint)=>({ticks:String(ticks),seconds:Number(ticks)/254016000000});
  const items:any[]=[],moves=vi.fn(),labels:string[]=[];
  const make=(source:string,start:bigint,end:bigint,input=0n)=>{
    const value:any={source,start,end,input,output:input+end-start,
      getProjectItem:()=>({getId:()=>source}),getName:()=>source,getStartTime:()=>time(value.start),getEndTime:()=>time(value.end),
      getInPoint:()=>time(value.input),getOutPoint:()=>time(value.output),getSpeed:()=>1,isSpeedReversed:()=>false,isDisabled:()=>false,isAdjustmentLayer:()=>false,
      getComponentChain:()=>({getComponentCount:()=>0}),
      createSetStartAction:(t:any)=>{const delta=BigInt(t.ticks)-value.start;return ()=>{value.start+=delta;value.input+=delta;};},
      createSetEndAction:(t:any)=>{const delta=BigInt(t.ticks)-value.end;return ()=>{value.end+=delta;value.output+=delta;};},
      createMoveAction:(t:any)=>()=>{moves();value.start+=BigInt(t.ticks);value.end+=BigInt(t.ticks);},
    };return value;
  };
  items.push(make('U03',522n*frame,747n*frame),make('later',747n*frame,900n*frame));
  let selected:any[]=[];
  const selection={addItem:(x:any)=>{selected.push(x);return true;},getTrackItems:()=>selected};
  const sequence={guid:'s',name:'S',getTimebase:()=>String(frame),getEndTime:()=>time(items.reduce((v,x)=>x.end>v?x.end:v,0n)),
    getVideoTrackCount:()=>mediaType==='video'?1:0,getAudioTrackCount:()=>mediaType==='audio'?1:0,
    getVideoTrack:()=>({getTrackItems:()=>items}),getAudioTrack:()=>({getTrackItems:()=>items}),
    clearSelection:async()=>{selected=[];return true;},getSelection:()=>selection,setSelection:()=>true};
  const project={guid:'p',path:'C:/scratch.prproj',getActiveSequence:()=>sequence,lockedAccess:(f:any)=>f(),executeTransaction:(f:any,label:string)=>{
    const actions:any[]=[];f({addAction:(a:any)=>actions.push(a)});labels.push(label);actions.forEach(a=>a());return true;
  }};
  let clones=0;
  const editor={createCloneTrackItemAction:(item:any,offset:any)=>()=>{
    const clone=make(item.source,item.start+BigInt(offset.ticks),item.end+BigInt(offset.ticks),item.input);clones++;
    if(clones===2&&fault==='source')clone.input+=frame;
    items.push(clone);if(!(clones===2&&fault==='order'))items.sort((a,b)=>a.start<b.start?-1:1);
  },createRemoveItemsAction:(_selection:any,ripple:boolean,type:number,ignoreLinked:boolean)=>{
    expect(ripple).toBe(false);expect(type).toBe(mediaType==='video'?1:2);expect(ignoreLinked).toBe(true);
    const removing=[...selected];return ()=>{for(const item of removing)items.splice(items.indexOf(item),1);};
  }};
  const load=uxpModules({Project:{getActiveProject:()=>project},Constants:{TrackItemType:{CLIP:1},MediaType:{VIDEO:1,AUDIO:2}},SequenceEditor:{getEditor:()=>editor},
    TickTime:{createWithTicks:(t:string)=>time(BigInt(t)),createWithSeconds:(s:number)=>time(BigInt(Math.round(s*254016000000)))}});
  const {PremiereHost}=load('apps/uxp-plugin/src/premiere-host.ts');
  const split=()=>new PremiereHost().dispatchCommand({command:'split_clips',args:{expectedProjectId:'p',expectedSequenceId:'s',split:{trackItemId:`${mediaType}:0:${522n*frame}:U03`,expectedProjectItemId:'U03',expectedMediaType:mediaType,expectedTrackIndex:0,expectedStartSeconds:time(522n*frame).seconds,expectedEndSeconds:time(747n*frame).seconds,atSeconds:time(615n*frame).seconds}}});
  return {split,items,moves,labels,frame};
}
it.each(['video','audio'])('re-registers the right %s segment in native chronological order (A1)',async media=>{
  const f=fixture(media),result=await f.split();
  expect(result.status,JSON.stringify(result.errors)).toBe('pass');
  expect(f.items.map(x=>[x.start/f.frame,x.end/f.frame,x.input/f.frame,x.output/f.frame])).toEqual([[522n,615n,0n,93n],[615n,747n,93n,225n],[747n,900n,0n,153n]]);
  expect(f.moves).not.toHaveBeenCalled();
  expect(result.hostResult.nativeTrackOrderVerified).toBe(true);
});
it.each(['source','order'])('does not pass a wrongly registered split (%s) and proves bounded rollback',async fault=>{
  const f=fixture('video',fault),result=await f.split();
  expect(result.status).toBe('fail');expect(result.hostResult.rollbackVerified).toBe(true);
  expect(result.errors.join(' ')).toContain(fault==='order'?'SPLIT_NATIVE_TRACK_ORDER_UNVERIFIED':'SPLIT_DESTINATION_UNVERIFIED');
  expect(f.items.map(x=>[x.start/f.frame,x.end/f.frame])).toEqual([[522n,747n],[747n,900n]]);
});
it('rejects an already disordered native track before creating or trimming any item',async()=>{
  const f=fixture();f.items.reverse();
  await expect(f.split()).rejects.toThrow('SPLIT_NATIVE_TRACK_ORDER_UNVERIFIED');
  expect(f.labels).toEqual([]);
});
