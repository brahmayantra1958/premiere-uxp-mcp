import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { captureProgramFrameEvidence, registerProgramFrameTool } from '../../apps/mcp-server/src/program-frame-tools.js';
import { BridgeTransportError, transportFailure } from '../../apps/mcp-server/src/bridge-transport.js';
import { freshTestDirectory } from '../helpers/workspace.js';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aO6sAAAAASUVORK5CYII=','base64');
const sha256=createHash('sha256').update(png).digest('hex');
type ReadHook=(args:Record<string,any>,capture:()=>Promise<Record<string,any>>)=>Promise<Record<string,any>>;

async function fixture(hook?:ReadHook){
  const directory=await freshTestDirectory('program-frame-tool-failures');
  const host={read:vi.fn(async(command:string,args:Record<string,any>)=>{
    expect(command).toBe('capture_program_frame');
    const capture=async()=>{
      await writeFile(args.outputPath,png);
      return {status:'pass',exportAccepted:true,projectId:'project',sequenceId:'sequence',sequenceName:'Review',
        frame:{outputPath:args.outputPath,requestedSeconds:args.timeSeconds,timeSeconds:args.timeSeconds,frameIndex:12,ticks:'127008000000',width:1,height:1,finalizedSha256:sha256},errors:[]};
    };
    return hook?hook(args,capture):capture();
  })};
  const paths={authorizeWrite:vi.fn((value:string)=>({path:path.join(directory,path.basename(value)),root:{role:'output'}}))};
  let tool!:(args:any)=>Promise<any>;
  const server={registerTool:(name:string,_definition:any,run:any)=>{if(name==='capture_program_frame')tool=run;}};
  registerProgramFrameTool(server as any,host as any,paths as any);
  const args={expectedProjectId:'project',expectedSequenceId:'sequence',expectedSequenceName:'Review',timeSeconds:.5};
  return {host,paths,args,run:(overrides:Record<string,unknown>={})=>tool({...args,...overrides})};
}

