import {canonicalizeOperationValue} from './operation-identity.js';
import type {MutationLease} from './receipt-store.js';
/** A late response is accepted only from the current authenticated panel's
 * completed ledger and the exact original command/arguments. Silence, elapsed
 * time, a new session or an empty queue alone never proves an old edit. */
export function recoveryExecutionProof(lease:MutationLease,observed:Record<string,any>){
  if(observed.status!=='pass'||observed.protocol!==1||typeof observed.sessionId!=='string'||!Array.isArray(observed.active)||observed.active.length||!Array.isArray(observed.commands))throw Error('RECOVERY_HOST_NOT_QUIESCENT');
  const steps=lease.operations.filter(s=>s.kind==='host'&&s.dispatched);
  for(const step of steps){
    const rows=observed.commands.filter((r:any)=>r.id===step.commandId),row=rows[0];
    if(rows.length!==1||row.state!=='complete'||row.command!==step.command||row.fingerprint!==JSON.stringify([step.command,canonicalizeOperationValue(step.args)])||row.response?.id!==step.commandId)throw Error('RECOVERY_EXECUTION_UNVERIFIED: '+step.commandId);
  }
  return {sessionId:observed.sessionId,steps:steps.map(step=>({step,response:observed.commands.find((r:any)=>r.id===step.commandId).response}))};
}
