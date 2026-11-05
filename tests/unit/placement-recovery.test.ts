import {describe,it,expect} from 'vitest';
import path from 'node:path';
import {projectSnapshotSchema,type BridgeRequest} from '@premiere-uxp/contracts';
import {assessPlacementRecovery} from '../../apps/mcp-server/src/placement-recovery.js';
import {createMutationPlan} from '../../apps/mcp-server/src/mutation-plan.js';
import {createOperationFingerprint} from '../../apps/mcp-server/src/operation-identity.js';
import {AuditLog,ReceiptStore} from '../../apps/mcp-server/src/audit.js';
import {HostExecutor} from '../../apps/mcp-server/src/host-executor.js';
import {freshTestDirectory} from '../helpers/workspace.js';

function fixture(options:{snappedOutTicks?:string;placedOutTicks?:string}={}){
  const time=(seconds:number)=>({ticks:String(Math.round(seconds*254016000000)),seconds});
  const exact=(ticks:string)=>({ticks,seconds:Number(ticks)/254016000000});
  const items=['video','audio'].map(mediaType=>({id:`${mediaType}:0:${time(3).ticks}:master`,projectItemId:'master',name:'source',mediaType,trackIndex:0,
    start:time(3),end:time(23),inPoint:time(0),outPoint:time(20),speed:1,reversed:false,disabled:false,adjustmentLayer:false}));
  const component={matchName:'intrinsic',params:[{value:1,timeVarying:false,keyframes:[],keyframeDetails:[]}]};
  const effects=items.map(item=>({trackItemId:item.id,name:item.name,mediaType:item.mediaType,components:[component]}));
  const before=projectSnapshotSchema.parse({projectId:'p',projectName:'work',projectPath:'C:/scratch/work.prproj',capturedAt:'2026-09-21T00:00:00Z',
    sequences:[{id:'s',name:'sequence'}],projectItems:[{id:'master',name:'source',kind:'clip',path:'C:/source.mp4'}, {id:'sub',name:'spacer',kind:'clip',path:'C:/source.mp4'}],
    projectItemLimit:500,projectItemsTruncated:false,offlineMediaIds:[],proxyAttachments:[],markers:[],mogrtItems:[],unsupportedFields:[],effects,audioState:[effects[1]],activeSequence:{id:'s',name:'sequence',videoTracks:2,audioTracks:2,captionTracks:1,itemLimit:1000,itemsTruncated:false,
      captionTrackStates:[{index:0,id:0,name:'captions',muted:false,itemCount:3,transitionCount:0}],duration:time(23),items,
      tracks:['video','audio'].flatMap(mediaType=>[0,1].map(index=>({mediaType,index,id:index,name:mediaType+index,muted:false,itemCount:1-index,transitionCount:0})))}});
  const args={expectedProjectId:'p',expectedSequenceId:'s',placements:[{projectItemId:'sub',timeSeconds:0,videoTrackIndex:1,audioTrackIndex:1,mode:'overwrite'}]};
  const creationArgs={projectItemId:'master',name:'spacer',startSeconds:0,endSeconds:options.snappedOutTicks?5.333333:1.001,hardBoundaries:true,takeVideo:true,takeAudio:true};
  const creation={kind:'mutation',request:{id:'create',command:'create_subclip',args:creationArgs},receipt:{commandId:'create',command:'create_subclip',status:'partial',
    completedAt:'2026-09-21T00:00:00Z',requestFingerprint:createOperationFingerprint('create_subclip',creationArgs),after:{created:{id:'sub',name:'spacer'},
      ...(options.snappedOutTicks?{requestedRange:{inPoint:exact('0'),outPoint:exact(options.snappedOutTicks)}}:{})}}};
  const placedOut=options.placedOutTicks??options.snappedOutTicks,out=placedOut?exact(placedOut):time(1.001);
  const plan=createMutationPlan(before,'place_clips',args,'plan'),current=structuredClone(before);current.projectId='reopened';
  for(const original of before.activeSequence!.items){
    const item={...original,id:`${original.mediaType}:1:0:sub`,name:'spacer',projectItemId:'sub',trackIndex:1,start:time(0),end:out,inPoint:time(0),outPoint:out};
    current.activeSequence!.items.push(item);
    current.activeSequence!.tracks.find(t=>t.mediaType===item.mediaType&&t.index===1)!.itemCount=1;
    for(const key of ['effects','audioState'] as const){
      for(const row of (before[key] as any[]).filter(r=>r.trackItemId===original.id))current[key].push({...structuredClone(row),trackItemId:item.id,name:item.name});
    }
  }
  return {before,args,creation,plan,current};
}

