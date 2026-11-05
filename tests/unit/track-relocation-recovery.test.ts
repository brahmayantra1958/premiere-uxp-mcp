import {describe,it,expect} from 'vitest';
import path from 'node:path';
import {unlink} from 'node:fs/promises';
import {projectSnapshotSchema,type BridgeRequest} from '@premiere-uxp/contracts';
import {assessTrackRelocationRecovery} from '../../apps/mcp-server/src/track-relocation-recovery.js';
import {createMutationPlan} from '../../apps/mcp-server/src/mutation-plan.js';
import {AuditLog,ReceiptStore} from '../../apps/mcp-server/src/audit.js';
import {HostExecutor} from '../../apps/mcp-server/src/host-executor.js';
import {freshTestDirectory} from '../helpers/workspace.js';

function fixture(){
 const source={id:'audio:1:100:media',projectItemId:'media',name:'voice',mediaType:'audio',trackIndex:1,start:{ticks:'100',seconds:1},end:{ticks:'200',seconds:2},inPoint:{ticks:'0',seconds:0},outPoint:{ticks:'100',seconds:1},speed:1,reversed:false,disabled:false};
 const components=[{matchName:'volume',params:[{value:-3,keyframes:[{ticks:'10',value:-2}]}]}];
 const before=projectSnapshotSchema.parse({projectId:'p',projectName:'working',projectPath:'C:/scratch/working.prproj',capturedAt:'2026-09-17T00:00:00.000Z',sequences:[{id:'s',name:'WORKING__s'}],projectItems:[{id:'media',name:'voice',kind:'clip'}],projectItemLimit:500,projectItemsTruncated:false,offlineMediaIds:[],proxyAttachments:[],markers:[],mogrtItems:[],effects:[{trackItemId:source.id,components}],audioState:[{trackItemId:source.id,components}],unsupportedFields:[],
 activeSequence:{id:'s',name:'WORKING__s',videoTracks:0,audioTracks:2,captionTracks:0,itemLimit:500,itemsTruncated:false,items:[source],tracks:[0,1].map(index=>({id:index,index,mediaType:'audio',name:'A'+(index+1),muted:false,itemCount:index,transitionCount:0}))}});
 const args={expectedProjectId:'p',expectedSequenceId:'s',expectedSequenceName:'WORKING__s',move:{trackItemId:source.id,expectedProjectItemId:'media',expectedMediaType:'audio',expectedTrackIndex:1,expectedStartSeconds:1,expectedEndSeconds:2,expectedInPointSeconds:0,expectedOutPointSeconds:1,destinationTrackIndex:0}};
 const plan=createMutationPlan(before,'move_clip_to_track',args,'plan');
 const moved=structuredClone(before);moved.projectId='reopened';moved.capturedAt='2026-09-17T01:00:00.000Z';moved.activeSequence!.items[0]!.id='audio:0:100:media';moved.activeSequence!.items[0]!.trackIndex=0;
 moved.activeSequence!.tracks.forEach(t=>{t.itemCount=1-t.index;});
 for(const key of ['effects','audioState'] as const)(moved[key][0] as any).trackItemId='audio:0:100:media';
 return {before,args,plan,moved};
}
describe('read-only relocation recovery after native process loss',()=>{
 it('proves exactly moved or exactly unchanged exposed content after reopening',()=>{
  const f=fixture();expect(assessTrackRelocationRecovery(f.plan,f.args,f.moved)).toMatchObject({status:'pass',outcome:'observed_relocated_content'});
  const original=structuredClone(f.before);original.projectId='reopened';original.projectPath='c:\\scratch\\working.prproj';
  expect(assessTrackRelocationRecovery(f.plan,f.args,original)).toMatchObject({status:'pass',outcome:'observed_original_content'});
 });
 it.each(['partial_clone','missing','keyframe','mute','other_path','truncated','source_ticks','other_command'])('retains quarantine for %s',fault=>{
  const f=fixture(),current=f.moved;
  if(fault==='partial_clone')current.activeSequence!.items.push(f.before.activeSequence!.items[0]!);
  if(fault==='missing')current.activeSequence!.items=[];
  if(fault==='keyframe')(current.effects[0] as any).components[0].params[0].keyframes[0].value=0;
  if(fault==='mute')current.activeSequence!.tracks[0]!.muted=true;
  if(fault==='other_path')current.projectPath='C:/other.prproj';
  if(fault==='truncated')current.projectItemsTruncated=true;
  if(fault==='source_ticks')current.activeSequence!.items[0]!.inPoint!.ticks='1';
  if(fault==='other_command')f.plan.operations[0]!.args={...f.args,unexpected:true};
  expect(()=>assessTrackRelocationRecovery(f.plan,f.args,current)).toThrow(/RECOVERY_RELOCATION/);
 });
 it.each([false,true])('persists baseline before dispatch and recovers without replay (legacy audit=%s)',async legacy=>{
  const f=fixture(),dir=await freshTestDirectory('relocation-recovery'),file=path.join(dir,'receipts.json'),store=new ReceiptStore(file),audit=new AuditLog(path.join(dir,'audit.jsonl'));
  let recovering=false,editCalls=0;const calls:string[]=[];
  const bridge={async call(r:BridgeRequest){calls.push(r.command);let result:unknown;
   if(r.command==='inspect_project')result=recovering?f.moved:f.before;
   else if(r.command==='inspect_host_context')result={activeProject:true,activeSequence:true,projectId:'reopened',sequenceId:'s'};
   else if(r.command==='inspect_command_execution')result={status:'pass',protocol:1,active:[],commands:[{id:'lost',state:'unknown'}]};
   else{editCalls++;expect(await store.relocationPlan('lost')).toMatchObject({baseSnapshot:f.before});throw Error('native process disconnected');}
   return {version:1 as const,id:r.id,ok:true,durationMs:1,result};}};
  const host=new HostExecutor(bridge as any,audit,store,1000),receipt=await host.mutate('move_clip_to_track',f.args,'lost');
  expect(receipt.status).toBe('unverified');recovering=true;
  if(legacy){const {createHash}=await import('node:crypto');await unlink(path.join(file+'.d','plan-'+createHash('sha256').update('lost').digest('hex')+'.json'));}
  const proof=await host.reconcileMutation('lost');expect(proof).toMatchObject({status:'pass',quarantineReleased:true,originalExecution:'unverified',contentReplayed:false,originalReceiptUnchanged:true});
  expect(await store.get('lost')).toEqual(receipt);expect(await store.inspectRecovery()).toBeUndefined();expect(editCalls).toBe(1);
  expect(calls.filter(c=>c==='move_clip_to_track')).toHaveLength(1);
 });
});
