import { describe, expect, it, vi } from 'vitest';
import { assertExclusiveLifecycleTarget, assertLifecycleStillClosed, lifecyclePreflight, readLifecycleContext, verifiedProjectClose } from '../../apps/mcp-server/src/project-lifecycle-preflight.js';
import { closeReceiptFixture, lifecycleContextFixture, projectViewFixture } from '../fixtures/project-lifecycle.js';

const target={projectId:'copied-guid',projectPath:'C:\\scratch\\target.prproj',sequenceId:'seq',sequenceName:'Sequence'};
describe('lifecycle view preflight and exact native close witness',()=>{
  it('accepts multiple views of the same GUID and normalized path',()=>{
    const context=lifecycleContextFixture(target);context.projectPath='\\\\?\\C:\\SCRATCH\\TARGET.PRPROJ';
    context.openProjects.projects=[projectViewFixture({...target,projectPath:'c:/scratch/target.prproj'},['view-1','view-2'])];context.openProjects.viewCount=2;
    expect(()=>assertExclusiveLifecycleTarget(context,target)).not.toThrow();
  });
  it.each(['same-guid','different-guid','active-path','missing-target','missing-inventory','duplicate-view','wrong-count','unsupported-scope'] as const)('fails closed before save for %s',async fault=>{
    const context:any=lifecycleContextFixture(target);
    if(fault==='same-guid'||fault==='different-guid'){
      context.openProjects.projects.push(projectViewFixture({...target,projectId:fault==='same-guid'?target.projectId:'other',projectPath:'C:/scratch/copy.prproj'},['view-2']));context.openProjects.viewCount=2;
    }
    if(fault==='active-path')context.projectPath='C:/scratch/copy.prproj';
    if(fault==='missing-target'){context.openProjects.projects=[];context.openProjects.viewCount=0;}
    if(fault==='missing-inventory')delete context.openProjects;
    if(fault==='duplicate-view'){context.openProjects.projects[0].viewIds.push('view-1');context.openProjects.viewCount=2;}
    if(fault==='wrong-count')context.openProjects.viewCount=2;
    if(fault==='unsupported-scope')context.openProjects.scope='active_project_only';
    const read=vi.fn().mockResolvedValue(context),result=await lifecyclePreflight({read},target);
    expect(read).toHaveBeenCalledExactlyOnceWith('inspect_host_context',{includeOpenProjects:true});
    expect(result).toMatchObject({status:'fail',changedFiles:[],result:{phase:'preflight',contentDispatched:false,retryable:false}});
    if(fault==='same-guid')expect(result!.errors[0]).toContain('DUPLICATE_OPEN_PROJECT_GUID');
    if(fault==='different-guid')expect(result!.errors[0]).toContain('PROJECT_LIFECYCLE_MULTIPLE_PROJECTS');
  });
  it('does not convert a strict host read rejection into no active project',async()=>{
    const host={read:vi.fn().mockRejectedValue(Error('native view unavailable'))};
    await expect(readLifecycleContext(host)).rejects.toThrow('native view unavailable');
    expect((await lifecyclePreflight(host,target))?.result.contentDispatched).toBe(false);
  });
  it('accepts exact event, true close and strict empty view proof without altering the receipt',()=>{
    const receipt=closeReceiptFixture(target),before=JSON.stringify(receipt);
    expect(verifiedProjectClose(receipt,target).closedEvent.path).toBe(target.projectPath);expect(JSON.stringify(receipt)).toBe(before);
  });
  it.each(['boolean-only','false-close','unknown-status','missing-event','wrong-guid','wrong-path','remaining-target','remaining-copy','unverified-inventory'] as const)('rejects incomplete close proof: %s',fault=>{
    const receipt:any=closeReceiptFixture(target),proof=receipt.hostResult.closeVerification;
    if(fault==='boolean-only')delete receipt.hostResult.closeVerification;
    if(fault==='false-close')receipt.hostResult.closed=false;
    if(fault==='unknown-status')receipt.status='unverified';
    if(fault==='missing-event')proof.closedEvent=null;
    if(fault==='wrong-guid')proof.closedEvent.id='other';
    if(fault==='wrong-path')proof.closedEvent.path='C:/scratch/copy.prproj';
    if(fault==='remaining-target'||fault==='remaining-copy'){proof.openProjects.projects=[projectViewFixture({...target,projectPath:fault==='remaining-target'?target.projectPath:'C:/scratch/copy.prproj'})];proof.openProjects.viewCount=1;}
    if(fault==='unverified-inventory')proof.openProjects.status='unverified';
    expect(()=>verifiedProjectClose(receipt,target)).toThrow();
    if(fault==='remaining-copy')expect(()=>verifiedProjectClose(receipt,target)).toThrow('PROJECT_LIFECYCLE_MULTIPLE_PROJECTS');
  });
  it('requires a fresh empty strict context before archive replacement',()=>{
    expect(()=>assertLifecycleStillClosed(lifecycleContextFixture(target,false))).not.toThrow();
    expect(()=>assertLifecycleStillClosed(lifecycleContextFixture(target,true))).toThrow('PROJECT_REOPENED');
  });
});
