/** A preflight error is safely no-write only until the first content dispatch. A later inner preflight must not erase earlier writes; recovery depends on this boundary, not the error name. */
import {HostCommandError} from './bridge-client.js';

// The UXP command queue serializes these scopes. Background track jobs use
// their own receipts and are deliberately excluded from this synchronous route.
const tracked=new Set(['create_bin','rename_project_items','move_project_items','set_project_item_labels',
  'set_track_state','set_timeline_item_state','clone_clips','place_on_new_layer','trim_clips',
  'create_working_copy','duplicate_working_sequence','create_subclip','create_sequence','attach_proxy',
  'import_media','place_clips','split_clips','trim_clip_exact','move_clips','move_clip_to_track','remove_clips','add_markers',
  'apply_video_effect','apply_audio_effect','remove_effect','set_effect_values','set_effect_keyframes',
  'edit_effect_keyframes','apply_color_adjustments','set_transform','set_basic_grade','set_audio_level',
  'scale_clip_to_fill','apply_transition','remove_transition','place_voiceover','place_music','save_working_project','export_frame','export_sequence']);
let phase:{dispatched:boolean}|undefined;

/** Call immediately before a content transaction or a native mutating API. */
export function markContentDispatched():void {if(phase)phase.dispatched=true;}
export function dispatchContent<T>(call:()=>T):T {markContentDispatched();return call();}

export async function withMutationPhase<T>(command:string,work:()=>Promise<T>):Promise<T>{
  if(!tracked.has(command))return work();
  if(phase)throw new HostCommandError('MUTATION_PHASE_BUSY','Another tracked host command is executing');
  const owned={dispatched:false};phase=owned;
  try {
    const value=await work();
    if(value&&typeof value==='object'&&!Array.isArray(value)&&(value as any).status!=='pass'){
      const result=value as any;
      if(!owned.dispatched&&result.status==='fail')return {...result,hostResult:{...(result.hostResult&&typeof result.hostResult==='object'?result.hostResult:{}),contentDispatched:false}};
      if(owned.dispatched&&result.hostResult?.contentDispatched===false)return {...result,hostResult:{...result.hostResult,contentDispatched:true}};
    }
    return value;
  }catch(error){
    const message=error instanceof Error?error.message:String(error);
    const code=error instanceof HostCommandError?error.code:message.match(/^([A-Z][A-Z_]+):/)?.[1]??'HOST_ERROR';
    if(!owned.dispatched)throw new HostCommandError(code,message,{contentDispatched:false,retryable:false,errorClassification:'preflight',...((error as any)?.details?.actualTarget?{actualTarget:(error as any).details.actualTarget}:{})});
    // An inner validator may run after an earlier write. Its local preflight
    // proof must not release the outer operation's uncertain receipt.
    throw new HostCommandError(code==='UNSUPPORTED_API'||code==='UNSUPPORTED_COMMAND'?'HOST_MUTATION_UNVERIFIED':code,message);
  }finally{phase=undefined;}
}
