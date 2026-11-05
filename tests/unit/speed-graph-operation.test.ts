import {beforeEach,describe,expect,it,vi} from 'vitest';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {gzipSync,gunzipSync} from 'node:zlib';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {target,fixture} from '../fixtures/speed-graph.js';
import {inspectSpeedGraph} from '../../apps/mcp-server/src/speed-graph-archive.js';
import {runSpeedGraph} from '../../apps/mcp-server/src/speed-graph-operation.js';
import {runNativeEffectAdapter} from '../../apps/mcp-server/src/native-effect-worker.js';
import type {HostExecutor} from '../../apps/mcp-server/src/host-executor.js';
import type {PathPolicy} from '../../apps/mcp-server/src/path-policy.js';
import { closeReceiptFixture, lifecycleContextFixture, projectViewFixture } from '../fixtures/project-lifecycle.js';

vi.mock('../../apps/mcp-server/src/config.js',()=>({runtimePaths:{runtimeDirectory:'artifacts/tests/speed-graph-operation'}}));
vi.mock('../../apps/mcp-server/src/native-effect-worker.js',()=>({runNativeEffectAdapter:vi.fn()}));
const directory=path.resolve('artifacts/tests/speed-graph-operation'),projectPath=path.join(directory,'fixture.prproj');
const pin={projectPath,projectId:'project',sequenceId:target.sequenceId,sequenceName:'WORKING__fixture'};
const args={expectedProjectId:pin.projectId,expectedSequenceId:pin.sequenceId,expectedSequenceName:pin.sequenceName,expanded:true};
const tab=pin.sequenceName+' • '+target.clipName;
const names=['AE.ADBE Opacity','AE.ADBE Motion'];
const state={status:'pass',item:{mediaType:'video',trackIndex:target.trackIndex,start:{ticks:target.startTicks},end:{ticks:target.endTicks},projectItemId:target.projectItemId,name:target.clipName},components:names.map(matchName=>({matchName,params:[]}))};
const policy={authorizeRead:(candidate:string)=>({path:candidate,root:{role:'source',isNas:false}})} as unknown as PathPolicy;
const xml=async()=>gunzipSync(await readFile(projectPath)).toString('utf8');
const writeXml=(value:string)=>writeFile(projectPath,gzipSync(Buffer.from(value)));
type Fault='close_unknown'|'never_closed'|'reopen_unknown'|'native_ignored'|'curve_changed'|'wrong_scope'|'clock_changed'|'owner_retained'|'clock_timeout'|'label_missing'|'animation_changed'|'closed-read-error'|'reopened-before-write';
function host(fault?:Fault,initialExpanded=false){
 let active=true,expanded=initialExpanded,reopened=false;
 const calls:string[]=[];
 vi.mocked(runNativeEffectAdapter).mockImplementation(async()=>({protocol:1,status:'pass',route:'windows_msaa_parameter_state',premierePid:fault==='wrong_scope'?124:123,panelHandle:456,selectedClipTab:tab,headerIndex:2,rows:[{index:299,ordinal:0,role:43,state:expanded?8:0,name:'UI_DisclosureTriangleButton',top:100,width:14,height:14,animationControl:{index:300,role:43,state:reopened&&fault==='animation_changed'?0:8,top:100,name:'애니메이션 켜기/끄기'},graphLabels:expanded?[{role:41,name:(fault==='label_missing'?'':'속도')+': 100.00'}]:[]}],viewport:{top:40,height:300}}));
 return {calls,
  read:async(command:string,input?:any)=>{
   calls.push(command);if(command==='inspect_host_context'){if(!active&&fault==='closed-read-error')throw Error('strict context invalidated');return lifecycleContextFixture(pin,active||fault==='reopened-before-write');}if(command==='get_capabilities')throw Error('Legacy capability close proof must not be read');
   if(fault==='clock_timeout'&&input?.timeSeconds!==undefined)throw Error('READ_SDK_CALLBACK_TIMEOUT_UNVERIFIED');
   const sequenceTicks=String(Math.round((input?.timeSeconds??Number(target.startTicks)/254016000000)*254016000000));
   return {...structuredClone(state),nativeTimeProof:{status:'pass',exactOnly:true,startTicks:target.startTicks,endTicks:target.endTicks,samples:[{sequenceTicks,nativeTicks:sequenceTicks,rate:reopened&&fault==='clock_changed'?2:1,evidence:{clock:{basis:'mapped'}}}]}};
  },
  mutate:async(command:string,input?:any)=>{
   calls.push(command);if(command==='inspect_host_context')return {...pin,activeProject:true,activeSequence:true};
   if(command==='save_working_project'){expect(input.expectedProjectPath).toBe(projectPath);return {status:'pass'};}
   const readback={protocol:1,status:'pass',route:'windows_msaa_effect_state',premierePid:123,panelHandle:456,selectedClipTab:tab,headers:[0,1,2].map(()=>({role:43,state:8,height:14})),binding:{method:'isolated_disclosure_transition',layout:JSON.stringify(['video',names,null,'match_name']),matchName:'BE.TimeRemapping',headerIndices:[2],before:[true,true,false],after:[true,true,true]}};
   return {status:'pass',hostResult:{visibility:{effectExpansion:{status:'pass',readback}}}};
  },
  mutateLifecycle:async(command:string,input?:any)=>{
   calls.push(command);if(command==='inspect_host_context')return {...pin,activeProject:true,activeSequence:true};
   if(command==='close_working_project'){
    expect(input.requireExclusiveProject).toBe(true);
    if(fault==='close_unknown')return {status:'unverified'};
    active=false;return closeReceiptFixture(pin,fault==='never_closed');
   }
   if(fault==='reopen_unknown')throw Error('disconnected after dispatch');
   active=true;reopened=true;
   if(fault==='curve_changed')await writeXml((await xml()).replace('100,1,6;','100,2,6;'));
   if(fault!=='native_ignored')expanded=inspectSpeedGraph(await xml(),target).expanded===true;
   if(fault!=='owner_retained'){
    let current=await xml();
    for(const m of current.matchAll(/<TimeComponentParam\b[^>]*ObjectID="(\d+)"[^>]*>[\s\S]*?<\/TimeComponentParam>/g)){
     if(m[0].includes('<Keyframes>'))continue;
     const remap=[...current.matchAll(/<TimeRemapping\b[^>]*ObjectID="(\d+)"[^>]*>[\s\S]*?<\/TimeRemapping>/g)].find(r=>r[0].includes(`<Keyframes ObjectRef="${m[1]}"/>`));
     if(remap)current=current.replace(remap[0],'').replace(`<TimeRemapping ObjectRef="${remap[1]}"/>`,'').replace(m[0],'');
    }
    await writeXml(current);
   }
   return {status:'pass'};
  }
 };
}
beforeEach(async()=>{vi.clearAllMocks();await mkdir(directory,{recursive:true});await writeFile(path.join(directory,'designated-edit-target.json'),JSON.stringify(pin));await writeXml(fixture());});
describe('Speed disclosure lifecycle boundaries (fixtures, not host proof)',()=>{
 it('rejects a GUID-identical other path before save or any effect mutation',async()=>{
  const h=host(),read=h.read,before=await readFile(projectPath);
  h.read=async(command,input)=>{const value=await read(command,input);if(command==='inspect_host_context'){const context=lifecycleContextFixture(pin);context.openProjects.projects.push(projectViewFixture({...pin,projectPath:projectPath+'.copy.prproj'},['view-2']));context.openProjects.viewCount=2;return context;}return value;};
  const r=await runSpeedGraph(h as unknown as HostExecutor,policy,args,randomUUID());
  expect(r.status).toBe('fail');expect(r.result).toMatchObject({phase:'preflight',contentDispatched:false});expect(r.errors[0]).toContain('DUPLICATE_OPEN_PROJECT_GUID');expect(h.calls).not.toContain('save_working_project');expect(h.calls).not.toContain('set_effect_disclosure');expect(h.calls).not.toContain('close_working_project');expect(await readFile(projectPath)).toEqual(before);
 });
 it('changes only the UI property and requires a native arrow after one reopen',async()=>{
  const h=host(),before=inspectSpeedGraph(await xml(),target);
  const r=await runSpeedGraph(h as unknown as HostExecutor,policy,args,randomUUID());
  expect(r.status).toBe('pass');expect(r.result).toMatchObject({contentPreserved:true,after:{expanded:true}});
  expect(inspectSpeedGraph(await xml(),target).contentSha256).toBe(before.contentSha256);
  expect(h.calls.filter(c=>c==='open_working_project')).toHaveLength(1);
 });
 it('does not materialize an unknown owner format or begin its project lifecycle',async()=>{
  await writeXml(fixture().replace('<TimeRemapping ObjectRef="5"/>','').replace('Version="11"','Version="12"'));
  const original=await readFile(projectPath),h=host(),r=await runSpeedGraph(h as unknown as HostExecutor,policy,args,randomUUID());
  expect(r.status).toBe('fail');expect(r.errors[0]).toContain('TRANSIENT_CLIP_FORMAT_UNSUPPORTED');
  expect(h.calls).not.toContain('close_working_project');expect(await readFile(projectPath)).toEqual(original);
 });
 it('requires a keyless default owner to disappear while native clocks and disclosure survive',async()=>{
  await writeXml(fixture().replace('<TimeRemapping ObjectRef="5"/>',''));
  const original=await xml(),h=host(),r=await runSpeedGraph(h as unknown as HostExecutor,policy,args,randomUUID());
  expect(r.status).toBe('pass');expect(r.result).toMatchObject({ownerKind:'transient_ui_only',emptyOwnerRemovedOnSave:true,contentPreserved:true,after:{expanded:true}});
  expect(r.result.clockBefore).toHaveLength(3);expect(r.result.clockAfter).toEqual(r.result.clockBefore);expect(await xml()).toBe(original);
 });
 it.each(['clock_changed','owner_retained'] as const)('rejects a changed default clock or persisted owner: %s',async fault=>{
  await writeXml(fixture().replace('<TimeRemapping ObjectRef="5"/>',''));
  const h=host(fault),r=await runSpeedGraph(h as unknown as HostExecutor,policy,args,randomUUID());
  expect(r.status).toBe('unverified');expect(r.errors[0]).toMatch(/NATIVE_CLOCK_CHANGED|TRANSIENT_OWNER_NOT_EMPTY/);
 });
 it.each(['label_missing','animation_changed'] as const)('does not pass an arrow that lost its label or changed animation: %s',async fault=>{
  await writeXml(fixture().replace('<TimeRemapping ObjectRef="5"/>',''));
  const h=host(fault),r=await runSpeedGraph(h as unknown as HostExecutor,policy,args,randomUUID());
  expect(r.status).toBe('unverified');expect(r.errors[0]).toMatch(/VISIBLE_LABEL_UNVERIFIED|ANIMATION_STATE_CHANGED/);
 });
 it('does not label a broken already-open default view as a successful no-op',async()=>{
  await writeXml(fixture().replace('<TimeRemapping ObjectRef="5"/>',''));
  const h=host('label_missing',true),r=await runSpeedGraph(h as unknown as HostExecutor,policy,args,randomUUID());
  expect(r.status).toBe('unverified');expect(r.errors[0]).toContain('VISIBLE_LABEL_UNVERIFIED');expect(h.calls).not.toContain('close_working_project');
 });
 it('retains a timed-out clock read as unverified without starting an edit or retrying',async()=>{
  await writeXml(fixture().replace('<TimeRemapping ObjectRef="5"/>',''));
  const h=host('clock_timeout'),r=await runSpeedGraph(h as unknown as HostExecutor,policy,args,randomUUID());
  expect(r.status).toBe('unverified');expect(h.calls).not.toContain('close_working_project');
  expect(h.calls.filter(c=>c==='get_effect_values')).toHaveLength(2);
 });
 it.each(['close_unknown','never_closed','closed-read-error','reopened-before-write'] as const)('never writes or recovery-opens without current close proof: %s',async fault=>{
  const original=await readFile(projectPath),h=host(fault),r=await runSpeedGraph(h as unknown as HostExecutor,policy,args,randomUUID());
  expect(r.status).toBe('unverified');expect(h.calls).not.toContain('open_working_project');expect(await readFile(projectPath)).toEqual(original);
 });
 it('keeps an uncertain reopen unreplayed',async()=>{
  const h=host('reopen_unknown'),r=await runSpeedGraph(h as unknown as HostExecutor,policy,args,randomUUID());
  expect(r.status).toBe('unverified');expect(r.result.archiveWritten).toBe(true);expect(h.calls.filter(c=>c==='open_working_project')).toHaveLength(1);
 });
 it.each(['native_ignored','curve_changed'] as const)('cannot pass from a file write alone: %s',async fault=>{
  const h=host(fault),r=await runSpeedGraph(h as unknown as HostExecutor,policy,args,randomUUID());
  expect(r.status).toBe('unverified');expect(r.errors[0]).toMatch(/ACTUAL_ARROW_CHANGED|TIME_CURVE_CHANGED/);
 });
 it('rejects a foreign native row before scrolling, saving or closing',async()=>{
  const h=host('wrong_scope'),r=await runSpeedGraph(h as unknown as HostExecutor,policy,args,randomUUID());
  expect(r.status).toBe('unverified');expect(runNativeEffectAdapter).toHaveBeenCalledTimes(1);
  expect(h.calls).not.toContain('save_working_project');expect(h.calls).not.toContain('close_working_project');
 });
 it('accepts an independently observed no-op without reopening',async()=>{
  const h=host(),r=await runSpeedGraph(h as unknown as HostExecutor,policy,{...args,expanded:false},randomUUID());
  expect(r.status).toBe('pass');expect(r.result.changed).toBe(false);expect(h.calls).not.toContain('close_working_project');
 });
});
