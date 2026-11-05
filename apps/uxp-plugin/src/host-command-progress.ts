import type {BridgeRequest} from './wire.js';

// Only fixed operation labels and numeric indices belong in diagnostics. Never
// retain arguments, file paths, text/parameter values, credentials or errors.
const phases=['graphic.preflight','graphic.insert','graphic.timeline.after_insert','graphic.lookup','graphic.components.readiness','graphic.parameters','graphic.duration','graphic.timeline.final','graphic.components.final','graphic.rollback',
  'sequence.dispatch_preflight','sequence.follow_preflight','sequence.preflight','sequence.create','sequence.activate','sequence.readback'] as const;
const methods=['prepareEditableGraphic','insertMogrtFromPath','targetSequenceSnapshot','mutationContext','findTrackItemEntry','componentSnapshot','setComponentValues','createSetEndAction','executeTransaction','trackItems','liveTrackItemSelection','createRemoveItemsAction','clearSelection','readinessWait',
  'getComponentChain','getComponentCount','getComponentAtIndex','getParamCount','getParam','getValueAtTime','getStartValue','getKeyframePtr','isTimeVarying','areKeyframesSupported','getKeyframeListAsTickTimes','getTemporalInterpolationMode','getDisplayName','getMatchName','displayName',
  'inspectHostContext','getSequences','createSequenceWithPresetPath','createSequence','setActiveSequence','activeSequence','sequenceSnapshot'] as const;
export type ProgressPhase=typeof phases[number];
export type ProgressMethod=typeof methods[number];
export type ProgressIndices={componentIndex?:number;paramIndex?:number;keyframeIndex?:number;attempt?:number};
export type ProgressCall=ProgressIndices&{phase:ProgressPhase;method:ProgressMethod};
export type ProgressEvent=ProgressCall&{callId:number;startedAt:number;finishedAt?:number;outcome?:'returned'|'threw'};
export type QueueState='queued'|'running'|'settled';
type Observers={queue:(state:QueueState)=>void;call?:(event:ProgressEvent)=>void;nextCall:number};

// A WeakMap binds observation to the exact request object, not a global current
// command. A queued ping cannot replace an in-flight graphic's native context.
const observers=new WeakMap<BridgeRequest,Observers>();
export function bindHostCommandProgress(request:BridgeRequest,observer:Omit<Observers,'nextCall'>):void {
  observers.set(request,{...observer,nextCall:0});
}
export function observeHostQueue(request:BridgeRequest,state:QueueState):void {
  try{observers.get(request)?.queue(state);}catch{/* Observation cannot change queue execution. */}
}

function sanitize(detail:ProgressCall):ProgressCall|undefined {
  if(!phases.includes(detail.phase)||!methods.includes(detail.method))return undefined;
  const safe:ProgressCall={phase:detail.phase,method:detail.method};
  for(const key of ['componentIndex','paramIndex','keyframeIndex','attempt'] as const)if(Number.isSafeInteger(detail[key])&&detail[key]!>=0&&detail[key]!<=1_000_000)safe[key]=detail[key]!;
  return safe;
}

export class HostCommandProgress {
  constructor(private readonly observer:Observers,readonly phase:ProgressPhase,private readonly indices:ProgressIndices={}){}
  at(phase:ProgressPhase,indices:ProgressIndices={}):HostCommandProgress{return new HostCommandProgress(this.observer,phase,indices);}
  begin(method:ProgressMethod,indices:ProgressIndices={}):(outcome:'returned'|'threw')=>void {
    let event:ProgressEvent|undefined;
    try{
      const safe=sanitize({phase:this.phase,method,...this.indices,...indices});
      if(safe){event={...safe,callId:++this.observer.nextCall,startedAt:Date.now()};this.observer.call?.({...event});}
    }catch{/* Diagnostics are never part of the operation's proof. */}
    return outcome=>{try{if(event)this.observer.call?.({...event,finishedAt:Date.now(),outcome});}catch{/* observation only */}};
  }
}
export function hostCommandProgress(request:BridgeRequest):HostCommandProgress|undefined {
  const observer=observers.get(request);return observer?.call?new HostCommandProgress(observer,request.command==='create_sequence'?'sequence.preflight':'graphic.preflight'):undefined;
}

/** Keep native sync calls sync, returning the exact value/error. */
export function observeHostSync<T>(progress:HostCommandProgress|undefined,method:ProgressMethod,work:()=>T,indices:ProgressIndices={}):T {
  const finish=progress?.begin(method,indices);
  try{const result=work();finish?.('returned');return result;}catch(error){finish?.('threw');throw error;}
}
/** Await one native result exactly once. No timeout/race/retry/cancellation is
 * introduced, and an unresolved call leaves every existing owner lane held. */
export function observeHostAwait<T>(progress:HostCommandProgress|undefined,method:ProgressMethod,work:()=>T|PromiseLike<T>,indices:ProgressIndices={}):T|PromiseLike<T> {
  if(!progress)return work();
  const finish=progress.begin(method,indices);
  return (async()=>{try{const result=await work();finish('returned');return result;}catch(error){finish('threw');throw error;}})();
}

/** Bounded, plain memory only. Active calls are separate from recent completed
 * calls; a completed inner getter must not hide an unresolved outer stage. */
export class HostProgressRecorder {
  private active:ProgressEvent[]=[];
  private recent:ProgressEvent[]=[];
  record(event:ProgressEvent):void {
    const safe=sanitize(event);if(!safe||!Number.isSafeInteger(event.callId)||event.callId<1||!Number.isFinite(event.startedAt)||event.finishedAt!==undefined&&(!Number.isFinite(event.finishedAt)||!['returned','threw'].includes(event.outcome??'')))return;
    const copy:ProgressEvent={...safe,callId:event.callId,startedAt:event.startedAt,...(event.finishedAt===undefined?{}:{finishedAt:event.finishedAt,outcome:event.outcome})};
    if(event.finishedAt===undefined){this.active.push(copy);if(this.active.length>8)this.active.shift();}
    else {this.active=this.active.filter(row=>row.callId!==event.callId);this.recent.push(copy);if(this.recent.length>12)this.recent.shift();}
  }
  inspect(){
    const current=this.active.at(-1),latest=[...this.active,...this.recent].sort((a,b)=>b.callId-a.callId)[0];
    return {observationalOnly:true,...(current?{current:{...current}}:{}),...(latest?{lastStartedAt:latest.startedAt,lastCall:{...latest}}:{}),activeCalls:this.active.map(row=>({...row})),recentCalls:this.recent.map(row=>({...row}))};
  }
}
