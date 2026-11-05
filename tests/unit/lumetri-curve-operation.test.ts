import {readCurveChain} from '../../apps/mcp-server/src/archive-effect-read.js';
import {beforeEach,describe,expect,it,vi} from 'vitest';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {blank,points,fixture} from '../fixtures/lumetri-curve.js';
import {curveDigest} from '../../apps/mcp-server/src/lumetri-curve-codec.js';
import {runLumetriCurve,type CurveArgs} from '../../apps/mcp-server/src/lumetri-curve-operation.js';
import type {HostExecutor} from '../../apps/mcp-server/src/host-executor.js';
import type {PathPolicy} from '../../apps/mcp-server/src/path-policy.js';
import { closeReceiptFixture, lifecycleContextFixture, projectViewFixture } from '../fixtures/project-lifecycle.js';
vi.mock('../../apps/mcp-server/src/config.js',()=>({runtimePaths:{runtimeDirectory:'artifacts/tests/lumetri-curve-operation'}}));
const directory=path.resolve('artifacts/tests/lumetri-curve-operation'),projectPath=path.join(directory,'fixture.prproj');
const pin={projectPath,projectId:'project',sequenceId:'seq',sequenceName:'WORKING__fixture'};
const args:CurveArgs={expectedProjectId:'project',expectedSequenceId:'seq',expectedSequenceName:pin.sequenceName,componentIndex:1,paramIndex:0,expectedDisplayName:'Hue vs Sat',expectedCurveSha256:curveDigest(blank()),points};
const component={componentIndex:1,matchName:'AE.ADBE Lumetri',params:[{paramIndex:0,displayName:'Hue vs Sat',keyframeDetails:[]}]};
const state={status:'pass',item:{trackIndex:0,start:{ticks:'100'},end:{ticks:'200'},projectItemId:'source',name:'clip.mov'},component,components:[{componentIndex:0,matchName:'AE.ADBE Opacity',params:[]},component],visibility:{effectExpansion:{status:'pass'},parameterScroll:{status:'pass',scope:'exact_parameter',presentation:'custom_graph_region'}}};
const policy={authorizeRead:(candidate:string)=>({path:candidate,root:{role:'source',isNas:false}})} as unknown as PathPolicy;
function host(fault?:'close_unknown'|'reopen_unknown'|'never_closed'|'lose_curve'|'closed-read-error'|'reopened-before-write'){
  let active=true;const calls:string[]=[],saves:any[]=[],lifecycleInputs:any[]=[];
  return {calls,saves,lifecycleInputs,read:async(command:string)=>{calls.push(command);if(command==='inspect_host_context'){if(!active&&fault==='closed-read-error')throw Error('strict context invalidated');return lifecycleContextFixture(pin,active||fault==='reopened-before-write');}if(command==='get_capabilities')throw Error('Legacy capability close proof must not be read');return structuredClone(state);},
    mutate:async(command:string,input:any,id:any,options:any)=>{calls.push(command);if(command==='inspect_host_context')return {...pin,activeProject:true,activeSequence:true};saves.push({input,id,options});if(command==='close_working_project'){if(fault==='close_unknown')return {status:'unverified'};active=false;}return {status:'pass'};},
    mutateLifecycle:async(command:string,input:any)=>{calls.push(command);lifecycleInputs.push({command,input});if(command==='close_working_project'){if(fault==='close_unknown')return {status:'unverified'};active=false;return closeReceiptFixture(pin,fault==='never_closed');}if(fault==='reopen_unknown')throw Error('disconnected');active=true;if(fault==='lose_curve')await writeFile(projectPath,fixture());return {status:'pass'};}
  };
}
beforeEach(async()=>{await mkdir(directory,{recursive:true});await writeFile(path.join(directory,'designated-edit-target.json'),JSON.stringify(pin));await writeFile(projectPath,fixture());});
describe('typed curve lifecycle safeguards',()=>{
 it('reacquires only known transient reads once, never loops on unknown errors',async()=>{
  const attempts:any[]=[],reader=vi.fn().mockRejectedValueOnce(Error('The script object is no longer valid.')).mockResolvedValue(state);
  expect(await readCurveChain(reader,attempts)).toEqual(state);expect(reader).toHaveBeenCalledTimes(2);expect(attempts).toHaveLength(1);
  const broken=vi.fn().mockRejectedValue(Error('target changed'));await expect(readCurveChain(broken,[])).rejects.toThrow('target changed');expect(broken).toHaveBeenCalledTimes(1);
  const empty={visibility:{effectExpansion:{readback:{status:'pass',selectedClipTab:null,headers:[]}}}};
  const missing=vi.fn().mockResolvedValue(empty);expect(await readCurveChain(missing,[])).toEqual(empty);expect(missing).toHaveBeenCalledTimes(2);
  const timeout={visibility:{effectExpansion:{readback:{status:'unverified',reason:'NATIVE_EFFECT_OBSERVATION_UNAVAILABLE',nativeReason:'NATIVE_WORKER_TIMEOUT_DO_NOT_REPLAY'}}}};
  const readTimeout=vi.fn().mockResolvedValueOnce(timeout).mockResolvedValue(state);expect(await readCurveChain(readTimeout,[])).toEqual(state);expect(readTimeout).toHaveBeenCalledTimes(2);
  const scrollTimeout={visibility:{parameterScroll:{readback:{status:'unverified',reason:'NATIVE_WORKER_TIMEOUT_DO_NOT_REPLAY'}}}};
  const unknown=vi.fn().mockResolvedValue(scrollTimeout);expect(await readCurveChain(unknown,[])).toEqual(scrollTimeout);expect(unknown).toHaveBeenCalledTimes(1);
 });
 it('requires close proof, reopens once, verifies a new host save and preserves aliases',async()=>{
  const h=host(),r=await runLumetriCurve(h as unknown as HostExecutor,policy,args,randomUUID());
  expect(r.status).toBe('pass');expect(h.calls.filter(c=>c==='open_working_project')).toHaveLength(1);
 expect(h.saves).toHaveLength(2);expect(h.saves.every(s=>s.options.timeoutMs===240000&&s.input.expectedSequenceId===pin.sequenceId&&s.input.expectedProjectPath===projectPath)).toBe(true);
  expect(h.calls.slice(-2)).toEqual(['save_working_project','get_effect_values']);
  expect(h.lifecycleInputs[0]).toMatchObject({command:'close_working_project',input:{releaseEffectControls:true,sequenceId:pin.sequenceId,projectPath,requireExclusiveProject:true}});
  expect(r.result).toMatchObject({nativeAcceptance:'fresh_host_save_after_reopen',otherNativeParametersPreserved:true,curve:{points}});
  expect(gunzipSync(await readFile(projectPath)).toString()).toContain('<Other><StartKeyframeValue Encoding="base64" BinaryHash="abc">');
 });
 it('never treats a saved content success as proof of the final visible graph',async()=>{
  const h=host(),read=h.read;let reads=0;
  h.read=async command=>{const result=await read(command);if(command==='get_effect_values'&&++reads===2)(result as any).visibility.parameterScroll.status='unverified';return result;};
  const r=await runLumetriCurve(h as unknown as HostExecutor,policy,args,randomUUID());
  expect(r.status).toBe('unverified');expect(r.result).toMatchObject({nativeAcceptance:'fresh_host_save_after_reopen',otherNativeParametersPreserved:true});expect(r.errors[0]).toContain('VISIBILITY_UNVERIFIED');
  expect(h.calls.filter(c=>c==='open_working_project')).toHaveLength(1);
 });
 it('rejects stale digests before closing or changing the curve',async()=>{
  const h=host(),r=await runLumetriCurve(h as unknown as HostExecutor,policy,{...args,expectedCurveSha256:'0'.repeat(64)},randomUUID());
  expect(r.status).toBe('fail');expect(h.calls).not.toContain('close_working_project');expect(await readFile(projectPath,'utf8')).toBe(fixture());
 });
 it.each(['close_unknown','never_closed','closed-read-error','reopened-before-write'] as const)('never writes or recovery-opens after uncertain close state: %s',async fault=>{
  const h=host(fault),r=await runLumetriCurve(h as unknown as HostExecutor,policy,args,randomUUID());
  expect(r.status).toBe('unverified');expect(h.calls).not.toContain('open_working_project');expect(await readFile(projectPath,'utf8')).toBe(fixture());
 });
 it('retains an unknown reopen without retry or automatic overwrite',async()=>{
  const h=host('reopen_unknown'),r=await runLumetriCurve(h as unknown as HostExecutor,policy,args,randomUUID());
  expect(r.status).toBe('unverified');expect(h.calls.filter(c=>c==='open_working_project')).toHaveLength(1);expect(r.result).toMatchObject({archiveWritten:true});
 });
 it('does not accept a changed file when Premiere discarded the requested points',async()=>{
  const h=host('lose_curve'),r=await runLumetriCurve(h as unknown as HostExecutor,policy,args,randomUUID());
  expect(r.status).toBe('unverified');expect(r.errors[0]).toContain('NATIVE_POINTS_CHANGED');
 });
 it('rejects a GUID-identical other path before any save or close',async()=>{
  const h=host(),read=h.read;
  h.read=async command=>{const value=await read(command);if(command==='inspect_host_context'){const context=lifecycleContextFixture(pin);context.openProjects.projects.push(projectViewFixture({...pin,projectPath:projectPath+'.copy.prproj'},['view-2']));context.openProjects.viewCount=2;return context;}return value;};
  const r=await runLumetriCurve(h as unknown as HostExecutor,policy,args,randomUUID());
  expect(r.status).toBe('fail');expect(r.result).toMatchObject({phase:'preflight',contentDispatched:false});expect(r.errors[0]).toContain('DUPLICATE_OPEN_PROJECT_GUID');expect(h.saves).toHaveLength(0);expect(h.lifecycleInputs).toHaveLength(0);expect(await readFile(projectPath,'utf8')).toBe(fixture());
 });
});
