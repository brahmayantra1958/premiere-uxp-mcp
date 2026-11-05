import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { BridgeRequest, OperationReceipt } from '@premiere-uxp/contracts';
import { registerInspectionTools } from '../../apps/mcp-server/src/inspection-tools.js';
import { AuditLog, ReceiptStore } from '../../apps/mcp-server/src/audit.js';
import { HostExecutor } from '../../apps/mcp-server/src/host-executor.js';
import { BridgeTransportError } from '../../apps/mcp-server/src/bridge-transport.js';
import { freshTestDirectory } from '../helpers/workspace.js';

const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aO6sAAAAASUVORK5CYII=','base64');
const sha256=createHash('sha256').update(png).digest('hex');
type FrameHook=(index:number,args:Record<string,unknown>,capture:()=>Promise<Record<string,any>>)=>Promise<Record<string,any>>;

/** Real local mutation, artifact verification and durable receipt/lease paths;
 * only the Premiere transport is a fixture. Writes stay in an isolated root. */
async function fixture(count:number,hook?:FrameHook){
  const directory=await freshTestDirectory('review-frame-failures');
  const store=new ReceiptStore(path.join(directory,'receipts.json'));
  const frames:Record<string,any>[]=[];
  let calls=0;
  const call=vi.fn(async(request:BridgeRequest)=>{
    expect(request.command).toBe('capture_program_frame');
    const index=calls++;
    const capture=async()=>{
      await writeFile(String(request.args.outputPath),png);
      const frame={status:'pass',exportAccepted:true,frame:{outputPath:request.args.outputPath,
        requestedSeconds:request.args.timeSeconds,frameIndex:index,width:1,height:1,finalizedSha256:sha256},
      navigation:{restoreRequested:false,restored:false},errors:[]};
      frames.push(frame);return frame;
    };
    const result=hook?await hook(index,request.args,capture):await capture();
    return {version:1 as const,id:request.id,ok:true,result,durationMs:1};
  });
  const host=new HostExecutor({call,getStatus:async()=>{throw Error('No live status allowed');}},new AuditLog(path.join(directory,'audit.jsonl')),store,1000);
  let run!:(args:any)=>Promise<any>;
  const server={registerTool:(name:string,_definition:any,callback:any)=>{if(name==='export_review_frames')run=callback;}};
  const paths={authorizeWrite:(value:string)=>({path:value,root:{role:'output'}})};
  registerInspectionTools(server as any,{} as any,host,paths as any,{} as any);
  const args={expectedProjectId:'project',expectedSequenceId:'sequence',expectedSequenceName:'Review',restorePlayhead:false,
    timesSeconds:Array.from({length:count},(_,index)=>index/24),outputPaths:Array.from({length:count},(_,index)=>path.join(directory,`${index}.png`)),operationId:randomUUID()};
  return {args,store,call,frames,run:async()=>((await run(args)).structuredContent as OperationReceipt)};
}

