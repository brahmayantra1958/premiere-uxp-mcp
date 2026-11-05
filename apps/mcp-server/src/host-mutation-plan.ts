import {randomUUID} from 'node:crypto';
import {projectSnapshotSchema,type EditPlan} from '@premiere-uxp/contracts';
import {z} from 'zod/v4';
import type {AuditLog} from './audit.js';
import {exactEffectTarget} from './tool-inputs.js';
import {HOST_PLANNED_EFFECTS} from './host-command-policy.js';
import {createMutationPlan} from './mutation-plan.js';

type HostRead=(command:string,args:Record<string,unknown>)=>Promise<unknown>;
const effectTargetSchema=z.object(exactEffectTarget);

/** Planning adapter: navigation-producing snapshot reads receive exact identity
 * guards. Host-planned effects/save/navigation retain their narrow preflight.
 * Audit order and failure occur before the executor marks anything dispatched. */
export async function prepareHostMutation(command:string,args:Record<string,unknown>,commandId:string,lifecycleWithoutActiveProject:boolean|undefined,read:HostRead,audit:AuditLog):Promise<EditPlan|undefined>{
  let plan:EditPlan|undefined;
  if (lifecycleWithoutActiveProject) {
    if (command !== "close_working_project" && command !== "open_working_project") {
      throw new Error(`UNSUPPORTED_LIFECYCLE_COMMAND: ${command}`);
    }
    await audit.append({
      kind: "lifecycle-plan",
      commandId,
      command,
      args,
      preconditions: ["Exact saved local project path", "Exact sequence name and UID"],
      createdAt: new Date().toISOString(),
    });
  } else if (command === 'trim_clip_exact') {
    if(!args.expectedProjectId||!args.expectedSequenceId||!args.expectedSequenceName||!args.trim||typeof args.trim!=='object'||!('trackItemId' in args.trim)||!args.trim.trackItemId)throw Error('EXACT_TRIM_TARGET_REQUIRED');
    // trimClipExact validates its complete timeline and exact source bounds
    // inside the owned host queue, then verifies transitions/components and
    // rollback. The generic project/effect snapshot was not used by its plan,
    // recovery or postconditions and could exceed the wire budget by itself.
    await audit.append({kind:'host-preflight-plan',commandId,command,args,preconditions:['Exact project, sequence name/ID and clip/source range checked under the host queue','Complete timeline, transition and component/keyframe preservation readback; verified rollback on failed proof'],createdAt:new Date().toISOString()});
  } else if (['import_media','place_clips','split_clips','ripple_timeline','finalize_caption_import','set_track_locks'].includes(command)) {
    if(!args.expectedProjectId || (command!=='import_media' && !args.expectedSequenceId))throw Error('EXACT_EDIT_TARGET_REQUIRED');
    await audit.append({kind:'host-preflight-plan',commandId,command,args,preconditions:['Current exact project/sequence identity; source items and requested placement ranges only','Host result readback; unrelated user edits and navigation are not a baseline'],createdAt:new Date().toISOString()});
  } else if (['clone_clips','remove_clips','insert_mogrt_caption'].includes(command)) {
    if(!args.expectedProjectId||!args.expectedSequenceId)throw Error('EXACT_EDIT_TARGET_REQUIRED');
    // These handlers capture their own complete before state under the owned
    // host queue and verify native readback. Neither server recovery nor
    // postconditions use the generic full-project/effect planning snapshot.
    // Move/transition/rectangle paths still need their server-side baselines.
    await audit.append({kind:'host-preflight-plan',commandId,command,args,preconditions:['Exact project/sequence, source clips or MOGRT hash, destination and bounds checked under host queue','Complete native before/after readback and preservation checks remain mandatory'],createdAt:new Date().toISOString()});
  } else if (command === "save_working_project") {
    // Public saves carry only operationId. A planning inspect_project would
    // retarget V1/time zero after an audio edit even though saving has no work
    // location. The host still checks its working-project scope and any pins.
    await audit.append({kind:"host-preflight-plan",commandId,command,args,preconditions:["Working project scope and supplied identity pins are checked by the host before save", "Save preserves the current playhead and selection; no timeline planning read"],createdAt:new Date().toISOString()});
  } else if (command === "activate_native_tool") {
    // Navigation/UI changes do not need a full project/effect snapshot. The
    // owned UXP queue checks exact identity, resolves the clip and reveals it.
    if(!args.expectedProjectId||!args.expectedSequenceId||!args.expectedSequenceName||!Array.isArray(args.trackItemIds)||args.trackItemIds.length!==1)throw Error("EXACT_NATIVE_TOOL_TARGET_REQUIRED");
    await audit.append({kind:"host-preflight-plan",commandId,command,args,preconditions:["Exact working project/sequence and one clip resolved under host queue", "SDK dispatch alone cannot prove toolbar state"],createdAt:new Date().toISOString()});
  } else if (HOST_PLANNED_EFFECTS.has(command)||command==="set_effect_disclosure"||command==="track_object_mask_frames"||command==="inspect_native_masks") {
    const target = effectTargetSchema.parse(args);
    await audit.append({ kind: "host-preflight-plan", commandId, command, target,
      preconditions: ["Exact project/sequence/source/track/bounds checked before action", "All requested parameters preflighted in host command", "Host before/after evidence required"], createdAt: new Date().toISOString() });
  } else {
    plan = await planHostMutation(command,args,read);
    await audit.append({ kind: "plan", commandId, plan, createdAt: new Date().toISOString() });
  }
  return plan;
}

/** The sole full-snapshot planning path. Random IDs and host reads stay outside
 * createMutationPlan's deterministic projection. No edit is sent here. */
async function planHostMutation(command:string,args:Record<string,unknown>,read:HostRead){
  const pin=Object.fromEntries(['expectedProjectId','expectedSequenceId','expectedSequenceName'].filter(key=>args[key]!==undefined).map(key=>[key,args[key]]));
  const snapshot=projectSnapshotSchema.parse(await read('inspect_project',pin));
  return createMutationPlan(snapshot,command,args,randomUUID());
}
