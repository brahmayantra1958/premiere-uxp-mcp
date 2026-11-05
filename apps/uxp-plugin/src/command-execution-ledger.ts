import type {BridgeRequest,BridgeResponse} from './wire.js';
import {bindHostCommandProgress,HostProgressRecorder,type QueueState} from './host-command-progress.js';
function canonical(value:unknown):unknown{
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)]));
  return value;
}
type Entry={command:string;fingerprint:string;response?:BridgeResponse;queueState?:QueueState;progress?:HostProgressRecorder};
/** Session-local execution evidence, not a replay queue. It can prove a late
 * terminal response, but a panel reload or evicted entry remains unknown. */
export class CommandExecutionLedger{
  readonly sessionId=`${Date.now()}-${Math.random().toString(36).slice(2)}`;
  private entries=new Map<string,Entry>();
  begin(request:BridgeRequest):BridgeResponse|undefined{
    const fingerprint=JSON.stringify([request.command,canonical(request.args)]),old=this.entries.get(request.id);
    if(old){if(old.fingerprint!==fingerprint)throw Error('IDEMPOTENCY_CONFLICT');if(!old.response)throw Error('HOST_COMMAND_IN_FLIGHT');return old.response;}
    if([...this.entries.values()].filter(e=>!e.response).length>=64)throw Error('HOST_COMMAND_QUEUE_FULL');
    const entry:Entry={command:request.command,fingerprint};
    if(['insert_editable_graphic','insert_mogrt_caption','create_sequence'].includes(request.command))entry.progress=new HostProgressRecorder();
    bindHostCommandProgress(request,{queue:state=>{entry.queueState=state;},...(entry.progress?{call:event=>entry.progress!.record(event)}:{})});
    this.entries.set(request.id,entry);return undefined;
  }
  complete(response:BridgeResponse):void{
    const entry=this.entries.get(response.id);if(!entry)throw Error('HOST_EXECUTION_UNKNOWN');entry.response=response;
    while(this.entries.size>200){const oldest=[...this.entries].find(([,v])=>!!v.response);if(!oldest)break;this.entries.delete(oldest[0]);}
  }
  inspect(ids:unknown){
    if(!Array.isArray(ids)||ids.length>128||ids.some(id=>typeof id!=='string'||!id||id.length>200)||new Set(ids).size!==ids.length)throw Error('EXECUTION_QUERY_INVALID');
    return {status:'pass',protocol:1,sessionId:this.sessionId,
      active:[...this.entries].filter(([,e])=>!e.response).map(([id,e])=>({id,command:e.command,...(e.queueState?{queueState:e.queueState}:{}),...(e.progress?{diagnostics:e.progress.inspect()}:{})})),
      // Keep the recovery protocol's legacy running/complete/unknown meaning.
      // queueState and diagnostics are observations, never terminal evidence.
      commands:ids.map(id=>{const e=this.entries.get(id);return {id,state:e?(e.response?'complete':'running'):'unknown',...(e?{command:e.command,fingerprint:e.fingerprint,response:e.response,...(e.queueState?{queueState:e.queueState}:{}),...(e.progress?{diagnostics:e.progress.inspect()}:{})}:{})};})};
  }
}