describe('review frame partial failure evidence',()=>{
  it('creates a new authorized output directory before the first native export',async()=>{
    const f=await fixture(1);f.args.outputPaths[0]=path.join(path.dirname(f.args.outputPaths[0]!), 'new','nested','frame.png');
    const receipt=await f.run();expect(receipt.status).toBe('pass');
    expect(await readFile(f.args.outputPaths[0])).toEqual(png);expect(f.call).toHaveBeenCalledTimes(1);
  });
  it('reports a parent creation failure as no dispatch and releases the first-frame lease',async()=>{
    const f=await fixture(1),blocker=path.join(path.dirname(f.args.outputPaths[0]!),'file-not-directory');await writeFile(blocker,'keep');
    f.args.outputPaths[0]=path.join(blocker,'frame.png');const receipt=await f.run();
    expect(receipt).toMatchObject({status:'fail',changedFiles:[],hostResult:{contentDispatched:false,hostReadsInvoked:0,failedFrame:{hostReadInvoked:false,nativeExportDispatch:'not_dispatched'}}});
    expect(f.call).not.toHaveBeenCalled();expect(await f.store.inspectRecovery()).toBeUndefined();expect(await readFile(blocker,'utf8')).toBe('keep');
  });
  it('verifies every successful file through the real local receipt and preserves capture proof',async()=>{
    const f=await fixture(3),receipt=await f.run();
    expect(receipt.status).toBe('pass');expect(receipt.changedFiles).toEqual(f.args.outputPaths);
    expect((receipt.hostResult as any).frames).toEqual(f.frames);
    expect((receipt.after as any).files.map((file:any)=>({path:file.path,sha256:file.sha256,status:file.status})))
      .toEqual(f.args.outputPaths.map(path=>({path,sha256,status:'pass'})));
    expect(f.call).toHaveBeenCalledTimes(3);expect(await f.store.get(f.args.operationId)).toEqual(receipt);
    expect(await f.store.inspectRecovery()).toBeUndefined();
  });

  it('retains 25 proven PNGs when frame 26 times out; four remaining frames never run and replay is immutable',async()=>{
    const f=await fixture(30,async(index,_args,capture)=>{
      if(index===25)throw Error('FRAME_UNVERIFIED: Error: PROGRAM_FRAME_FINALIZATION_TIMEOUT_UNVERIFIED');
      return capture();
    });
    const receipt=await f.run(),detail=receipt.hostResult as any;
    expect(receipt.status).toBe('unverified');expect(receipt.changedFiles).toEqual(f.args.outputPaths.slice(0,25));
    expect(detail.frames).toEqual(f.frames);expect(detail.frames).toHaveLength(25);
    expect(detail.failedFrame).toMatchObject({index:25,timeSeconds:25/24,outputPath:f.args.outputPaths[25],status:'unverified',hostReadInvoked:true,nativeExportDispatch:'unknown',fileFinalized:false});
    expect(detail.unexecutedFrames).toEqual([26,27,28,29].map(index=>({index,timeSeconds:index/24,outputPath:f.args.outputPaths[index],status:'not_started',hostReadInvoked:false})));
    expect(detail.possiblyChangedFiles).toEqual([f.args.outputPaths[25]]);expect(detail.contentDispatched).toBe(true);
    expect(detail.hostReadsInvoked).toBe(26);expect(f.call).toHaveBeenCalledTimes(26);
    expect((receipt.after as any).files).toHaveLength(25);
    expect((receipt.after as any).files.every((file:any)=>file.status==='pass'&&file.sha256===sha256)).toBe(true);
    for(const file of receipt.changedFiles)expect(createHash('sha256').update(await readFile(file)).digest('hex')).toBe(sha256);
    await expect(readFile(f.args.outputPaths[25]!)).rejects.toMatchObject({code:'ENOENT'});
    expect(await f.store.get(f.args.operationId)).toEqual(receipt);expect(await f.store.inspectRecovery()).toBeDefined();
    expect(await f.run()).toEqual(receipt);expect(f.call).toHaveBeenCalledTimes(26);
  });

  it('keeps a first-frame timeout unknown without inventing no dispatch or losing the unexecuted list',async()=>{
    const f=await fixture(3,async()=>{throw Error('Program frame call timed out');});
    const receipt=await f.run(),detail=receipt.hostResult as any;
    expect(receipt.status).toBe('unverified');expect(receipt.changedFiles).toEqual([]);
    expect(detail).not.toHaveProperty('contentDispatched');expect(detail.frames).toEqual([]);
    expect(detail.failedFrame).toMatchObject({index:0,timeSeconds:0,outputPath:f.args.outputPaths[0],hostReadInvoked:true,nativeExportDispatch:'unknown'});
    expect(detail.possiblyChangedFiles).toEqual([f.args.outputPaths[0]]);expect(detail.unexecutedFrames.map((row:any)=>row.index)).toEqual([1,2]);
    expect(f.call).toHaveBeenCalledTimes(1);expect(await f.store.inspectRecovery()).toBeDefined();
  });

  it.each(['transport','host'] as const)('records first-frame %s proof of no dispatch separately from invoking host.read',async source=>{
    const f=await fixture(3,async()=>{
      if(source==='transport')throw new BridgeTransportError('Panel not connected',{code:'PANEL_DISCONNECTED',dispatchState:'not_sent'});
      throw Object.assign(Error('Target precondition failed'),{details:{contentDispatched:false,errorClassification:'preflight'}});
    });
    const receipt=await f.run(),detail=receipt.hostResult as any;
    expect(receipt.status).toBe('fail');expect(receipt.changedFiles).toEqual([]);
    expect(detail.contentDispatched).toBe(false);expect(detail.possiblyChangedFiles).toEqual([]);
    expect(detail.failedFrame).toMatchObject({index:0,status:'fail',hostReadInvoked:true,nativeExportDispatch:'not_dispatched',fileFinalized:false});
    expect(detail.unexecutedFrames).toHaveLength(2);expect(f.call).toHaveBeenCalledTimes(1);
    expect(await f.store.inspectRecovery()).toBeUndefined();
  });

  it('does not declare the whole batch undispatched when a later frame is proven not sent',async()=>{
    const f=await fixture(3,async(index,_args,capture)=>{
      if(index===1)throw new BridgeTransportError('Panel not connected',{code:'PANEL_DISCONNECTED',dispatchState:'not_sent'});
      return capture();
    });
    const receipt=await f.run(),detail=receipt.hostResult as any;
    expect(receipt.status).toBe('fail');expect(receipt.changedFiles).toEqual(f.args.outputPaths.slice(0,1));
    expect(detail.contentDispatched).toBe(true);expect(detail.failedFrame.nativeExportDispatch).toBe('not_dispatched');
    expect(detail.possiblyChangedFiles).toEqual([]);expect(detail.frames).toEqual(f.frames);expect(f.call).toHaveBeenCalledTimes(2);
    expect(await f.store.inspectRecovery()).toBeDefined();
  });

  it('retains a returned unverified frame and never promotes it because an incomplete output happens to exist',async()=>{
    const f=await fixture(3,async(index,args,capture)=>{
      if(index!==1)return capture();
      await writeFile(String(args.outputPath),png);
      return {status:'unverified',exportAccepted:true,frame:{outputPath:args.outputPath},errors:['Finalization proof missing']};
    });
    const receipt=await f.run(),detail=receipt.hostResult as any;
    expect(receipt.status).toBe('unverified');expect(receipt.changedFiles).toEqual(f.args.outputPaths.slice(0,1));
    expect(detail.frames).toHaveLength(2);expect(detail.frames[1].status).toBe('unverified');
    expect(detail.failedFrame).toMatchObject({index:1,nativeExportDispatch:'confirmed',fileFinalized:false});
    expect(detail.possiblyChangedFiles).toEqual([f.args.outputPaths[1]]);
    expect((receipt.after as any).files).toHaveLength(1);expect(f.call).toHaveBeenCalledTimes(2);
  });

  it('keeps explicit native rejection distinct from unknown export execution',async()=>{
    const f=await fixture(2,async()=>({status:'fail',exportAccepted:false,errors:['Native frame export failed']}));
    const receipt=await f.run(),detail=receipt.hostResult as any;
    expect(receipt.status).toBe('fail');expect(receipt.changedFiles).toEqual([]);
    expect(detail.failedFrame).toMatchObject({index:0,nativeExportDispatch:'confirmed',fileFinalized:false});
    expect(detail.contentDispatched).toBe(true);expect(f.call).toHaveBeenCalledTimes(1);
  });

  it('preserves the current finalized PNG when navigation stops the remaining captures',async()=>{
    const f=await fixture(3,async(index,_args,capture)=>{
      const frame=await capture();
      if(index===1)frame.navigation={...frame.navigation,restoreSkipped:true};
      return frame;
    });
    const receipt=await f.run(),detail=receipt.hostResult as any;
    expect(receipt.status).toBe('fail');expect(receipt.changedFiles).toEqual(f.args.outputPaths.slice(0,2));
    expect(detail.frames).toEqual(f.frames);expect(detail.failedFrame).toMatchObject({index:1,fileFinalized:true,nativeExportDispatch:'confirmed'});
    expect(detail.possiblyChangedFiles).toEqual([]);expect(detail.unexecutedFrames).toHaveLength(1);expect(f.call).toHaveBeenCalledTimes(2);
  });
});
