import {mutationContext,ppro} from './host-context.js';
import {text,type AnyRecord} from './host-foundation.js';

/** Finalize only the newly observed caption track. Keep its native owner pinned
 * through async mute/readback so a user sequence switch cannot retarget a write. */
export async function finalizeCaptionImport(args:AnyRecord,execute:(project:any,label:string,actions:()=>any[])=>boolean) {
  let dispatched=false;
  try {
    const {project,sequence}=await mutationContext(args);
    const index=Number(args.trackIndex),count=Number(await sequence.getCaptionTrackCount());
    if(!Number.isInteger(index)||index<0||index>=count)throw Error('CAPTION_TRACK_NOT_FOUND');
    const track=await sequence.getCaptionTrack(index),items=await track.getTrackItems(ppro.Constants.TrackItemType.CLIP,false);
    if(String(track.id)!==String(args.expectedTrackId)||text(track.name)!==args.expectedTrackName||items.length!==args.expectedItemCount||Boolean(await track.isMuted())!==args.expectedMuted)throw Error('CAPTION_TRACK_GUARD_MISMATCH');
    if(typeof track.createSetNameAction!=='function'||typeof track.setMute!=='function')throw Error('CAPTION_TRACK_STATE_UNSUPPORTED');
    dispatched=true;
    if(!execute(project,'Name imported caption track',()=>[track.createSetNameAction(args.name)]))throw Error('CAPTION_RENAME_UNVERIFIED');
    // Never look up the active sequence again after dispatch.
    if(!await track.setMute(args.muted))throw Error('CAPTION_MUTE_UNVERIFIED');
    const actual=await sequence.getCaptionTrack(index);
    const after={id:String(actual.id),index,name:text(actual.name),muted:Boolean(await actual.isMuted()),itemCount:(await actual.getTrackItems(ppro.Constants.TrackItemType.CLIP,false)).length};
    if(after.id!==String(args.expectedTrackId)||after.name!==args.name||after.muted!==args.muted||after.itemCount!==args.expectedItemCount)throw Error('CAPTION_TRACK_READBACK_MISMATCH');
    return {status:'pass',after,hostResult:{contentDispatched:true,projectSaved:false},errors:[]};
  }catch(e){return {status:dispatched?'unverified':'fail',hostResult:{contentDispatched:dispatched,projectSaved:false},errors:[String(e)]};}
}
