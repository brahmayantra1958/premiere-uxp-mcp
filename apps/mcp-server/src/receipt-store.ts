/** An operation ID identifies one immutable intent/fingerprint. Repeated requests return its receipt; an uncertain receipt is not permission to dispatch again. Inactive archival releases ownership without rewriting history. */
import { createHash, randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { mkdir, open, readFile, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {setTimeout as delay} from 'node:timers/promises';
import { operationReceiptSchema,editPlanSchema, type EditPlan, type OperationReceipt } from "@premiere-uxp/contracts";
import {ExecutionEvidenceStore} from './execution-evidence.js';

/**
 * Legacy receipts stay untouched. New receipts are independent atomic records;
 * inspecting Premiere never loads the legacy payload. Reads are fresh across
 * clients, so a long-lived stdio client can replay another client's receipt.
 */
export class ReceiptStore {
  readonly executionEvidence:ExecutionEvidenceStore;
  private legacy = new Map<string, OperationReceipt>();
  private legacyStamp: string | undefined;
  private readonly directory: string;
  private readonly leaseContext = new AsyncLocalStorage<LeaseScope>();
  private clientName = () => 'unknown MCP client';
  setClientNameProvider(provider: () => string): void { this.clientName = provider; }

  constructor(private readonly filePath: string, private readonly maximum = 500) {
    if (!Number.isSafeInteger(maximum) || maximum < 1) throw new Error("Receipt retention must be a positive integer");
    this.directory = `${filePath}.d`;
    this.executionEvidence=new ExecutionEvidenceStore(filePath);
  }

  /** Explicit legacy load, retained for compatibility; ordinary startup omits it. */
  async load(): Promise<void> {
    try {
      const info = await stat(this.filePath);
      const stamp = `${info.size}:${info.mtimeMs}`;
      if (stamp === this.legacyStamp) return;
      const receipts = operationReceiptSchema.array().parse(JSON.parse(await readFile(this.filePath, "utf8")));
      this.legacy = new Map(receipts.map(receipt => [receipt.commandId, receipt]));
      this.legacyStamp = stamp;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.legacy.clear();
      this.legacyStamp = undefined;
    }
  }

  async get(commandId: string): Promise<OperationReceipt | undefined> {
    try {
      const receipt = operationReceiptSchema.parse(JSON.parse(await readFile(this.recordPath(commandId), "utf8")));
      if (receipt.commandId !== commandId) throw new Error("RECEIPT_ID_MISMATCH");
      return receipt;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    try { const receipt=operationReceiptSchema.parse(JSON.parse(await readFile(this.archivedReceiptPath(commandId),'utf8')));if(receipt.commandId!==commandId)throw Error('RECEIPT_ID_MISMATCH');return receipt; }
    catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    await this.load();
    return this.legacy.get(commandId);
  }

  async set(receipt: OperationReceipt): Promise<void> {
    const valid = operationReceiptSchema.parse(receipt);
    await mkdir(this.directory, { recursive: true });
    const destination = this.recordPath(valid.commandId);
    const temporary = `${destination}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(valid), {encoding:'utf8',flush:true});
    await rename(temporary, destination);
    const scope=this.leaseContext.getStore(),step=scope?.record.operations.find(s=>s.commandId===valid.commandId);
    if(scope?.active&&step){step.state='complete';step.status=valid.status;await scope.persist();}
    if(valid.status==='unverified')await this.quarantine('Unverified receipt: '+valid.commandId);
    await this.prune();
    // Only a persisted PASS makes the pre-dispatch baseline dispensable.
    // Failed cleanup retains extra evidence; it never changes execution proof.
    if(valid.status==='pass')await unlink(this.planPath(valid.commandId)).catch(()=>{});
  }

  /** Write-ahead intent survives a client crash before receipt persistence. */
  async intent(commandId:string,command:string,args:Record<string,unknown>,kind:'host'|'local'):Promise<void>{
    const scope=this.leaseContext.getStore();if(!scope?.active)throw Error('MUTATION_LEASE_REQUIRED');
    if(scope.record.operations.some(s=>s.commandId===commandId))throw Error('MUTATION_INTENT_DUPLICATE');
    if(scope.record.operations.length>=512)throw Error('MUTATION_INTENT_LIMIT');
    scope.record.operations.push({commandId,command,args,kind,state:'planned'});await scope.persist();
  }
  async dispatched(commandId:string):Promise<void>{
    const scope=this.leaseContext.getStore(),step=scope?.record.operations.find(s=>s.commandId===commandId);
    if(!scope?.active||!step)throw Error('MUTATION_INTENT_REQUIRED');step.dispatched=true;step.state='dispatched';await scope.persist();
  }
  async saveRelocationPlan(commandId:string,plan:EditPlan):Promise<void>{
    const scope=this.leaseContext.getStore();
    if(!scope?.active||!scope.record.operations.some(s=>s.commandId===commandId&&s.command==='move_clip_to_track'&&!s.dispatched))throw Error('RECOVERY_PLAN_REQUIRES_UNDISPATCHED_INTENT');
    await mkdir(this.directory,{recursive:true});await atomicRecord(this.planPath(commandId),{commandId,plan:editPlanSchema.parse(plan)});
  }
  async relocationPlan(commandId:string):Promise<EditPlan|undefined>{
    try{const row=JSON.parse(await readFile(this.planPath(commandId),'utf8'));if(row.commandId!==commandId)throw Error('RECOVERY_PLAN_ID_MISMATCH');return editPlanSchema.parse(row.plan);}
    catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw e;}
  }
  private planPath(commandId:string){return path.join(this.directory,'plan-'+createHash('sha256').update(commandId).digest('hex')+'.json');}
  async quarantine(reason:string):Promise<void>{
    const scope=this.leaseContext.getStore();if(!scope?.active)return;
    scope.tainted=true;scope.record.reason=reason;await scope.persist();
  }
  async inspectRecovery():Promise<MutationLease|undefined>{
    try{
      const row=JSON.parse(await readFile(`${this.filePath}.mutation-lock`,'utf8')) as MutationLease;
      if(row.version!==1||typeof row.commandId!=='string'||!Array.isArray(row.operations)||row.operations.length>512)throw Error('RECOVERY_LEASE_FORMAT_UNVERIFIED');
      return row;
    }catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw error;}
  }
  /** Administrative retirement, not successful execution or content recovery.
   * Preserve the uncertain receipt and move the inactive lease into history.
   * The live queue/ledger verifier may not inspect or restore project content. */
  async archiveInactive(commandId:string,verify:(lease:MutationLease,actions:MutationStep[])=>Promise<Record<string,unknown>>):Promise<Record<string,unknown>>{
    const lockPath=`${this.filePath}.mutation-lock`,guardPath=lockPath+'.recovery';
    const guard=await recoveryGuard(guardPath,commandId);
    try {
      await guard.writeFile(JSON.stringify({processId:process.pid,commandId,startedAt:new Date().toISOString()}));await guard.sync();
      const lease=await this.inspectRecovery();
      if(!lease||lease.commandId!==commandId)throw Error('ARCHIVE_OPERATION_CHANGED');
      if(!lease.finishedAt){
        let alive=true;try{process.kill(lease.processId,0);}catch(e){if((e as NodeJS.ErrnoException).code==='ESRCH')alive=false;}
        if(alive)throw Error('ARCHIVE_OWNER_STILL_RUNNING');
      }
      const original=await this.get(commandId);
      if(!original)throw Error('ARCHIVE_ORIGINAL_RECEIPT_REQUIRED');
      const actionFile=lockPath+'.recovery-actions.json';let actions:MutationStep[]=[];
      try {const row=JSON.parse(await readFile(actionFile,'utf8'));if(row.commandId!==commandId||!Array.isArray(row.actions))throw Error('ARCHIVE_ACTION_JOURNAL_CHANGED');actions=row.actions;}
      catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
      const proof=await verify(lease,actions);
      if(proof.inactive!==true)throw Error('ARCHIVE_HOST_STILL_ACTIVE');
      if(JSON.stringify(await this.inspectRecovery())!==JSON.stringify(lease)||JSON.stringify(await this.get(commandId))!==JSON.stringify(original))throw Error('ARCHIVE_OPERATION_CHANGED');
      await mkdir(this.directory,{recursive:true});
      const evidence=path.join(this.directory,`inactive-${randomUUID()}.json`);
      const record={operationId:commandId,disposition:'archived_unverified',archivedAt:new Date().toISOString(),
        originalReceiptStatus:original.status,originalReceiptUnchanged:true,contentReplayed:false,contentRestored:false,
        receiptSha256:createHash('sha256').update(JSON.stringify(original)).digest('hex'),originalReceipt:original,lease,actions,proof};
      await writeFile(evidence,JSON.stringify(record),{flag:'wx',flush:true});
      await atomicRecord(this.archivedReceiptPath(commandId),original);
      // Rename the real journal into durable history. Never synthesize a PASS
      // receipt or remove a caller-selected lock path.
      await rename(actionFile,evidence+'.actions').catch(e=>{if(e.code!=='ENOENT')throw e;});
      await rename(lockPath,evidence+'.lease');
      return {status:'pass',operationId:commandId,disposition:record.disposition,leaseReleased:true,
        originalReceiptStatus:original.status,originalReceiptUnchanged:true,contentReplayed:false,contentRestored:false,evidence,proof};
    } finally {try{await guard.close();}finally{await unlink(guardPath);}}
  }
  /** Recovery runs verification, never the original action. A separate lock
   * serializes inspectors; the mutation lock stays present until proof is saved.
   * Old unknown receipts remain immutable after a successful reconciliation. */
  async reconcile(commandId:string,verify:(lease:MutationLease,recovery:RecoveryActions)=>Promise<Record<string,any>>):Promise<Record<string,any>>{
    const lockPath=`${this.filePath}.mutation-lock`,recoveryPath=lockPath+'.recovery';
    const guard=await recoveryGuard(recoveryPath,commandId);
    try{
      await guard.writeFile(JSON.stringify({processId:process.pid,commandId,startedAt:new Date().toISOString()}));await guard.sync();
      const record=await this.inspectRecovery();if(!record||record.commandId!==commandId)throw Error('RECOVERY_OPERATION_CHANGED');
      if(!record.finishedAt){
        let alive=true;try{process.kill(record.processId,0);}catch(e){if((e as NodeJS.ErrnoException).code==='ESRCH')alive=false;}
        if(alive)throw Error('RECOVERY_OWNER_STILL_RUNNING');
      }
      const actionFile=lockPath+'.recovery-actions.json';let actions:MutationStep[]=[];
      try{const saved=JSON.parse(await readFile(actionFile,'utf8'));if(saved.commandId!==commandId||!Array.isArray(saved.actions))throw Error('RECOVERY_ACTION_JOURNAL_CHANGED');actions=saved.actions;}
      catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
      const before=JSON.stringify(record),proof=await verify(record,{actions,record:async(step)=>{
        if(actions.length>=128)throw Error('RECOVERY_ACTION_LIMIT');
        actions.push(step);await atomicRecord(actionFile,{commandId,actions});
      }});
      if(JSON.stringify(await this.inspectRecovery())!==before)throw Error('RECOVERY_LEASE_CHANGED');
      const destination=path.join(this.directory,`recovery-${randomUUID()}.json`);await mkdir(this.directory,{recursive:true});
      await writeFile(destination,JSON.stringify({commandId,at:new Date().toISOString(),lease:record,proof}),{flag:'wx',flush:true});
      if(proof.status==='pass'){
        // Archive verification intents before releasing the write lease. A
        // crash anywhere above retains the original uncertain operation.
        await rename(actionFile,destination+'.actions').catch(e=>{if(e.code!=='ENOENT')throw e;});
        await unlink(lockPath);
        await unlink(this.planPath(commandId)).catch(()=>{});
      }
      return {...proof,quarantineReleased:proof.status==='pass',evidence:destination,originalReceiptUnchanged:true};
    }finally{try{await guard.close();}finally{await unlink(recoveryPath);}}
  }

  /**
   * Cross-process write lease surrounds planning, dispatch and receipt persistence.
   * Existing lock means busy OR uncertain execution, never permission to replay.
   * A process crash/persistence error retains the lock for inspection and recovery.
   */
  async runExclusive<T>(commandId: string, action: () => Promise<T>): Promise<T> {
    const inherited = this.leaseContext.getStore();
    // Existing archive workflows call save/close/reopen inside mutateLocal.
    // Reuse only their async call chain; unrelated requests still acquire a lease.
    if (inherited?.active) {
      if(inherited.tainted)throw Error('MUTATION_IN_PROGRESS_OR_UNVERIFIED: this workflow already has an uncertain step');
      try { return await action(); }
      catch (error) { inherited.tainted = true; throw error; }
    }
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const lockPath = `${this.filePath}.mutation-lock`;
    const lease = await open(lockPath, "wx").catch(async (error: NodeJS.ErrnoException) => {
      if (error.code === "EEXIST") {
        const owner = leaseOwner(await this.inspectRecovery().catch(() => undefined));
        throw Object.assign(new Error('MUTATION_IN_PROGRESS_OR_UNVERIFIED: MCP write lease owner=' + JSON.stringify(owner) + '. User navigation does not acquire this lease. Query get_mutation_recovery; wait for active execution or archive only the exact inactive operation. Never replay an unknown write.'),
          { details: { retryable:false, errorClassification:'preflight', contentDispatched:false, owner } });
      }
      throw error;
    });
    // Existence is the cross-client lease. Windows cannot atomically replace
    // a destination while our creation handle is open; close it before the
    // first durable rename without ever removing the lock path.
    await lease.close();
    let completed = false;
    const record:MutationLease={version:1,commandId,clientName:this.clientName(),processId:process.pid,startedAt:new Date().toISOString(),operations:[]};
    const scope:LeaseScope={active:true,tainted:false,record,persist:()=>atomicRecord(lockPath,record)};
    try {
      await scope.persist();
      const result = await this.leaseContext.run(scope, action);
      completed = !scope.tainted;
      return result;
    } finally {
      scope.active = false;
      record.finishedAt=new Date().toISOString();
      await scope.persist();
      if (completed) await unlink(lockPath);
    }
  }

  private recordPath(commandId: string): string {
    return path.join(this.directory, `${createHash("sha256").update(commandId).digest("hex")}.json`);
  }
  private archivedReceiptPath(commandId:string){return path.join(this.directory,`archived-${createHash('sha256').update(commandId).digest('hex')}.json`);}

  private async prune(): Promise<void> {
    const names = (await readdir(this.directory)).filter(name => /^[a-f0-9]{64}\.json$/.test(name));
    if (names.length <= this.maximum) return;
    const entries = await Promise.all(names.map(async name => ({ name, modified: (await stat(path.join(this.directory, name))).mtimeMs })));
    entries.sort((a, b) => a.modified - b.modified || a.name.localeCompare(b.name));
    for (const entry of entries.slice(0, names.length - this.maximum)) await unlink(path.join(this.directory, entry.name));
  }
}

export type MutationStep={commandId:string;command:string;args:Record<string,unknown>;kind:'host'|'local';state:'planned'|'dispatched'|'complete';dispatched?:boolean;status?:OperationReceipt['status']};
export type MutationLease={version:1;commandId:string;clientName?:string;processId:number;startedAt:string;finishedAt?:string;reason?:string;operations:MutationStep[]};
/** Return only identity fields, never arbitrary operation args or paths. */
export function leaseOwner(lease:MutationLease|undefined) {
  if(!lease)return {state:'owner_record_not_yet_available'};
  const root=lease.operations.find(s=>s.commandId===lease.commandId);
  return {clientName:lease.clientName??'unknown (legacy lease)',processId:lease.processId,operationId:lease.commandId,
    command:root?.command??null,startedAt:lease.startedAt,finishedAt:lease.finishedAt??null,
    projectId:root?.args.expectedProjectId??null,sequenceId:root?.args.expectedSequenceId??null,sequenceName:root?.args.expectedSequenceName??null};
}
type LeaseScope={active:boolean;tainted:boolean;record:MutationLease;persist:()=>Promise<void>};
export type RecoveryActions={actions:MutationStep[];record:(step:MutationStep)=>Promise<void>};
async function atomicRecord(file:string,value:unknown){
  const temporary=file+'.'+randomUUID()+'.tmp';
  await writeFile(temporary,JSON.stringify(value),{flag:'wx',flush:true});
  // Windows indexers/readers can briefly retain the destination. Retry only
  // this idempotent atomic file replacement, never its associated host action;
  // leave both records and the quarantine intact if sharing does not clear.
  for(let attempt=0;;attempt++){
    try{await rename(temporary,file);return;}catch(e){
      if(attempt>=5||!['EPERM','EACCES','EBUSY'].includes((e as NodeJS.ErrnoException).code??''))throw e;
      await delay(5*2**attempt);
    }
  }
}
async function recoveryGuard(file:string,commandId:string){
  try{return await open(file,'wx');}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;}
  // On Windows an open creation handle prevents rename (including another
  // contender's new guard). Only a definitely dead owner can leave an
  // unlocked stale file. Unknown/corrupt ownership always remains blocked.
  if(process.platform==='win32'){
    try{
      const previous=JSON.parse(await readFile(file,'utf8'));
      if(previous.commandId!==commandId||!Number.isSafeInteger(previous.processId)||previous.processId<=0)throw Error('RECOVERY_OWNER_UNVERIFIED');
      let dead=false;try{process.kill(previous.processId,0);}catch(e){dead=(e as NodeJS.ErrnoException).code==='ESRCH';}
      if(dead){await rename(file,file+'.abandoned-'+randomUUID());return await open(file,'wx');}
    }catch{/* Failed ownership, or a concurrent holder acquired the path. */}
  }
  throw Error('RECOVERY_ALREADY_IN_PROGRESS');
}