describe('direct program frame failure evidence',()=>{
  it('returns a verified PNG image and the unchanged successful receipt shape',async()=>{
    const f=await fixture(),reply=await f.run(),receipt=reply.structuredContent;
    expect(reply.isError).not.toBe(true);expect(receipt).toMatchObject({status:'pass',exportAccepted:true,frame:{width:1,height:1,sha256,finalizedSha256:sha256}});
    expect(reply.content.filter((item:any)=>item.type==='image')).toEqual([{type:'image',mimeType:'image/png',data:png.toString('base64')}]);
    expect(await readFile(receipt.frame.outputPath)).toEqual(png);expect(f.host.read).toHaveBeenCalledTimes(1);
  });

  it('preserves an after-invocation timeout as unknown with its recoverable output path and no automatic retry',async()=>{
    const failure=new BridgeTransportError('Frame command timed out',{code:'PANEL_COMMAND_TIMEOUT',dispatchState:'unknown'});
    const f=await fixture(async()=>{throw failure;}),reply=await f.run(),value=reply.structuredContent;
    const outputPath=f.host.read.mock.calls[0]![1].outputPath;
    expect(reply.isError).toBe(true);expect(value).toMatchObject({status:'unverified',retryable:false,capture:{outputPath,hostReadInvoked:true,nativeExportDispatch:'unknown',transport:failure.transport}});
    expect(value).not.toHaveProperty('contentDispatched');expect(value.capture).not.toHaveProperty('hostResult');
    expect(value.possiblyChangedFiles).toEqual([outputPath]);expect(value.recovery).toContain('Do not retry');
    expect(reply.content.some((item:any)=>item.type==='image')).toBe(false);expect(f.host.read).toHaveBeenCalledTimes(1);
  });

  it('retains explicit pre-send rejection as FAIL while recording that host.read was invoked',async()=>{
    const failure=new BridgeTransportError('Panel not connected',{code:'PANEL_DISCONNECTED',dispatchState:'not_sent'});
    const f=await fixture(async()=>{throw failure;}),value=(await f.run()).structuredContent;
    expect(value).toMatchObject({status:'fail',contentDispatched:false,capture:{hostReadInvoked:true,nativeExportDispatch:'not_dispatched',transport:failure.transport}});
    expect(value.capture.outputPath).toBe(f.host.read.mock.calls[0]![1].outputPath);expect(value.possiblyChangedFiles).toEqual([]);
    expect(f.host.read).toHaveBeenCalledTimes(1);
  });

  it('keeps authorization failure before any host call as FAIL',async()=>{
    const f=await fixture();f.paths.authorizeWrite.mockImplementationOnce(()=>{throw Error('PATH_NOT_ALLOWED');});
    const value=(await f.run()).structuredContent;
    expect(value).toMatchObject({status:'fail',contentDispatched:false,errors:['PATH_NOT_ALLOWED'],capture:{hostReadInvoked:false,nativeExportDispatch:'not_dispatched'}});
    expect(value.capture).not.toHaveProperty('outputPath');expect(value.possiblyChangedFiles).toEqual([]);expect(f.host.read).not.toHaveBeenCalled();
  });

  it('keeps native PASS plus a PNG hash mismatch UNVERIFIED and preserves both independent proofs',async()=>{
    let proof:Record<string,any>|undefined;
    const f=await fixture(async(_args,capture)=>{proof=await capture();proof.frame.finalizedSha256='0'.repeat(64);return proof;});
    const reply=await f.run(),value=reply.structuredContent;
    expect(value).toMatchObject({status:'unverified',contentDispatched:true,errors:['PROGRAM_FRAME_IMAGE_VERIFICATION_FAILED'],capture:{hostReadInvoked:true,nativeExportDispatch:'confirmed',hostResult:proof,artifactEvidence:{status:'pass',sha256,width:1,height:1}}});
    expect(value.capture.outputPath).toBe(proof!.frame.outputPath);expect(value.possiblyChangedFiles).toEqual([proof!.frame.outputPath]);
    expect(await readFile(proof!.frame.outputPath)).toEqual(png);expect(reply.content.some((item:any)=>item.type==='image')).toBe(false);
    expect(f.host.read).toHaveBeenCalledTimes(1);
  });

  it('keeps a missing artifact after native acceptance UNVERIFIED with the host proof',async()=>{
    const f=await fixture(async args=>({status:'pass',exportAccepted:true,frame:{outputPath:args.outputPath,finalizedSha256:sha256,width:1,height:1}}));
    const value=(await f.run()).structuredContent;
    expect(value).toMatchObject({status:'unverified',contentDispatched:true,capture:{hostReadInvoked:true,nativeExportDispatch:'confirmed',hostResult:{status:'pass',exportAccepted:true}}});
    expect(value.errors.join(' ')).toContain('ENOENT');expect(value.possiblyChangedFiles).toEqual([value.capture.outputPath]);
  });

  it('does not turn a returned UNVERIFIED native result into FAIL',async()=>{
    const proof={status:'unverified',exportAccepted:true,errors:['Native finalization incomplete']};
    const f=await fixture(async()=>proof),value=(await f.run()).structuredContent;
    expect(value).toMatchObject({status:'unverified',capture:{nativeExportDispatch:'confirmed',hostResult:proof}});expect(f.host.read).toHaveBeenCalledTimes(1);
  });

  it('preserves exact shared-consumer errors, code, details and transport; observer errors cannot replace them',async()=>{
    const failure=Object.assign(new BridgeTransportError('Panel not connected',{code:'PANEL_DISCONNECTED',dispatchState:'not_sent'}),
      {code:'FIXTURE_CODE',details:Object.freeze({contentDispatched:false,custom:'preserved'})});
    const f=await fixture(async()=>{throw failure;});
    let observed:any;
    const caught=await captureProgramFrameEvidence(f.host as any,f.paths as any,f.args,evidence=>{observed=evidence;throw Error('Observer failed');}).catch(error=>error);
    expect(caught).toBe(failure);expect(caught.code).toBe('FIXTURE_CODE');expect(caught.details).toBe(failure.details);
    expect(transportFailure(caught)).toBe(failure.transport);expect(caught).not.toHaveProperty('capture');
    expect(caught.details).not.toHaveProperty('capture');expect(observed).toMatchObject({status:'fail',capture:{hostReadInvoked:true,nativeExportDispatch:'not_dispatched'}});
  });

  it('separates concurrent invocation metadata even when the host reuses one Error object',async()=>{
    const reused=Error('Unclassified native error');
    const f=await fixture(async()=>{await Promise.resolve();throw reused;});
    const times=[1,2];
    const replies=await Promise.all(times.map(timeSeconds=>f.run({timeSeconds})));
    expect(replies.map(reply=>reply.structuredContent.status)).toEqual(['unverified','unverified']);
    const outputs=replies.map(reply=>reply.structuredContent.capture.outputPath);
    // mkdir completion may reverse transport invocation order. Match each
    // reply to its requested time, not to the host mock's arrival order.
    expect(new Set(outputs).size).toBe(2);
    expect(outputs).toEqual(times.map(timeSeconds=>f.host.read.mock.calls.find(call=>call[1].timeSeconds===timeSeconds)![1].outputPath));
    expect(replies.every(reply=>reply.structuredContent.capture.nativeExportDispatch==='unknown')).toBe(true);
  });
});
