import { z } from "zod/v4";
import {mkdir} from 'node:fs/promises';
import path from 'node:path';
import { targetInputs } from './target-inputs.js';
import { inspectCaptionHelperInstallation } from './cep-caption-helper.js';
import { parsePremiereTranscriptJson } from "./premiere-transcript.js";
import { detectPremiereProcess } from "./system.js";
import { operationId, seconds } from "./tool-inputs.js";
import { result, failure, writePathForRole } from "./tool-values.js";
import { transportFailure } from "./bridge-transport.js";
import { isHostNotConnectedBeforeDispatch } from "./host-dispatch-rejection.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HostBridge } from "./bridge-port.js";
import type { HostExecutor } from "./host-executor.js";
import type { PathPolicy } from "./path-policy.js";
import type { SegmentationEnginePort } from "./segmentation-engine.js";

export function registerInspectionTools(server: McpServer, bridge: HostBridge, host: HostExecutor, paths: PathPolicy, segmentation: SegmentationEnginePort): void {
  server.registerTool('inspect_caption_helper',{
    description:'Read installed caption CEP manifest version and running heartbeat separately, without starting CEP or touching Premiere. Returns exact installation procedure.',
    inputSchema:{},annotations:{readOnlyHint:true},
  },async()=>{try{return result(await inspectCaptionHelperInstallation());}catch(e){return failure(e);}});
  server.registerTool("premiere_ping", {
    description: "Read bridge state and, when connected, the real UXP deployment. After connection/update/Reload compare panelVersion, panelMode and localScratchRoot with the intended installation; a source build or ready transport alone is not deployment proof. Does not edit, reload or restart. For missing/mismatched deployment read premiere://guide/operator-runbook, check active jobs before recovery, and never replay an uncertain edit.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, async () => {
    const bridgeStatus = await bridge.getStatus();
    if (!bridgeStatus.connected) {
      const processState = await detectPremiereProcess();
      const connectionState = processState === "running" ? "uxp_panel_not_connected" : processState === "not_running" ? "premiere_not_running" : "host_state_unknown";
      return result({ status: "partial", bridge: bridgeStatus, premiere: null, processState, connectionState, reason: connectionState === "premiere_not_running" ? "Premiere is not running" : connectionState === "uxp_panel_not_connected" ? "Premiere is running but the UXP panel is not connected" : "UXP panel is not connected and the Premiere process state is unavailable" });
    }
    try { return result({ status: "pass", bridge: bridgeStatus, premiere: await host.read("premiere_ping") }); }
    catch (error) { return failure(error); }
  });

  const readTools: Array<[string, string]> = [
    ["get_capabilities", "Read the Premiere and UXP versions and the public API capabilities available in the live host."],
    ["inspect_project", "Read the active project, active sequence, project items, tracks, clips, and link state without editing content."],
    ["inspect_sequence", "Read the active sequence settings, tracks, and clip timings."],
    ["inspect_media", "Read project panel media and bins without recursively scanning source folders."],
    ["inspect_proxies", "Read offline and proxy attachment state for project media."],
    ["inspect_markers", "Read active-sequence markers."],
    ["inspect_effects", "Read component and parameter state for timeline clips."],
    ["inspect_effect_catalog", "List installed public-UXP video effects, audio effects, and video transition match names."],
    ["inspect_timeline_selection", "Read the exact timeline-item IDs currently selected in Premiere without changing the selection."],
    ["inspect_object_mask_state", "Read whether the active project or sequence contains a native Premiere Object Mask."],
    ["inspect_premiere_feature_routes", "Discover live public UXP routes, Adobe built-in UXP command entrypoints, and bounded native-command bridge candidates for existing Premiere features."],
    ["inspect_delivery_state", "Read active-sequence dimensions, frame rate, duration, and track state for delivery planning."],
  ];

  const contextual = new Set(["inspect_project", "inspect_sequence", "inspect_media", "inspect_proxies", "inspect_markers", "inspect_effects", "inspect_timeline_selection", "inspect_object_mask_state", "inspect_delivery_state"]);
  for (const [name, description] of readTools) {
    server.registerTool(name, { description: description + (contextual.has(name) ? " Exact current project/sequence IDs required. An inactive target is refused; navigation and selection are preserved." : ""),
      inputSchema: contextual.has(name) ? targetInputs : {}, annotations: { readOnlyHint: true, destructiveHint: false } }, async (args) => {
      try { return result(await host.read(name, args)); } catch (error) { return failure(error); }
    });
  }

  server.registerTool("inspect_clip_speech_text", {
    description: "Inspect Premiere's existing public Transcript state for one exact non-sequence project clip. Content is omitted by default; the response always includes a validated summary, byte size, and SHA-256 when speech text exists.",
    inputSchema: { ...targetInputs,
      projectItemId: z.string().min(1),
      includeContent: z.boolean().default(false),
    },
    annotations: { readOnlyHint: true },
  }, async ({ projectItemId, includeContent , ...targetPins }) => {
    try {
      const value = await host.read("inspect_clip_speech_text", { ...targetPins, projectItemId }) as Record<string, unknown>;
      const { transcriptJson, ...hostState } = value;
      if (hostState.hasSpeechText !== true) return result(hostState);
      if (typeof transcriptJson !== "string") throw new Error("PREMIERE_SPEECH_TEXT_READBACK_MISSING");
      const document = parsePremiereTranscriptJson(transcriptJson);
      return result({
        ...hostState,
        speechText: {
          ...document.summary,
          sha256: document.sha256,
          sizeBytes: document.sizeBytes,
          ...(includeContent ? { content: document.transcript } : {}),
        },
      });
    } catch (error) { return failure(error); }
  });

  server.registerTool("inspect_segmentation_engine", {
    description: "Read the authenticated local object-segmentation engine, exact model checkpoint, device, and image/video capabilities without starting a process.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, async () => result(await segmentation.inspect()));

  server.registerTool("export_review_frames", {
    description: "Export PNG review stills using the same seek-and-finalize route as capture_program_frame, leaving the playhead on the last captured frame by default. Request frame starts N*timebase/254016000000; rounding is nearest/half-up on host ticks, so avoid fractional half-frame boundaries and verify each returned frameIndex. Sequence end is exclusive. Use restorePlayhead:true only when returning to the prior position is requested. Exact project/sequence required. On interruption, retains completed changedFiles and frame proofs, identifies failedFrame and unexecutedFrames, and keeps unknown execution or timeouts UNVERIFIED without automatic retry. Caption pixel presence needs visual verification; file existence is not caption proof. No project save.",
    inputSchema: { expectedProjectId:z.string().min(1),expectedSequenceId:z.string().min(1),expectedSequenceName:z.string().min(1),restorePlayhead:z.boolean().default(false),timesSeconds: z.array(seconds).min(1).max(30), outputPaths: z.array(z.string().min(1)).min(1).max(30), operationId },
    annotations: { readOnlyHint: false, destructiveHint: false },
  }, async ({ timesSeconds, outputPaths, operationId: id, ...target }) => {
    try {
      if (timesSeconds.length !== outputPaths.length) throw new Error("timesSeconds and outputPaths must have the same length");
      if (new Set(outputPaths.map((value) => value.toLocaleLowerCase("en-US"))).size !== outputPaths.length) throw new Error("outputPaths must be unique to prevent frame overwrite");
      const authorized = outputPaths.map((value) => writePathForRole(paths, value, "output"));
      if(authorized.some(p=>!/\.png$/i.test(p)))throw Error('REVIEW_FRAMES_REQUIRE_PNG');
      return result(await host.mutateLocal("export_review_frames", {...target,timesSeconds,outputPaths:authorized},async()=>{
        const frames:Record<string,any>[]=[];
        const changedFiles:string[]=[];
        const requestedFrames=timesSeconds.map((timeSeconds,index)=>({index,timeSeconds,outputPath:authorized[index]!}));
        let currentIndex=0,hostReadsInvoked=0;
        let frame:Record<string,any>|undefined,fileFinalized=false,hostReadInvoked=false;
        try {
          for(;currentIndex<requestedFrames.length;currentIndex++) {
            frame=undefined;fileFinalized=false;hostReadInvoked=false;
            const requested=requestedFrames[currentIndex]!;
            // Premiere can accept an export to a missing directory without
            // producing a PNG. Prepare only the authorized output parent,
            // before dispatch, rather than waiting for an impossible file.
            await mkdir(path.dirname(requested.outputPath),{recursive:true});
            hostReadsInvoked++;hostReadInvoked=true;
            frame=await host.read('capture_program_frame',{...target,timeSeconds:requested.timeSeconds,outputPath:requested.outputPath}) as Record<string,any>;
            frames.push(frame);
            if(frame.status!=='pass'||!frame.frame?.finalizedSha256)throw Error('REVIEW_FRAME_UNVERIFIED');
            fileFinalized=true;
            changedFiles.push(requested.outputPath);
            if(frame.navigation?.restoreSkipped)throw Error('REVIEW_CAPTURE_USER_NAVIGATION_CHANGED');
          }
          return {status:'pass',result:{frames,captionPixelsVerified:false,projectSaved:false},changedFiles};
        }catch(error){
          const message=error instanceof Error?error.message:String(error);
          const transport=transportFailure(error);
          const details=(error as {details?:Record<string,unknown>}|null)?.details;
          // Invoking host.read is not proof that the native exporter ran. Only
          // explicit transport/host evidence can establish no dispatch; an
          // unclassified exception or finalization timeout remains unknown.
          const rejectedBeforeExport=!hostReadInvoked||transport?.dispatchState==='not_sent'||isHostNotConnectedBeforeDispatch(message)
            ||details?.contentDispatched===false||frame?.contentDispatched===false||frame?.hostResult?.contentDispatched===false;
          const exportConfirmed=fileFinalized||typeof frame?.exportAccepted==='boolean';
          const nativeExportDispatch=exportConfirmed?'confirmed':rejectedBeforeExport?'not_dispatched':'unknown';
          const status=frame?.status==='unverified'||!fileFinalized&&!rejectedBeforeExport&&frame?.exportAccepted!==false?'unverified':'fail';
          const failedFrame={...requestedFrames[currentIndex]!,status,hostReadInvoked,nativeExportDispatch,fileFinalized,
            ...(transport?{transport}:{}),errors:[message]};
          return {status,result:{frames,failedFrame,hostReadsInvoked,
            unexecutedFrames:requestedFrames.slice(currentIndex+1).map(requested=>({...requested,status:'not_started',hostReadInvoked:false})),
            possiblyChangedFiles:!fileFinalized&&nativeExportDispatch!=='not_dispatched'?[failedFrame.outputPath]:[],
            ...(changedFiles.length||exportConfirmed?{contentDispatched:true}:nativeExportDispatch==='not_dispatched'&&status!=='unverified'?{contentDispatched:false}:{}),
            captionPixelsVerified:false,projectSaved:false},changedFiles,errors:[message]};
        }
      },id));
    } catch (error) { return failure(error); }
  });
}
