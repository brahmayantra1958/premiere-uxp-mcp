import {describe,it,expect,vi} from 'vitest';
import {uxpModules} from '../helpers/uxp-modules.js';
import {hostResponseReceipt} from '../../apps/mcp-server/src/host-operation-receipt.js';

const pins={expectedProjectId:'p',expectedSequenceId:'s'};

function fixture() {
  const sequence={guid:'s',name:'Renamed final sequence'};
  const save=vi.fn(async()=>true);
  const project={guid:'p',name:'Local project',path:'C:/work.prproj',getActiveSequence:()=>sequence,save};
  const getActiveProject=vi.fn(()=>project);
  const load=uxpModules({Project:{getActiveProject}});
  const {PremiereHost}=load('apps/uxp-plugin/src/premiere-host.ts');
  const host=new PremiereHost();
  return {sequence,project,save,getActiveProject,run:(args:Record<string,unknown>)=>host.dispatchCommand({command:'save_working_project',args})};
}

describe('scoped project save',()=>{
  it.each([false,true])('saves a renamed sequence with optional name supplied: %s',async supplyName=>{
    const f=fixture();
    const result=await f.run({...pins,...(supplyName?{expectedSequenceName:f.sequence.name}:{})});
    expect(f.save).toHaveBeenCalledTimes(1);
    const target={projectId:'p',sequenceId:'s',sequenceName:f.sequence.name,path:'C:/work.prproj'};
    expect(result).toMatchObject({status:'pass',before:target,after:target,changedFiles:['C:/work.prproj'],errors:[]});
  });
  it.each([
    {...pins,expectedSequenceName:'Old sequence name'},
    {...pins,expectedProjectId:'other-project'},
    {...pins,expectedSequenceId:'other-sequence'},
    {expectedProjectId:'p'},
  ])('proves target rejection occurs before save: %j',async args=>{
    const f=fixture();
    let caught:any;
    try {await f.run(args);} catch(error) {caught=error;}
    expect(caught).toMatchObject({code:'CONTEXT_CHANGED',details:{contentDispatched:false,retryable:false,errorClassification:'preflight',actualTarget:{projectId:'p',sequenceId:'s',sequenceName:f.sequence.name}}});
    expect(f.save).not.toHaveBeenCalled();
    const receipt=hostResponseReceipt({version:1,id:'save-test',ok:false,durationMs:0,error:{code:caught.code,message:caught.message,details:caught.details}}, {},
      {commandId:'save-test',command:'save_working_project',startedAt:new Date().toISOString(),completedAt:new Date().toISOString()});
    expect(receipt).toMatchObject({status:'fail',errorClassification:'preflight',hostResult:{contentDispatched:false}});
  });
  it.each(['project','sequence','path'] as const)('does not report success when %s identity changes during save',async changed=>{
    const f=fixture();
    f.save.mockImplementation(async()=>{
      if(changed==='project')f.project.guid='other-project';
      if(changed==='sequence')f.sequence.guid='other-sequence';
      if(changed==='path')f.project.path='C:/other.prproj';
      return true;
    });
    const result=await f.run(pins);
    expect(result).toMatchObject({status:'fail',hostResult:true,changedFiles:['C:/work.prproj']});
    expect(result.errors[0]).toContain('SAVE_TARGET_READBACK_CHANGED');
    expect(f.save).toHaveBeenCalledTimes(1);
  });
  it('preserves the internal unscoped save contract',async()=>{
    const f=fixture();
    expect(await f.run({})).toMatchObject({status:'pass',before:{projectId:'p'},after:{projectId:'p'}});
    expect(f.save).toHaveBeenCalledTimes(1);
  });
  it('pins an explicit path before save even when project GUID and sequence IDs are shared by copies',async()=>{
    const f=fixture();
    await expect(f.run({...pins,expectedProjectPath:'C:/different-copy.prproj'})).rejects.toMatchObject({code:'PROJECT_PATH_PRECONDITION_FAILED',details:{contentDispatched:false}});
    expect(f.save).not.toHaveBeenCalled();
    expect(await f.run({...pins,expectedProjectPath:'c:\\WORK.PRPROJ'})).toMatchObject({status:'pass'});
    expect(f.save).toHaveBeenCalledTimes(1);
  });
  it('rejects path drift after a path-pinned save without dispatching again',async()=>{
    const f=fixture();
    f.save.mockImplementation(async()=>{f.project.path='C:/different-copy.prproj';return true;});
    expect(await f.run({...pins,expectedProjectPath:'C:/work.prproj'})).toMatchObject({status:'fail',errors:[expect.stringContaining('SAVE_TARGET_READBACK_CHANGED')]});
    expect(f.save).toHaveBeenCalledTimes(1);
  });
});