describe('bounded AV subclip placement recovery',()=>{
  it('accepts both complete streams or original content without relabeling execution',()=>{
    const f=fixture();
    expect(assessPlacementRecovery(f.plan,f.args,f.current,f.creation)).toMatchObject({status:'pass',outcome:'observed_complete_av_subclip_placement',contentReplayed:false});
    expect(assessPlacementRecovery(f.plan,f.args,f.before,f.creation)).toMatchObject({status:'pass',outcome:'observed_original_content'});
  });
  it('uses the exact frame-snapped range recorded by create_subclip, and rejects the old floored frame',()=>{
    const frame160=String(160n*8467200000n),f=fixture({snappedOutTicks:frame160});
    expect(assessPlacementRecovery(f.plan,f.args,f.current,f.creation)).toMatchObject({status:'pass',outcome:'observed_complete_av_subclip_placement'});
    const floored=fixture({snappedOutTicks:frame160,placedOutTicks:String(159n*8467200000n)});
    expect(()=>assessPlacementRecovery(floored.plan,floored.args,floored.current,floored.creation)).toThrow('RECOVERY_PLACEMENT_CONTENT_CHANGED_OR_PARTIAL');
    const offset=fixture({snappedOutTicks:frame160});(offset.creation.receipt.after as any).requestedRange.inPoint.ticks='1';
    expect(()=>assessPlacementRecovery(offset.plan,offset.args,offset.current,offset.creation)).toThrow('RECOVERY_PLACEMENT_SOURCE_EVIDENCE_MISSING');
  });
  it.each(['one_stream','wrong_range','unrelated_effect','added_effect','caption','occupied','truncated','wrong_path','wrong_source','wrong_receipt','insert','multiple'])('rejects %s',fault=>{
    const f=fixture();
    if(fault==='one_stream')f.current.activeSequence!.items.pop();
    if(fault==='wrong_range')f.current.activeSequence!.items.at(-1)!.outPoint!.ticks='1';
    if(fault==='unrelated_effect')(f.current.effects[0] as any).components[0].params[0].value=2;
    if(fault==='added_effect')(f.current.effects.at(-1) as any).components.push({matchName:'changed',params:[]});
    if(fault==='caption')f.current.activeSequence!.captionTrackStates[0]!.muted=true;
    if(fault==='occupied')f.plan.baseSnapshot.activeSequence!.tracks[1]!.itemCount=1;
    if(fault==='truncated')f.current.projectItemsTruncated=true;
    if(fault==='wrong_path')f.current.projectPath='C:/other.prproj';
    if(fault==='wrong_source')f.creation.request.args.projectItemId='other';
    if(fault==='wrong_receipt')f.creation.receipt.status='unverified';
    if(fault==='insert')f.args.placements[0]!.mode='insert';
    if(fault==='multiple')f.args.placements.push({...f.args.placements[0]!});
    expect(()=>assessPlacementRecovery(f.plan,f.args,f.current,f.creation)).toThrow(/RECOVERY_PLACEMENT/);
  });
  it.each([false,true])('uses durable records and performs no content replay (missing creation=%s)',async missing=>{
    const f=fixture(),dir=await freshTestDirectory('placement-recovery'),store=new ReceiptStore(path.join(dir,'receipts.json')),audit=new AuditLog(path.join(dir,'audit.jsonl'));
    if(!missing)await audit.append(f.creation);
    let recovering=false;const edits:string[]=[];
    const bridge={async call(r:BridgeRequest){let result:unknown;
      if(r.command==='inspect_project')result=recovering?f.current:f.before;
      else if(r.command==='inspect_host_context')result={activeProject:true,activeSequence:true,projectId:'reopened',sequenceId:'s'};
      else if(r.command==='inspect_command_execution')result={status:'pass',protocol:1,active:[],commands:[{id:'lost',state:'unknown'}]};
      else {edits.push(r.command);throw Error('native process disconnected');}
      return {version:1 as const,id:r.id,ok:true,durationMs:1,result};}};
    // Historical baseline, retained for legacy optional reconciliation. New placement does not create it.
    await audit.append({kind:'plan',commandId:'lost',plan:f.plan,createdAt:new Date().toISOString()});
    const host=new HostExecutor(bridge as any,audit,store,1000),receipt=await host.mutate('place_clips',f.args,'lost');recovering=true;
    expect(receipt.status).toBe('unverified');
    const proof=await host.reconcileMutation('lost');
    expect(proof).toMatchObject({status:missing?'unverified':'pass',quarantineReleased:!missing,originalReceiptUnchanged:true});
    expect(await store.get('lost')).toEqual(receipt);expect(edits).toEqual(['place_clips']);
    expect(Boolean(await store.inspectRecovery())).toBe(missing);
  });
});
