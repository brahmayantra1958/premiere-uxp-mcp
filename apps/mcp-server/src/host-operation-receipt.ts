import type {BridgeResponse,OperationReceipt} from '@premiere-uxp/contracts';

/** Host evidence after feature-specific postconditions, before file checking.
 * A transport success alone has no implied pass status. */
export type HostResult={
  status?:OperationReceipt['status'];before?:unknown;hostResult?:unknown;
  workTarget?:OperationReceipt['workTarget'];after?:unknown;changedFiles?:string[];
  errors?:string[];recovery?:string;visibility?:unknown;actualTarget?:unknown;
};
type ReceiptContext=Pick<OperationReceipt,'commandId'|'command'|'requestFingerprint'|'startedAt'|'completedAt'>;

/** Deterministic receipt projection. Identity/timestamps are supplied by the
 * executor; this never dispatches, persists, releases quarantine or upgrades
 * missing host proof. Filesystem evidence is applied separately afterward. */
export function hostResponseReceipt(response:BridgeResponse,result:HostResult,context:ReceiptContext):OperationReceipt{
  if(!response.ok){
    const unsupported=response.error?.code==='UNSUPPORTED_API'||response.error?.code==='UNSUPPORTED_COMMAND';
    const proof=response.error?.details as Record<string,unknown>|undefined;
    const preflight=proof?.contentDispatched===false && proof.errorClassification==='preflight';
    return {...context,status:preflight?'fail':unsupported?'unsupported':'unverified',changedFiles:[],
      retryable:false,errorClassification:preflight?'preflight':'postcondition',
      ...(preflight?{hostResult:{contentDispatched:false},actualTarget:proof.actualTarget}:{}),
      errors:[`${response.error?.code??'HOST_ERROR'}: ${response.error?.message??'Unknown Premiere error'}`]};
  }
  return {
    ...context,status:result.status??'unverified',
    ...(result.actualTarget===undefined?{}:{actualTarget:result.actualTarget}),
    ...((result.status??'unverified')!=='pass'?{retryable:false,errorClassification:(result.hostResult as any)?.contentDispatched===false?'preflight' as const:'postcondition' as const}:{}),
    hostResult:result.visibility?{...(result.hostResult&&typeof result.hostResult==='object'?result.hostResult:{result:result.hostResult}),visibility:result.visibility}:result.hostResult??result,
    ...(result.workTarget===undefined?{}:{workTarget:result.workTarget}),
    changedFiles:result.changedFiles??[],errors:result.errors??[],
    ...(result.before===undefined?{}:{before:result.before}),
    ...(result.after===undefined?{}:{after:result.after}),
    ...(result.recovery===undefined?{}:{recovery:result.recovery}),
  };
}
