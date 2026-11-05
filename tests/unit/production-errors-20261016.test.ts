import {it,expect} from 'vitest';
import {uxpModules} from '../helpers/uxp-modules.js';
import {overlapsRange} from '../../apps/uxp-plugin/src/item-query.js';
import {planExactClipTrim} from '../../apps/uxp-plugin/src/timeline-trim.js';
import {withMutationPhase,dispatchContent} from '../../apps/uxp-plugin/src/host-mutation-phase.js';
import {planTrackRelocation} from '../../apps/uxp-plugin/src/track-relocation.js';
import {placementDurationTicks} from '../../apps/uxp-plugin/src/placement-interval.js';
import recordedPlacements from '../fixtures/production-placement-timings.json';

const ticksPerSecond=254016000000;
const time=(seconds:number)=>({seconds,ticks:String(Math.round(seconds*ticksPerSecond))});

it('uses half-open integer tick boundaries for the recorded adjacent placement (E1)',()=>{
  const start=39.87316666666667,duration=1.126125,next=40.999291666666664;
  expect(overlapsRange(next,next+1,{startSeconds:start,endSeconds:start+duration})).toBe(false);
  expect(overlapsRange(next-1/ticksPerSecond,next+1,{startSeconds:start,endSeconds:start+duration})).toBe(true);
});

it('excludes the exact U08 target from its own expansion while retaining real collision guards (E2)',()=>{
  const start=58.600208333333335,cut=61.5615,end=66.77504166666667;
  const target={id:'video:1:14885390520000:source',projectItemId:'source',mediaType:'video',trackIndex:1,start:time(start),end:time(cut),inPoint:time(0),outPoint:time(cut-start),speed:1,reversed:false};
  const request={trackItemId:target.id,expectedProjectItemId:'source',expectedMediaType:'video' as const,expectedTrackIndex:1,expectedStartSeconds:start,expectedEndSeconds:cut,expectedInPointSeconds:0,expectedOutPointSeconds:cut-start,endSeconds:end};
  expect(planExactClipTrim(request,target,[structuredClone(target)],24000/1001).expected.endSeconds).toBe(end);
  expect(()=>planExactClipTrim(request,target,[target,{...target,id:'peer',start:time(cut),end:time(end)}],24000/1001)).toThrow('overlaps timeline item peer');
});

it('classifies a linked relocation preflight without dispatch, while preserving its refusal (C)',async()=>{
  const source={id:'source',projectItemId:'av',mediaType:'audio',trackIndex:0,start:time(0),end:time(1),inPoint:time(0),outPoint:time(1),speed:1,reversed:false};
  await expect(withMutationPhase('move_clip_to_track',async()=>{
    return planTrackRelocation({trackItemId:source.id,expectedProjectItemId:'av',expectedMediaType:'audio',expectedTrackIndex:0,expectedStartSeconds:0,expectedEndSeconds:1,expectedInPointSeconds:0,expectedOutPointSeconds:1,destinationTrackIndex:1},
      {sequence:{audioTracks:2,items:[source,{...source,id:'video',mediaType:'video'}]},effects:{}});
  })).rejects.toMatchObject({message:expect.stringContaining('Possible linked A/V counterpart'),details:{contentDispatched:false,errorClassification:'preflight'}});
  await expect(withMutationPhase('move_clip_to_track',async()=>{
    dispatchContent(()=>true);throw Error('Readback unavailable after clone');
  })).rejects.toMatchObject({details:undefined});
});

it.each(recordedPlacements)('compares recorded $operation $mediaType duration $expectedSeconds with its exact frame prediction (B2)',row=>{
  const predicted=placementDurationTicks(row.expectedSeconds,row.frameTicks);
  // Two rows in 13b310f4 are the same shorter item: the following overwrite at
  // 240.14 s ends it at 240.156583 s. Do not hide that extra frame by tolerance.
  if(row.operation==='13b310f4'&&row.expectedSeconds===1.3345){
    expect(BigInt(predicted)-BigInt(row.actualTicks)).toBe(BigInt(row.frameTicks));
  }else expect(predicted).toBe(row.actualTicks);
});

function placementFixture(duration:number,actualFrames:number,mediaType='video'){
  const frame=10594584000n;
  const items:any[]=[];
  const source={name:'source',getId:()=> 'source'};
  const sequence={guid:'s',name:'Sequence',getTimebase:()=>String(frame),getVideoTrackCount:()=>1,getAudioTrackCount:()=>1,
    getVideoTrack:()=>({getTrackItems:()=>mediaType==='video'?items:[]}),getAudioTrack:()=>({getTrackItems:()=>mediaType==='audio'?items:[]})};
  const root={getId:()=> 'root',getItems:()=>[source]};
  const project={guid:'p',path:'C:/test.prproj',getActiveSequence:()=>sequence,getRootItem:()=>root,lockedAccess:(f:any)=>f(),executeTransaction:(f:any)=>{const actions:any[]=[];f({addAction:(a:any)=>actions.push(a)});actions.forEach(a=>a());return true;}};
  const editor={createOverwriteItemAction:()=>()=>items.push({getProjectItem:()=>source,getName:()=>source.name,getStartTime:()=>time(0),getEndTime:()=>({ticks:String(BigInt(actualFrames)*frame),seconds:Number(BigInt(actualFrames)*frame)/ticksPerSecond})})};
  const load=uxpModules({Project:{getActiveProject:()=>project},Constants:{TrackItemType:{CLIP:1}},FolderItem:{cast:(r:any)=>r===root?r:null},ClipProjectItem:{cast:(r:any)=>r},SequenceEditor:{getEditor:()=>editor},TickTime:{createWithSeconds:time,createWithTicks:(ticks:string)=>({ticks,seconds:Number(ticks)/ticksPerSecond})}});
  const {PremiereHost}=load('apps/uxp-plugin/src/premiere-host.ts');
  return new PremiereHost().dispatchCommand({command:'place_clips',args:{expectedProjectId:'p',expectedSequenceId:'s',placements:[{projectItemId:'source',timeSeconds:0,videoTrackIndex:0,audioTrackIndex:0,mode:'overwrite',expectedDurationSeconds:duration,expectedMediaTypes:[mediaType],requireEmpty:true}]}});
}
it.each(['video','audio'])('verifies the exact floor duration on the sequence grid for %s (B2)',async media=>{
  expect(await placementFixture(12,287,media)).toMatchObject({status:'pass',errors:[]});
});
it('still rejects a one-frame-short placement and uses media-neutral diagnostics (B2)',async()=>{
  const result=await placementFixture(12,286);
  expect(result.status).toBe('unverified');expect(result.errors.join(' ')).toContain('Placed duration differs');
  expect(result.errors.join(' ')).not.toContain('WAV');
});
