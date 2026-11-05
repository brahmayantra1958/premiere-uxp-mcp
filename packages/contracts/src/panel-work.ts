export type NativeWorkPanel = "effect_controls" | "properties" | "project" | "program_monitor" | "source_monitor";
export type NativeVisualFeature = "inspect" | "selection_tool" | "razor_tool" | "object_selection_tool";
const nativeToolNames:Record<Exclude<NativeVisualFeature,"inspect">,readonly string[]>={
  selection_tool:["선택 도구","Selection Tool"],
  razor_tool:["자르기 도구","Razor Tool"],
  object_selection_tool:["Tools.ObjectSelectionLasso_18","오브젝트 마스크 도구","Object Mask Tool"],
};
/** SDK acceptance and a same-process, single selected native tool are separate facts. */
export function nativeToolStateProves(feature:NativeVisualFeature|undefined,observation:unknown,premierePid:unknown):boolean {
  if(!feature||feature==="inspect"||!observation||typeof observation!=="object"||!Number.isSafeInteger(premierePid)||Number(premierePid)<=0)return false;
  const value=observation as Record<string,unknown>;
  if(value.protocol!==1||value.status!=="pass"||value.route!=="windows_msaa_tool_state"||value.panel!=="Tools"||value.premierePid!==premierePid||!Array.isArray(value.selectedTools)||value.selectedTools.length!==1)return false;
  const tool=value.selectedTools[0];
  return !!tool&&typeof tool==="object"&&tool.role===43&&Number.isInteger(tool.state)&&(tool.state&8)!==0&&(tool.state&(1|32768|65536))===0&&nativeToolNames[feature].includes(tool.name);
}
/** Select a native feature solely from the authenticated parent command. */
export function nativeVisualFeatureForCommand(command:string,args:Record<string,unknown>):NativeVisualFeature|undefined {
  if(command==="inspect_native_visual_commands")return "inspect";
  if(command!=="activate_native_tool")return undefined;
  return args.tool==="selection"?"selection_tool":args.tool==="razor"?"razor_tool":args.tool==="object_selection"?"object_selection_tool":undefined;
}
export type NativeProjectItemTarget = { pathSegments: string[]; kind: "clip" | "sequence" | "folder"; mediaPath?: string; sequenceId?: string };
const projectEdits = ["rename_project_items", "move_project_items", "set_project_item_labels", "attach_proxy", "create_subclip", "import_clip_speech_text", "inspect_clip_speech_text"];
export function followsProjectItem(command: string): boolean {
  return command === "query_media" || projectEdits.includes(command);
}
/** A page/batch follows its first actual item; an empty result has no target. */
export function projectWorkItemId(command: string, args: Record<string, any>, result?: Record<string, any>): string | undefined {
  if (command === "query_media" && !args.ids?.length && !args.nameContains?.trim() && !args.binId) return undefined;
  const value = command === "query_media" ? result?.items?.[0]?.id
    : command === "rename_project_items" ? args.renames?.[0]?.projectItemId
    : command === "move_project_items" ? args.projectItemIds?.[0]
    : command === "set_project_item_labels" ? args.labels?.[0]?.projectItemId
    : projectEdits.includes(command) ? args.projectItemId : undefined;
  return typeof value === "string" && value.length ? value : undefined;
}
/** Fixed feature routes, never a caller-supplied native command ID. */
export function nativePanelForCommand(command: string,args:Record<string,any>={}): NativeWorkPanel | undefined {
  if(command==="inspect_effects"||command==="query_timeline"&&args.includeEffects===true)return "effect_controls";
  if(command==="get_effect_values"||command==="set_effect_disclosure")return "effect_controls";
  if (command === "track_object_mask_frames"||command === "inspect_native_masks") return "effect_controls";
  if (["apply_video_effect","apply_audio_effect","remove_effect","set_effect_values","set_effect_keyframes","edit_effect_keyframes","set_transform","scale_clip_to_fill","set_audio_level","set_basic_grade","apply_color_adjustments"].includes(command)) return "effect_controls";
  if (["insert_mogrt_caption","insert_editable_graphic"].includes(command)) return "properties";
  if (command === "capture_program_frame") return "program_monitor";
  if (followsProjectItem(command)) return "project";
  return undefined;
}
