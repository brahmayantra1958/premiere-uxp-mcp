/** A read-only saved-native request scoped to the exact clip already owned by
 * an effect command. No path, script, native command ID or write is accepted. */
export type EffectChainProofWork = {
  projectId:string;sequenceId:string;sequenceName:string;trackItemId:string;
  projectItemId:string;clipName:string;mediaType:'video'|'audio';trackIndex:number;
  startTicks:string;endTicks:string;componentMatchNames:string[];
  components:Array<{componentIndex:number;componentMatchName:string;parameterNames:string[]}>;
};
export const effectChainProofCommands = [
  'get_effect_values','set_effect_disclosure','apply_video_effect','apply_audio_effect',
  'remove_effect','set_effect_values','set_effect_keyframes','edit_effect_keyframes',
  'set_transform','scale_clip_to_fill','set_audio_level','set_basic_grade','apply_color_adjustments',
] as const;

export function effectChainProofScopeMatches(command:string,args:Record<string,any>,work:EffectChainProofWork):boolean {
  if(!(effectChainProofCommands as readonly string[]).includes(command))return false;
  return work.projectId===args.expectedProjectId&&work.sequenceId===args.expectedSequenceId
    &&work.sequenceName===args.expectedSequenceName&&work.trackItemId===args.trackItemId
    &&work.projectItemId===args.expectedProjectItemId&&work.mediaType===args.expectedMediaType
    &&work.trackIndex===args.expectedTrackIndex&&(!args.expectedClipName||work.clipName===args.expectedClipName)
    &&work.trackItemId===`${work.mediaType}:${work.trackIndex}:${work.startTicks}:${work.projectItemId}`
    &&Number.isFinite(args.expectedStartSeconds)&&Number.isFinite(args.expectedEndSeconds)
    &&Math.abs(Number(work.startTicks)/254016000000-args.expectedStartSeconds)<1e-7
    &&Math.abs(Number(work.endTicks)/254016000000-args.expectedEndSeconds)<1e-7;
}
