import {describe,expect,it} from 'vitest';
import type {BridgeResponse,ProjectSnapshot} from '@premiere-uxp/contracts';
import {createMutationPlan,declaredOutputPaths} from '../../apps/mcp-server/src/mutation-plan.js';
import {hostResponseReceipt} from '../../apps/mcp-server/src/host-operation-receipt.js';

const snapshot:ProjectSnapshot={
  projectId:'p',projectName:'Scratch',projectPath:'C:/scratch/working.prproj',capturedAt:'2026-09-16T00:00:00.000Z',
  activeSequence:null,sequences:[],projectItems:[],projectItemLimit:500,projectItemsTruncated:false,
  offlineMediaIds:[],proxyAttachments:[],markers:[],mogrtItems:[],effects:[],audioState:[],unsupportedFields:[],
};
const context={commandId:'operation-1',command:'set_effect_values',requestFingerprint:'fingerprint',
  startedAt:'2026-09-16T00:00:00.000Z',completedAt:'2026-09-16T00:00:01.000Z'};
const response:BridgeResponse={version:1,id:context.commandId,ok:true,durationMs:1};

describe('pure mutation rules',()=>{
  it('derives the same guarded plan from supplied inputs without inventing time or identity',()=>{
    const args={outputPath:'C:/scratch/new.prproj'};
    const before=structuredClone({snapshot,args});
    const plan=createMutationPlan(snapshot,'create_working_copy',args,'plan-1');
    expect(createMutationPlan(snapshot,'create_working_copy',args,'plan-1')).toEqual(plan);
    expect(plan).toMatchObject({planId:'plan-1',baseProjectId:'p',workingProjectPath:args.outputPath,
      expectedArtifacts:[args.outputPath],stopOnFailure:true,requiresUserAction:false});
    expect(plan.preconditions).toContain('Destination is below the local scratch root');
    expect({snapshot,args}).toEqual(before);
    expect(createMutationPlan(snapshot,'set_effect_values',{},'plan-2').preconditions)
      .toContain('Host verifies the current saved local project and exact sequence for each command');
  });
  it('projects only literal declared output strings and performs no path authorization',()=>{
    expect(declaredOutputPaths({outputPath:12,outputPaths:['',null,'C:/outside/file',{},'C:/outside/file']}))
      .toEqual(['','C:/outside/file','C:/outside/file']);
    expect(declaredOutputPaths({outputPaths:'not-an-array'})).toEqual([]);
  });
  it('never promotes transport success or an output declaration to native proof',()=>{
    expect(hostResponseReceipt(response,{changedFiles:['output.png']},context).status).toBe('unverified');
    expect(hostResponseReceipt(response,{status:'unverified',errors:['native proof missing']},context))
      .toMatchObject({status:'unverified',errors:['native proof missing']});
  });
  it('preserves host evidence and caller identity without mutating them',()=>{
    const result={status:'pass' as const,hostResult:{native:'verified'},visibility:{status:'pass'},
      before:{value:1},after:{value:2},recovery:'scoped recovery',changedFiles:[],errors:[]};
    const before=structuredClone(result);
    expect(hostResponseReceipt(response,result,context)).toEqual({...context,status:'pass',
      hostResult:{native:'verified',visibility:{status:'pass'}},before:{value:1},after:{value:2},
      recovery:'scoped recovery',changedFiles:[],errors:[]});
    expect(result).toEqual(before);
  });
  it('separates unsupported host commands from uncertain execution, ignoring optimistic payloads',()=>{
    for(const code of ['UNSUPPORTED_API','UNSUPPORTED_COMMAND','HOST_ERROR']){
      const receipt=hostResponseReceipt({...response,ok:false,error:{code,message:'rejected'}},{status:'pass'},context);
      expect(receipt.status).toBe(code.startsWith('UNSUPPORTED')?'unsupported':'unverified');
      expect(receipt.changedFiles).toEqual([]);
      expect(receipt.errors).toEqual([`${code}: rejected`]);
    }
  });
});
