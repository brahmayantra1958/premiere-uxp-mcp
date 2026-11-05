import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { HostBridge } from "./bridge-port.js";
import type { HostExecutor } from "./host-executor.js";
import type { PathPolicy } from "./path-policy.js";
import type { SegmentationEnginePort } from "./segmentation-engine.js";
import { enabledProfiles } from "./config.js";
import { registerAgentTools } from "./agent-tools.js";
import { registerInspectionTools } from "./inspection-tools.js";
import { registerMaskCaptureTool, registerMaskPromptTool, registerSegmentationTool } from "./mask-tools.js";
import { registerProjectLifecycleTools, registerSpeechTools, registerProjectStructureTools, registerProjectMediaTools } from "./project-edit-tools.js";
import { registerPlacementTools, registerTimelineEditTools } from "./timeline-edit-tools.js";
import { registerTrackSequenceTools } from "./track-sequence-tools.js";
import {registerCaptionReadTools} from "./caption-read-tools.js";
import {registerCaptionNativeStyleTools} from './caption-native-style-tools.js';
import { registerCaptionTool } from "./caption-tools.js";
import { registerGraphicsTools } from "./graphics-tools.js";
import { registerEffectTools, registerEffectReadTools } from "./effect-tools.js";
import { registerDeliveryTools } from "./delivery-tools.js";
import { registerProgramFrameTool } from "./program-frame-tools.js";
import {registerNativeVisualTools} from "./native-visual-tools.js";
import {eventQuerySchema} from './runtime-events.js';
import {result,failure} from './tool-values.js';
import {z} from 'zod/v4';
import {registerRipplePreparation,registerRippleEdit} from './ripple-tools.js';
import { registerTrackLockTools } from './track-lock-tools.js';

/** Profile composition only; individual command contracts live with their domain. */
export function registerTools(server: McpServer, bridge: HostBridge, host: HostExecutor, paths: PathPolicy, segmentation: SegmentationEnginePort): void {
  if(enabledProfiles.has('edit'))server.registerTool('archive_inactive_operation',{
    description:'Retire one inactive uncertain operation so new work can proceed during collaborative editing. Checks only the owner, live command ledger and host/job queue. Archives the lease, preserves the original UNVERIFIED receipt and current user content, and never replays, restores or verifies old timeline state. Active/queued commands cannot be retired.',
    inputSchema:{operationId:z.string().min(1).max(200)},annotations:{readOnlyHint:false,destructiveHint:false}},
    async args=>{try{return result(await host.archiveInactiveMutation(args.operationId));}catch(e){return failure(e);}});
  server.registerTool('get_mutation_recovery',{description:'Inspect a durable uncertain-operation quarantine and the current panel execution ledger. No replay or content edit. Active operations cannot be superseded. Inactive uncertain operations may be archived with archive_inactive_operation; the original receipt stays unchanged.',inputSchema:{},annotations:{readOnlyHint:true}},async()=>{try{return result(await host.inspectMutationRecovery());}catch(e){return failure(e);}});
  if(enabledProfiles.has('edit'))server.registerTool('reconcile_mutation',{description:'Verify the exact quarantined operation without replaying it. Requires terminal host execution evidence and current target/postconditions; unknown evidence keeps the block. Typed archive workflows may only reveal/save the existing target or reopen a proven closed file. Never patches content or restores a backup. Original receipts stay unchanged.',inputSchema:{operationId:z.string().min(1).max(200)},annotations:{readOnlyHint:false,destructiveHint:false}},async args=>{try{return result(await host.reconcileMutation(args.operationId));}catch(e){return failure(e);}});
  server.registerTool('wait_runtime_events',{description:'Wait up to 30 seconds for bounded command/job changes in the shared runtime. No Premiere scan/navigation. Reuse sessionId and nextRevision; overflow/resetRequired requires fresh state. Events never replace native terminal receipt proof.',inputSchema:eventQuerySchema,annotations:{readOnlyHint:true}},async args=>{
    try{if(!bridge.waitEvents)throw Error('Runtime event wait unavailable');return result(await bridge.waitEvents(args));}catch(error){return failure(error);}
  });
  registerAgentTools(server, host);
  registerTrackLockTools(server, host, enabledProfiles.has('edit'));
  registerRipplePreparation(server,host);
  registerCaptionReadTools(server,host,paths);
  registerCaptionNativeStyleTools(server,host,enabledProfiles.has('edit'));
  registerEffectReadTools(server,host);
  registerProgramFrameTool(server, host, paths);
  registerNativeVisualTools(server,host,enabledProfiles.has("edit"));
  registerTrackSequenceTools(server, host, enabledProfiles.has("edit"));
  registerInspectionTools(server, bridge, host, paths, segmentation);
  registerMaskCaptureTool(server, host, paths);
  registerMaskPromptTool(server, bridge, paths);
  registerSegmentationTool(server, paths, segmentation);
  if (enabledProfiles.has("edit")) {
    registerProjectLifecycleTools(server, host, paths);
    registerSpeechTools(server, host, paths);
    registerProjectStructureTools(server, host, paths);
    registerProjectMediaTools(server, host, paths);
    registerPlacementTools(server, host, paths);
    registerCaptionTool(server, host, paths);
    registerTimelineEditTools(server, host);
    registerRippleEdit(server,host);
    registerGraphicsTools(server, host, paths);
    registerEffectTools(server, host, paths);
  }
  if (enabledProfiles.has("delivery")) registerDeliveryTools(server, bridge, host, paths);
}
