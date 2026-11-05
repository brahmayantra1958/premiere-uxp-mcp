import {activeProject,activeSequence,sequenceId,ppro,mutationContext} from './host-context.js';
import {text,asTickTime,type AnyRecord} from './host-foundation.js';
import {queryTimelineEntries} from './host-items.js';
import {normalizeRippleBoundaries,planRippleGaps,type RippleItem} from './ripple-plan.js';

/** Read-only discovery for a bounded all-track ripple route. Never select,
 * insert, save, or infer caption editability from the existence of a track. */
export async function inspectRippleCapabilities(args:AnyRecord) {
  const project=await activeProject(),sequence=await activeSequence(project);
  if(text(project.guid)!==args.expectedProjectId||await sequenceId(sequence)!==args.expectedSequenceId)throw Error('RIPPLE_TARGET_CHANGED');
  const methods=['getStartTime','getEndTime','getName','getComponentChain','createMoveAction','createSetStartAction','createSetEndAction'];
  const captions:AnyRecord[]=[],errors:string[]=[];
  const count=Number(await sequence.getCaptionTrackCount());
  if(count>32)throw Error('RIPPLE_CAPTION_TRACK_LIMIT');
  for(let trackIndex=0;trackIndex<count;trackIndex++) {
    const track=await sequence.getCaptionTrack(trackIndex);
    const items=await track.getTrackItems(ppro.Constants.TrackItemType.CLIP,false);
    if(!Array.isArray(items)||items.length>1000)throw Error('RIPPLE_CAPTION_COLLECTION_UNVERIFIED');
    const samples:AnyRecord[]=[];
    for(let i=0;i<Math.min(items.length,3);i++) {
      const raw=items[i],available=Object.fromEntries(methods.map(key=>[key,typeof raw?.[key]==='function']));
      const sample:AnyRecord={index:i,methods:available};
      for(const [method,key] of [['getStartTime','start'],['getEndTime','end'],['getName','name']]) {
        if(!available[method!])continue;
        try{const value=await raw[method!]();sample[key!]=key==='name'?text(value):asTickTime(value);}
        catch(error){errors.push(`Caption ${trackIndex}/${i} ${method}: ${String(error)}`);}
      }
      samples.push(sample);
    }
    captions.push({trackIndex,id:track.id,name:text(track.name),itemCount:items.length,samples});
  }
  const editor=ppro.SequenceEditor.getEditor(sequence);
  return {status:'pass',projectId:text(project.guid),sequenceId:await sequenceId(sequence),frameTicks:text(await sequence.getTimebase()),
    videoTracks:Number(await sequence.getVideoTrackCount()),audioTracks:Number(await sequence.getAudioTrackCount()),captions,
    publicSequenceEditor:{insert:typeof editor.createInsertProjectItemAction==='function',remove:typeof editor.createRemoveItemsAction==='function'},
    errors,contentDispatched:false,verification:'Read-only method and sample discovery; no ripple edit has been proven'};
}

type Context={project:any;sequence:any};
type Entry={raw:any;snapshot:AnyRecord;key:RippleItem};
const seconds=(ticks:string)=>Number(ticks)/254016000000;
const closeTicks=(a:string,b:string)=>{const d=BigInt(a)-BigInt(b);return (d<0n?-d:d)<=254016n;};
const entryKey=(s:AnyRecord):RippleItem=>({id:s.id,mediaType:s.mediaType,trackIndex:s.trackIndex,startTicks:s.start.ticks,endTicks:s.end.ticks});
const sourceFields=(s:AnyRecord)=>JSON.stringify([s.projectItemId,s.name,s.inPoint?.ticks,s.outPoint?.ticks,s.speed,s.reversed,s.disabled,s.adjustmentLayer]);

