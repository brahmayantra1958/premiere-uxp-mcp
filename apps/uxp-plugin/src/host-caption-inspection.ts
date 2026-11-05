import {mutationContext,sequenceId,ppro} from './host-context.js';
import {text,type AnyRecord} from './host-foundation.js';
import {collectRuntimeSurface} from './premiere-feature-routes.js';
import {componentSnapshot} from './host-components.js';

/** Exact sequence timebase before creating any caption track, including the first. */
export async function inspectCaptionImportCapabilities(args:AnyRecord) {
  const {project,sequence}=await mutationContext(args);
  const frameTicks=text(await sequence.getTimebase());
  if(!/^[1-9]\d*$/.test(frameTicks)||frameTicks.length>30)throw Error('CAPTION_IMPORT_TIMEBASE_UNVERIFIED');
  const id=await sequenceId(sequence);
  await mutationContext(args);
  return {exactTrackGuards:true,frameTicks,projectId:text(project.guid),sequenceId:id,projectSaved:false};
}

/** Live clocks/identity only. getName is an internal label, never caption text.
 * No save, selection, navigation or undocumented setter invocation. */
export async function inspectCaptionTrack(args:AnyRecord) {
  const {project,sequence}=await mutationContext(args);
  const count=Number(await sequence.getCaptionTrackCount()),index=Number(args.trackIndex);
  if(!Number.isInteger(index)||index<0||index>=count)throw Error('CAPTION_TRACK_NOT_FOUND');
  const track=await sequence.getCaptionTrack(index);
  if(args.expectedTrackId!==undefined&&String(track.id)!==String(args.expectedTrackId))throw Error('CAPTION_TRACK_ID_CHANGED');
  if(args.expectedTrackName!==undefined&&text(track.name)!==args.expectedTrackName)throw Error('CAPTION_TRACK_NAME_CHANGED');
  const raw=await track.getTrackItems(ppro.Constants.TrackItemType.CLIP,false);
  if(!Array.isArray(raw)||raw.length>10000)throw Error('CAPTION_COLLECTION_UNVERIFIED');
  const items:AnyRecord[]=[],errors:string[]=[];
  for(let i=0;i<raw.length;i++) {
    const start=await raw[i].getStartTime(),end=await raw[i].getEndTime();
    items.push({index:i,id:null,idStability:'public_item_identity_unavailable',startTicks:text(start.ticks),endTicks:text(end.ticks),text:null,
      ...(args.inspectSelection===true?{selected:Boolean(await raw[i].getIsSelected())}:{})});
  }
  let selection:AnyRecord|undefined;
  if(args.inspectSelection===true){
    // Sequence.getSelection omits captions in Premiere 26.5. Count their actual
    // native selection flags separately so a font edit never formats another cue.
    let selectedCaptions=items.filter(i=>i.selected).length,scanned=raw.length;
    for(let t=0;t<count;t++)if(t!==index){
      const other=await (await sequence.getCaptionTrack(t)).getTrackItems(ppro.Constants.TrackItemType.CLIP,false);
      scanned+=other.length;if(scanned>10000)throw Error('CAPTION_SELECTION_SCAN_LIMIT');
      for(const item of other)if(await item.getIsSelected())selectedCaptions++;
    }
    const av=await (await sequence.getSelection()).getTrackItems();
    selection={selectedCaptions,selectedOtherItems:av.length,scannedCaptions:scanned};
    await mutationContext(args);
  }
  let components:AnyRecord[]|null=null;
  if(args.inspectComponents===true&&raw.length&&typeof raw[0].getComponentChain==='function') {
    try{components=await componentSnapshot(raw[0]);}catch(e){errors.push(String(e));}
  }
  return {status:'partial',projectId:text(project.guid),projectPath:text(project.path),sequenceId:await sequenceId(sequence),sequenceName:text(sequence.name),
    frameTicks:text(await sequence.getTimebase()),captionTrackCount:count,
    track:{index,id:String(track.id),name:text(track.name),muted:Boolean(await track.isMuted()),itemCount:raw.length,format:null,style:null},items,...(selection?{selection}:{}),
    capabilities:{trackSurface:collectRuntimeSurface(track),itemSurface:collectRuntimeSurface(raw[0]),sampleComponents:components,
      liveTextRead:false,textWrite:false,styleRead:false,styleWrite:false,
      timingActions:raw.length?Object.fromEntries(['createMoveAction','createSetStartAction','createSetEndAction'].map(k=>[k,typeof raw[0][k]==='function'])):null},
    textSource:'unavailable_in_public_caption_api',contentDispatched:false,errors};
}
