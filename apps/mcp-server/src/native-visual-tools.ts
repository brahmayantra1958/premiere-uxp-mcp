import type {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {z} from "zod/v4";
import type {HostExecutor} from "./host-executor.js";
import {operationId,exactEffectTarget} from "./tool-inputs.js";
import {result} from "./tool-values.js";

export function registerNativeVisualTools(server:McpServer,host:HostExecutor,editing:boolean):void {
  server.registerTool("inspect_native_visual_commands",{
    description:"Read relevant commands and their contexts from Premiere's running Adobe Control Surface SDK plugin. Requires the separately installed Native Visual adapter. Registry presence is not proof that a command is enabled or that a visual/mask operation succeeded.",
    inputSchema:{},annotations:{readOnlyHint:true,destructiveHint:false},
  },async()=>result(await host.read("inspect_native_visual_commands")));
  if(!editing)return;
  server.registerTool("inspect_native_masks",{
    description:"Reveal the exact video clip, save the designated local project, and inspect its native SelectionComponents masks, including names, native type, parameter metadata and tracker hashes. Use this before track_object_mask_frames. It does not create, delete or track masks; saving persists current project edits. Native Type 4 identifies Object Mask on the verified Premiere 26.5 layout.",
    inputSchema:{...exactEffectTarget,expectedClipName:z.string().min(1),expectedMediaType:z.literal("video"),operationId},annotations:{readOnlyHint:false,destructiveHint:false},
  },async({operationId:id,...args})=>result(await host.mutate("inspect_native_masks",args,id)));
  server.registerTool("track_object_mask_frames",{
    description:"Track an existing native Object Mask by 1–30 frames in one owned command. Reveals/selects the exact video clip at timeSeconds and invokes native semantic tracking without mouse or keys. Currently requires exactly one native Object Mask on a forward 1x clip. Saves the designated local project before/after to verify native tracker bytes, every one-frame playhead advance, and unchanged normal clip/effect state. Never retries a dispatched step; inspect UNVERIFIED results before another command.",
    inputSchema:{...exactEffectTarget,expectedClipName:z.string().min(1),expectedMediaType:z.literal("video"),timeSeconds:z.number().finite().nonnegative(),maskName:z.string().min(1).max(100),direction:z.enum(["forward","backward"]),frames:z.number().int().min(1).max(30),operationId},
    annotations:{readOnlyHint:false,destructiveHint:false},
  },async({operationId:id,...args})=>result(await host.mutate("track_object_mask_frames",args,id,{timeoutMs:240000})));
  server.registerTool("activate_native_tool",{
    description:"Reveal the exact working sequence, move to the selected clip and activate Premiere's Selection, Razor or Object Mask tool through the native SDK. Never clicks or sends keys. PASS requires independent native Tools-pane selection readback. Missing or different state is UNVERIFIED; Object Mask tool activation does not create a mask.",
    inputSchema:{expectedProjectId:z.string().min(1),expectedSequenceId:z.string().min(1),expectedSequenceName:z.string().min(1),trackItemIds:z.array(z.string().min(1)).min(1).max(1),tool:z.enum(["selection","razor","object_selection"]),operationId},
    annotations:{readOnlyHint:false,destructiveHint:false},
  },async({operationId:id,...args})=>result(await host.mutate("activate_native_tool",args,id)));
}