async function assertNoAffectedTransitions(sequence:any,startSeconds:number){
  for(const mediaType of ['video','audio']){
    const count=Number(await (mediaType==='video'?sequence.getVideoTrackCount():sequence.getAudioTrackCount()));
    for(let index=0;index<count;index++){
      const track=await (mediaType==='video'?sequence.getVideoTrack(index):sequence.getAudioTrack(index));
      const items=await track.getTrackItems(ppro.Constants.TrackItemType.TRANSITION,true);
      if(!Array.isArray(items))throw Error('RIPPLE_TRANSITION_COLLECTION_UNVERIFIED');
      for(const item of items){
        let end:any;
        try{end=asTickTime(await item.getEndTime());}
        catch{
          // Premiere exposes a nameless invalid sentinel on empty tracks.
          // A named transition with unreadable timing must never be omitted.
          let name='';try{name=text(await item.getName());}catch{/* empty sentinel */}
          if(name)throw Error('RIPPLE_TRANSITION_TIMING_UNVERIFIED');
          continue;
        }
        if(end.seconds>startSeconds)throw Error('RIPPLE_AFFECTED_TRANSITION_UNSUPPORTED');
      }
    }
  }
}

async function readRippleData(context:Context,startSeconds:number):Promise<Entry[]> {
  const entries:Entry[]=[];
  for(let offset=0;;){
    const page=await queryTimelineEntries(context.sequence,{startSeconds,limit:100,offset});
    if(page.page.scanTruncated)throw Error('RIPPLE_TIMELINE_READ_INCOMPLETE');
    entries.push(...page.entries.map(e=>({...e,key:entryKey(e.snapshot)})));
    if(!page.page.hasMore)break;offset=page.page.nextOffset;
  }
  const count=Number(await context.sequence.getCaptionTrackCount());
  for(let trackIndex=0;trackIndex<count;trackIndex++) {
    const track=await context.sequence.getCaptionTrack(trackIndex),items=await track.getTrackItems(ppro.Constants.TrackItemType.CLIP,false);
    if(!Array.isArray(items)||items.length>1000)throw Error('RIPPLE_CAPTION_COLLECTION_UNVERIFIED');
    for(let index=0;index<items.length;index++) {
      const raw=items[index],start=asTickTime(await raw.getStartTime()),end=asTickTime(await raw.getEndTime());
      if(end.seconds<=startSeconds)continue;
      const snapshot={id:`caption:${trackIndex}:${index}`,mediaType:'caption',trackIndex,index,start,end};
      entries.push({raw,snapshot,key:entryKey(snapshot)});
    }
  }
  return entries;
}

async function rippleScope(args:AnyRecord) {
  const context=await mutationContext(args),frameTicks=text(await context.sequence.getTimebase());
  if(args.expectedSequenceName!==undefined&&args.expectedSequenceName!==text(context.sequence.name))throw Error('RIPPLE_SEQUENCE_NAME_CHANGED');
  if(args.expectedFrameTicks!==undefined&&args.expectedFrameTicks!==frameTicks)throw Error('RIPPLE_TIMEBASE_CHANGED');
  const boundaries=normalizeRippleBoundaries(frameTicks,args.boundaries),startSeconds=Math.min(...boundaries.map(b=>seconds(b.atTicks)));
  const entries=await readRippleData(context,startSeconds),plan=planRippleGaps(frameTicks,boundaries,entries.map(e=>e.key));
  await assertNoAffectedTransitions(context.sequence,startSeconds);
  return {context,entries,plan,startSeconds};
}

export async function inspectTimelineRipple(args:AnyRecord) {
  const {context,entries,plan}=await rippleScope(args);
  return {status:'pass',projectId:text(context.project.guid),projectPath:text(context.project.path),sequenceId:await sequenceId(context.sequence),sequenceName:text(context.sequence.name),
    plan,items:entries.map(e=>e.snapshot),contentDispatched:false,
    tool:'ripple_timeline',arguments:{...args,expectedSequenceName:text(context.sequence.name),expectedFrameTicks:plan.frameTicks}};
}

/** Actual public UXP edits only; captions remain the same native cues. The
 * server verifies saved caption text/style blobs after these timing actions. */
