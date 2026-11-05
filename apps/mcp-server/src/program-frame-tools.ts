import { randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod/v4";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HostExecutor } from "./host-executor.js";
import type { PathPolicy } from "./path-policy.js";
import { runtimePaths } from "./config.js";
import { probePngEvidence, type PngEvidence } from "./mask-seed-frame.js";
import { failure, result, writePathForRole } from "./tool-values.js";
import { transportFailure, type TransportFailure } from "./bridge-transport.js";
import { isHostNotConnectedBeforeDispatch } from "./host-dispatch-rejection.js";

type ProgramFrameCaptureMetadata = {
  outputPath?: string;
  hostReadInvoked: boolean;
  nativeExportDispatch: "confirmed" | "not_dispatched" | "unknown";
  hostResult?: Record<string, any>;
  artifactEvidence?: PngEvidence;
  transport?: TransportFailure;
};

type ProgramFrameCaptureFailure={status:"fail"|"unverified";capture:ProgramFrameCaptureMetadata};

/** Shared artifact proof for direct capture and source-range placement. */
export async function captureProgramFrameEvidence(host: HostExecutor, paths: PathPolicy, args: Record<string, unknown>, observeFailure?:(evidence:ProgramFrameCaptureFailure)=>void) {
  let outputPath:string|undefined,hostReadInvoked=false,hostResult:Record<string,any>|undefined,png:PngEvidence|undefined;
  try {
    outputPath=writePathForRole(paths,path.join(runtimePaths.output,"program-frames",`${randomUUID()}.png`),"output");
    await mkdir(path.dirname(outputPath),{recursive:true});
    hostReadInvoked=true;
    hostResult=await host.read("capture_program_frame",{...args,outputPath}) as Record<string, any>;
    if(hostResult.status!=="pass" || hostResult.exportAccepted!==true) throw Error("PROGRAM_FRAME_EXPORT_FAILED");
    if((await stat(outputPath)).size>12*1024*1024)throw Error("PROGRAM_FRAME_EXCEEDS_12_MIB");
    png=await probePngEvidence(outputPath);
    if(png.status!=="pass" || png.width!==hostResult.frame.width || png.height!==hostResult.frame.height || png.sha256!==hostResult.frame.finalizedSha256)throw Error("PROGRAM_FRAME_IMAGE_VERIFICATION_FAILED");
    const bytes=await readFile(outputPath);
    if(createHash("sha256").update(bytes).digest("hex")!==png.sha256)throw Error("PROGRAM_FRAME_CHANGED_DURING_READ");
    const receipt: Record<string, any> = {...hostResult,status:"pass",frame:{...hostResult.frame,...png},errors:[]};
    return { receipt, bytes };
  }catch(error){
    const transport=transportFailure(error);
    const message=error instanceof Error?error.message:String(error);
    const details=(error as {details?:Record<string,unknown>}|null)?.details;
    const exportConfirmed=typeof hostResult?.exportAccepted==='boolean';
    const rejectedBeforeExport=!hostReadInvoked||transport?.dispatchState==='not_sent'||isHostNotConnectedBeforeDispatch(message)
      ||details?.contentDispatched===false||hostResult?.contentDispatched===false||hostResult?.hostResult?.contentDispatched===false;
    const nativeExportDispatch=exportConfirmed?'confirmed':rejectedBeforeExport?'not_dispatched':'unknown';
    const status=hostResult?.status==='unverified'||nativeExportDispatch!=='not_dispatched'&&hostResult?.exportAccepted!==false?'unverified':'fail';
    // The direct wrapper owns this invocation's observation. Preserve the
    // exact exception (including code/details/transport) for all shared users,
    // even if a host reuses the same Error across concurrent capture calls.
    try { observeFailure?.({status,capture:{hostReadInvoked,nativeExportDispatch,
      ...(outputPath===undefined?{}:{outputPath}),...(hostResult===undefined?{}:{hostResult}),
      ...(png===undefined?{}:{artifactEvidence:png}),...(transport===undefined?{}:{transport})}}); }
    catch { /* Observation must not replace the capture error. */ }
    throw error;
  }
}

/** Return the composited sequence image directly to vision-capable MCP clients. */
export function registerProgramFrameTool(server: McpServer, host: HostExecutor, paths: PathPolicy): void {
  server.registerTool("capture_program_frame", {
    description: "Read a full-resolution composited Program Monitor frame as an MCP image. Pins exact project/sequence, moves to the nearest frame while preserving clip selection and reveals the Program Monitor. Rounding is half-up after Premiere converts seconds to host ticks; avoid fractional half-frame boundaries. Request frame starts N*timebase/254016000000 and verify returned frameIndex/ticks. Sequence end is exclusive. With automatic work follow (panel default) the playhead stays on the captured frame; pass restorePlayhead:true to return it, unless the user navigates during capture. Returns actual ticks, dimensions and SHA-256. Unknown execution, timeouts or post-export image mismatches remain UNVERIFIED with capture outputPath and available proof; do not retry an unknown capture. Uses the composited export route; caption pixel inclusion still needs visual verification; no desktop screenshot or external image model. This is a visual observation, not an Object Mask seed receipt.",
    inputSchema: { expectedProjectId:z.string().min(1), expectedSequenceId:z.string().min(1), expectedSequenceName:z.string().min(1), timeSeconds:z.number().finite().nonnegative(), restorePlayhead:z.boolean().optional() },
    annotations: { readOnlyHint:false, destructiveHint:false },
  }, async args => {
    let observedFailure:ProgramFrameCaptureFailure|undefined;
    try {
      const {receipt,bytes}=await captureProgramFrameEvidence(host,paths,args,evidence=>{observedFailure=evidence;});
      return {...result(receipt),content:[...result(receipt).content,{type:"image" as const,mimeType:"image/png",data:bytes.toString("base64")}]};
    }catch(error){
      if(!observedFailure)return failure(error);
      const {capture,status}=observedFailure;
      return {...result({status,capture,errors:[error instanceof Error?error.message:String(error)],retryable:false,
        errorClassification:status==='unverified'?'postcondition':capture.nativeExportDispatch==='not_dispatched'?'preflight':'postcondition',
        ...(capture.nativeExportDispatch==='confirmed'?{contentDispatched:true}:capture.nativeExportDispatch==='not_dispatched'&&status!=='unverified'?{contentDispatched:false}:{}),
        possiblyChangedFiles:capture.outputPath&&capture.nativeExportDispatch!=='not_dispatched'?[capture.outputPath]:[],
        recovery:status==='unverified'?'Do not retry this unknown capture. Inspect active execution and the reported output path before any new capture; file existence alone does not prove the requested frame.':'Inspect the reported rejection before making another capture request.'}),isError:true};
    }
  });
}
