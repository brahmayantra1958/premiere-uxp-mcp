import { HostCommandError } from "./bridge-client.js";
import type { BridgeRequest } from "./wire.js";
import {observeHostQueue} from './host-command-progress.js';

/** Serialize native calls without treating user navigation as a content lock. */
export class HostCommandQueue {
  private tail: Promise<unknown> = Promise.resolve();
  private readonly pending = new Map<string, {id:string;command:string;state:'queued'|'running'}>();

  inspect() { return [...this.pending.values()].map(value=>({...value})); }

  run(request: BridgeRequest, action: () => Promise<unknown>): Promise<unknown> {
    const deadline = Date.now() + request.timeoutMs;
    if(this.pending.has(request.id))throw new HostCommandError('HOST_COMMAND_IN_FLIGHT','Command ID is already queued');
    this.pending.set(request.id,{id:request.id,command:request.command,state:'queued'});
    observeHostQueue(request,'queued');
    const current = this.tail.then(() => {
      if (Date.now() >= deadline) throw new HostCommandError("QUEUED_COMMAND_EXPIRED", "Request expired waiting for another host operation; no navigation or command was dispatched");
      this.pending.get(request.id)!.state='running';
      observeHostQueue(request,'running');
      return action();
    }).finally(()=>{this.pending.delete(request.id);observeHostQueue(request,'settled');});
    this.tail = current.catch(() => {});
    return current;
  }
}