export async function rippleTimeline(args:AnyRecord,adapters:{split:(args:AnyRecord,context:Context)=>Promise<AnyRecord>;execute:(project:any,label:string,actions:()=>any[])=>boolean}) {
  let changed=false;const steps:AnyRecord[]=[];
  try {
    const {context,entries,plan,startSeconds}=await rippleScope(args);
    if(!plan.changes.length)return {status:'pass',hostResult:{plan,contentDispatched:false,noAffectedItems:true},errors:[]};
    if(!args.expectedPlan||JSON.stringify(args.expectedPlan)!==JSON.stringify(plan))throw Error('RIPPLE_PLAN_CHANGED_BEFORE_DISPATCH');
    if(!Array.isArray(args.expectedItems)||entries.some(e=>e.key.mediaType!=='caption'&&sourceFields(e.snapshot)!==sourceFields(args.expectedItems.find((s:AnyRecord)=>s.id===e.key.id)??{})))throw Error('RIPPLE_SOURCE_CHANGED_BEFORE_DISPATCH');
    const byId=new Map(entries.map(e=>[e.key.id,e]));
    for(const change of plan.changes) {
      const entry=byId.get(change.id)!;
      if(typeof entry.raw.createMoveAction!=='function'||(change.mediaType==='caption'&&typeof entry.raw.createSetEndAction!=='function'))throw Error('RIPPLE_NATIVE_TIMING_ACTION_UNAVAILABLE');
    }
    // The server's freshly saved caption baseline is exact, not an old whole
    // project snapshot. It is used only for cues this command will change.
    const captionChanges=plan.changes.filter(c=>c.mediaType==='caption');
    if(captionChanges.length){
      if(!Array.isArray(args.captionBaseline)||args.captionBaseline.length!==captionChanges.length)throw Error('RIPPLE_CAPTION_BASELINE_REQUIRED');
      for(const c of captionChanges){const b=args.captionBaseline.find((b:AnyRecord)=>b.id===c.id);if(!b||!closeTicks(b.startTicks,c.startTicks)||!closeTicks(b.endTicks,c.endTicks))throw Error('RIPPLE_CAPTION_CHANGED_BEFORE_DISPATCH');}
    }
    for(const change of plan.changes.filter(c=>c.mediaType!=='caption')) {
      let current=byId.get(change.id)!.snapshot;
      for(const atTicks of [...change.splitAtTicks].reverse()) {
        let result:AnyRecord;
        try{result=await adapters.split({...args,split:{trackItemId:current.id,expectedProjectItemId:current.projectItemId,expectedMediaType:current.mediaType,expectedTrackIndex:current.trackIndex,expectedStartSeconds:current.start.seconds,expectedEndSeconds:current.end.seconds,atSeconds:seconds(atTicks)}},context);}
        catch(error){
          // Only the split's tracked native dispatch boundary can prove no
          // write. A later preflight must never erase a preceding split.
          if((error as any)?.details?.contentDispatched!==false)changed=true;
          throw error;
        }
        if(result.hostResult?.contentDispatched!==false)changed=true;
        steps.push({phase:'split',trackItemId:current.id,atTicks,status:result.status});
        if(result.status!=='pass')return {status:changed?'unverified':'fail',hostResult:{steps,splitFailure:result,contentDispatched:changed},errors:['Ripple stopped during a split; inspect the current affected range before resuming']};
        const left=result.hostResult?.readback?.left;
        if(!left)throw Error('RIPPLE_SPLIT_LEFT_UNVERIFIED');current=left;
      }
    }
    const current=await readRippleData(context,startSeconds),prepared:Array<{entry:Entry;piece:AnyRecord;delta:bigint}>=[];
    const expectedCount=entries.length+plan.changes.reduce((n,c)=>n+c.splitAtTicks.length-c.pieces.filter(p=>seconds(p.originalEndTicks)<=startSeconds).length,0);
    if(current.length!==expectedCount)throw Error('RIPPLE_AFFECTED_ITEM_COUNT_CHANGED');
    for(const change of plan.changes)for(const piece of change.pieces) {
      if(seconds(piece.originalEndTicks)<=startSeconds)continue;
      const original=byId.get(change.id)!;
      const matches=current.filter(e=>e.key.mediaType===change.mediaType&&e.key.trackIndex===change.trackIndex&&closeTicks(e.key.startTicks,piece.originalStartTicks)&&closeTicks(e.key.endTicks,piece.originalEndTicks)&&
        (change.mediaType==='caption'?e.key.id===change.id:e.snapshot.projectItemId===original.snapshot.projectItemId));
      if(matches.length!==1)throw Error('RIPPLE_PIECE_CHANGED_BEFORE_MOVE');
      if(!change.splitAtTicks.length&&change.mediaType!=='caption'&&sourceFields(original.snapshot)!==sourceFields(matches[0]!.snapshot))throw Error('RIPPLE_SOURCE_CHANGED_BEFORE_MOVE');
      prepared.push({entry:matches[0]!,piece,delta:BigInt(piece.startTicks)-BigInt(piece.originalStartTicks)});
    }
    prepared.sort((a,b)=>BigInt(a.piece.originalStartTicks)>BigInt(b.piece.originalStartTicks)?-1:1);
    const moves=prepared.filter(p=>p.delta!==0n);
    if(moves.length){
      changed=true;
      if(!adapters.execute(context.project,'Insert timeline gaps across AV and captions',()=>moves.map(({entry,delta})=>entry.raw.createMoveAction(ppro.TickTime.createWithTicks(String(delta))))))throw Error('RIPPLE_TRANSACTION_REJECTED');
    }
    const extensions=prepared.filter(({entry,piece,delta})=>entry.key.mediaType==='caption'&&BigInt(piece.endTicks)!==BigInt(piece.originalEndTicks)+delta);
    if(extensions.length){
      // Native set-end actions capture their delta at construction. Constructing
      // one beside move(delta) adds that move twice. Commit moves, reacquire the
      // exact intermediate cue, then construct its final end edit.
      const moved=await readRippleData(context,startSeconds);
      const fresh=extensions.map(({entry,piece,delta})=>{
        const matches=moved.filter(e=>e.key.id===entry.key.id&&e.key.mediaType==='caption'&&closeTicks(e.key.startTicks,piece.startTicks)&&closeTicks(e.key.endTicks,String(BigInt(piece.originalEndTicks)+delta)));
        if(matches.length!==1)throw Error('RIPPLE_CAPTION_CHANGED_BEFORE_EXTENSION');
        return {entry:matches[0]!,piece};
      });
      changed=true;
      if(!adapters.execute(context.project,'Extend crossing captions after verified moves',()=>fresh.map(({entry,piece})=>entry.raw.createSetEndAction(ppro.TickTime.createWithTicks(piece.endTicks)))))throw Error('RIPPLE_CAPTION_EXTENSION_REJECTED');
    }
    const after=await readRippleData(context,startSeconds),errors:string[]=[];
    if(after.length!==current.length)errors.push('Ripple changed the affected item count');
    for(const {entry,piece} of prepared){
      const matches=after.filter(e=>e.key.mediaType===entry.key.mediaType&&e.key.trackIndex===entry.key.trackIndex&&closeTicks(e.key.startTicks,piece.startTicks)&&closeTicks(e.key.endTicks,piece.endTicks)&&
        (entry.key.mediaType==='caption'?e.key.id===entry.key.id:e.snapshot.projectItemId===entry.snapshot.projectItemId));
      if(matches.length!==1)errors.push('Ripple destination missing or ambiguous: '+entry.key.id);
      else if(entry.key.mediaType!=='caption'&&sourceFields(entry.snapshot)!==sourceFields(matches[0]!.snapshot))errors.push('Ripple changed source bounds/state: '+entry.key.id);
    }
    return {status:errors.length?'unverified':'pass',hostResult:{steps,plan,captionTimingVerified:errors.length===0,captionContentVerification:'requires_saved_archive_readback'},after:{items:after.map(e=>e.snapshot)},errors};
  }catch(error){return {status:changed?'unverified':'fail',hostResult:{steps,contentDispatched:changed},errors:[String(error)]};}
}
