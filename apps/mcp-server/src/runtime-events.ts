/** Event revisions are observation cursors, not mutation or receipt IDs. A wait timeout means no matching event yet; clients must never resubmit the job because a wait timed out. */
import {randomUUID} from 'node:crypto';
import {z} from 'zod/v4';

export const eventQuerySchema=z.object({sessionId:z.string().uuid().optional(),afterRevision:z.number().int().nonnegative().default(0),
  jobId:z.string().min(1).max(200).optional(),terminalOnly:z.boolean().default(false),limit:z.number().int().min(1).max(100).default(50),timeoutMs:z.number().int().min(0).max(30000).default(0)
}).strict().refine(q=>q.afterRevision===0||q.sessionId!==undefined,'A nonzero cursor requires its sessionId').refine(q=>!q.terminalOnly||q.jobId!==undefined,'Terminal waits require a jobId');
export type EventQuery=z.input<typeof eventQuerySchema>;
export type RuntimeEvent={revision:number;at:string;kind:'command'|'job'|'connection';id:string;command?:string|undefined;state:string;jobId?:string|undefined;stepIndex?:number|undefined;completedSteps?:number|undefined;totalSteps?:number|undefined;durationMs?:number|undefined};
export type EventPage={sessionId:string;latestRevision:number;nextRevision:number;events:RuntimeEvent[];hasMore:boolean;overflow:boolean;resetRequired:boolean;timedOut:boolean;closed:boolean};
type Input=Omit<RuntimeEvent,'revision'|'at'>;
type Waiter={query:z.output<typeof eventQuerySchema>;resolve:(page:EventPage)=>void;timer:ReturnType<typeof setTimeout>;cleanup:()=>void};

/** Runtime-owned bounded observations. Events carry no command args, paths or
 * host values. No idle timer and no Premiere request is used to observe/wait.
 * A terminal event points to a receipt; it does not strengthen its proof. */
export class RuntimeEvents {
  readonly sessionId=randomUUID();
  private revision=0;
  private entries:RuntimeEvent[]=[];
  private readonly waiters=new Set<Waiter>();
  private closed=false;
  constructor(private readonly capacity=512,private readonly maxWaiters=64){if(!Number.isInteger(capacity)||capacity<1||!Number.isInteger(maxWaiters)||maxWaiters<1)throw Error('Invalid event bounds');}
  append(input:Input):void {
    if(this.closed)return;
    // Select fields explicitly, including when an adapter passes extra data.
    const {kind,id,command,state,jobId,stepIndex,completedSteps,totalSteps,durationMs}=input;
    this.entries.push({revision:++this.revision,at:new Date().toISOString(),kind,id,command,state,jobId,stepIndex,completedSteps,totalSteps,durationMs});
    if(this.entries.length>this.capacity)this.entries.shift();
    for(const waiter of [...this.waiters]){const page=this.list(waiter.query);if(page.events.length||page.overflow||page.resetRequired)this.finish(waiter,page);}
  }
  list(input:EventQuery={}):EventPage {
    const q=eventQuerySchema.parse(input),resetRequired=(q.sessionId!==undefined&&q.sessionId!==this.sessionId)||q.afterRevision>this.revision;
    const oldest=this.entries[0]?.revision??this.revision+1;
    const overflow=!resetRequired&&q.afterRevision>0&&q.afterRevision<oldest-1;
    const matches=resetRequired?[]:this.entries.filter(e=>e.revision>q.afterRevision&&(!q.jobId||e.jobId===q.jobId||e.id===q.jobId)&&(!q.terminalOnly||e.kind==='job'&&['pass','fail','unverified','cancelled'].includes(e.state)));
    const events=matches.slice(0,q.limit).map(e=>({...e}));
    return {sessionId:this.sessionId,latestRevision:this.revision,nextRevision:matches.length>q.limit?events.at(-1)!.revision:this.revision,events,hasMore:matches.length>q.limit,overflow,resetRequired,timedOut:false,closed:this.closed};
  }
  wait(input:EventQuery={},signal?:AbortSignal):Promise<EventPage> {
    const query=eventQuerySchema.parse(input),page=this.list(query);
    if(page.events.length||page.overflow||page.resetRequired||page.closed||query.timeoutMs===0||signal?.aborted)return Promise.resolve(page);
    if(this.waiters.size>=this.maxWaiters)return Promise.reject(Error('EVENT_WAITER_LIMIT: reuse a pending wait instead of starting another'));
    return new Promise(resolve=>{
      const abort=()=>this.finish(waiter,this.list(query));
      const waiter:Waiter={query,resolve,timer:setTimeout(()=>this.finish(waiter,{...this.list(query),timedOut:true}),query.timeoutMs),cleanup:()=>signal?.removeEventListener('abort',abort)};
      this.waiters.add(waiter);signal?.addEventListener('abort',abort,{once:true});
    });
  }
  close():void {this.closed=true;for(const waiter of [...this.waiters])this.finish(waiter,this.list(waiter.query));}
  private finish(waiter:Waiter,page:EventPage):void {if(!this.waiters.delete(waiter))return;clearTimeout(waiter.timer);waiter.cleanup();waiter.resolve(page);}
}
