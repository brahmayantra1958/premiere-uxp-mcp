import { appendFile, mkdir, readdir, readFile, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";
import {canonicalizeOperationValue} from './operation-identity.js';
import {editPlanSchema,type EditPlan} from '@premiere-uxp/contracts';
export { ReceiptStore } from "./receipt-store.js";
export type AuditRetentionPolicy = Readonly<{
  maxBytesPerSegment: number;
  retainedSegments: number;
}>;

const DEFAULT_AUDIT_RETENTION: AuditRetentionPolicy = {
  maxBytesPerSegment: 32 * 1024 * 1024,
  retainedSegments: 3,
};


export class AuditLog {
  private readonly retention: AuditRetentionPolicy;
  private pendingAppend: Promise<void> = Promise.resolve();
  private segmentSequence = 0;

  constructor(private readonly filePath: string, retention: Partial<AuditRetentionPolicy> = {}) {
    this.retention = { ...DEFAULT_AUDIT_RETENTION, ...retention };
    if (!Number.isSafeInteger(this.retention.maxBytesPerSegment) || this.retention.maxBytesPerSegment <= 0) {
      throw new Error("Audit maxBytesPerSegment must be a positive safe integer");
    }
    if (!Number.isSafeInteger(this.retention.retainedSegments) || this.retention.retainedSegments < 0) {
      throw new Error("Audit retainedSegments must be a non-negative safe integer");
    }
  }

  async append(record: unknown): Promise<void> {
    const serialized = `${JSON.stringify(record)}\n`;
    const append = this.pendingAppend.then(() => this.appendSerialized(serialized));
    // Preserve caller-visible failures without leaving the internal queue rejected.
    this.pendingAppend = append.then(() => undefined, () => undefined);
    return append;
  }

  /** Legacy recovery baseline: exact write-ahead plan, never the nearest read or
   * an agent-supplied snapshot. Missing/rotated evidence cannot release a lease. */
  async relocationPlanEvidence(commandId:string):Promise<EditPlan|undefined>{
    const directory=path.dirname(this.filePath),extension=path.extname(this.filePath),basename=path.basename(this.filePath,extension);
    const names=(await readdir(directory)).filter(n=>n!==path.basename(this.filePath)&&n.startsWith(basename+'.')&&n.endsWith(extension)).sort().reverse().slice(0,this.retention.retainedSegments);
    let found:EditPlan|undefined;
    for(const file of [this.filePath,...names.map(n=>path.join(directory,n))]){
      if((await stat(file)).size>48*1024*1024)throw Error('RECOVERY_AUDIT_SEGMENT_UNBOUNDED');
      for(const line of (await readFile(file,'utf8')).split('\n')){
        if(!line.includes(commandId))continue;
        let row:any;try{row=JSON.parse(line);}catch{continue;}
        if(row.kind!=='plan'||row.commandId!==commandId)continue;
        const plan=editPlanSchema.parse(row.plan);
        if(found&&JSON.stringify(found)!==JSON.stringify(plan))throw Error('RECOVERY_PLAN_CONFLICT');
        found=plan;
      }
    }
    return found;
  }

  /** Exact output ID plus a pre-crash creation receipt supplies the source
   * range. Missing, ambiguous or rotated evidence cannot release a lease. */
  async subclipCreationEvidence(projectItemId:string,before:string){
    const directory=path.dirname(this.filePath),extension=path.extname(this.filePath),base=path.basename(this.filePath,extension);
    const names=(await readdir(directory)).filter(n=>n!==path.basename(this.filePath)&&n.startsWith(base+'.')&&n.endsWith(extension)).sort().reverse().slice(0,this.retention.retainedSegments);
    let found:any;
    for(const file of [this.filePath,...names.map(n=>path.join(directory,n))]){
      if((await stat(file)).size>48*1024*1024)throw Error('RECOVERY_AUDIT_SEGMENT_UNBOUNDED');
      for(const line of (await readFile(file,'utf8')).split('\n')){
        if(!line.includes(projectItemId))continue;
        let row:any;try{row=JSON.parse(line);}catch{continue;}
        if(row.kind!=='mutation'||row.request?.command!=='create_subclip'||row.receipt?.after?.created?.id!==projectItemId||
          !(row.receipt.completedAt<before))continue;
        if(found&&JSON.stringify(found)!==JSON.stringify(row))throw Error('RECOVERY_SUBCLIP_EVIDENCE_CONFLICT');
        found=row;
      }
    }
    return found;
  }

  /** Find a prior successful native track vector tied to its write-ahead
   * project/sequence plan. Missing or rotated evidence remains unrecoverable. */
  async trackStateBaselineBefore(before:string,projectId:string,sequenceId:string){
    const directory=path.dirname(this.filePath),extension=path.extname(this.filePath),basename=path.basename(this.filePath,extension);
    const names=(await readdir(directory)).filter(n=>n!==path.basename(this.filePath)&&n.startsWith(basename+'.')&&n.endsWith(extension)).sort().reverse().slice(0,this.retention.retainedSegments);
    const plans=new Map<string,any>(),receipts:any[]=[];
    for(const file of [this.filePath,...names.map(n=>path.join(directory,n))]){
      if((await stat(file)).size>48*1024*1024)throw Error('RECOVERY_AUDIT_SEGMENT_UNBOUNDED');
      for(const line of (await readFile(file,'utf8')).split('\n')){
        if(!line.includes('set_track_state'))continue;
        let row:any;try{row=JSON.parse(line);}catch{continue;}
        if(row.kind==='plan'&&row.plan?.operations?.length===1&&row.plan.operations[0].command==='set_track_state')plans.set(row.commandId,row.plan);
        if(row.kind==='mutation'&&row.request?.command==='set_track_state'&&row.receipt?.status==='pass'&&row.receipt.commandId===row.request.id&&row.receipt.completedAt<before)receipts.push(row);
      }
    }
    for(const row of receipts.sort((a,b)=>b.receipt.completedAt.localeCompare(a.receipt.completedAt))){
      const p=plans.get(row.request.id),a=row.receipt.after;
      if(p?.baseProjectId===projectId&&p.baseSequenceId===sequenceId&&a?.id===sequenceId&&a.name===p.workingSequenceName&&Array.isArray(a.tracks)&&JSON.stringify(canonicalizeOperationValue(p.operations[0].args))===JSON.stringify(canonicalizeOperationValue(row.request.args)))
        return {commandId:row.request.id,projectId,sequenceId,sequenceName:a.name,tracks:a.tracks};
    }
    throw Error('RECOVERY_TRACK_BASELINE_MISSING');
  }

  /** Only authenticated terminal responses already observed by this server
   * survive panel recreation. A receipt saying UNVERIFIED is never promoted
   * into a witness. Bounded scan runs only during explicit recovery. */
  async terminalExecutionEvidence(ids:string[]):Promise<Record<string,any>[]> {
    const wanted=new Set(ids),found=new Map<string,Record<string,any>>();
    const directory=path.dirname(this.filePath),extension=path.extname(this.filePath),basename=path.basename(this.filePath,extension);
    let names:string[];try{names=(await readdir(directory)).filter(n=>n!==path.basename(this.filePath)&&n.startsWith(basename+'.')&&n.endsWith(extension)).sort().reverse().slice(0,this.retention.retainedSegments);}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return [];throw e;}
    for(const file of [this.filePath,...names.map(n=>path.join(directory,n))]){
      let bytes:Buffer;try{if((await stat(file)).size>48*1024*1024)throw Error('RECOVERY_AUDIT_SEGMENT_UNBOUNDED');bytes=await readFile(file);}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')continue;throw e;}
      const lines=bytes.toString('utf8').split('\n');
      for(let i=lines.length-1;i>=0;i--){
        let row:any;try{row=JSON.parse(lines[i]!);}catch{continue;}
        const candidates=row.kind==='read'&&row.request?.command==='inspect_command_execution'&&row.response?.ok&&row.response.result?.protocol===1
          ?row.response.result.commands??[]
          :row.kind==='recovery-verification'&&row.response?.id?[{id:row.response.id,state:'complete',command:row.command,fingerprint:JSON.stringify([row.command,canonicalizeOperationValue(row.args)]),response:row.response}]:[];
        for(const candidate of candidates)if(wanted.has(candidate.id)&&!found.has(candidate.id)&&candidate.state==='complete'&&candidate.response?.id===candidate.id)found.set(candidate.id,{...candidate,evidenceSource:file});
      }
      if(found.size===wanted.size)break;
    }
    return [...found.values()];
  }

  private async appendSerialized(serialized: string): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await this.rotateIfRequired(Buffer.byteLength(serialized, "utf8"));
    await appendFile(this.filePath, serialized, {encoding:'utf8',flush:true});
  }

  private async rotateIfRequired(incomingBytes: number): Promise<void> {
    let currentBytes = 0;
    try {
      currentBytes = (await stat(this.filePath)).size;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (currentBytes === 0 || currentBytes + incomingBytes <= this.retention.maxBytesPerSegment) return;

    const extension = path.extname(this.filePath);
    const basename = path.basename(this.filePath, extension);
    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "");
    const sequence = String(this.segmentSequence += 1).padStart(4, "0");
    const archivedPath = path.join(path.dirname(this.filePath), `${basename}.${stamp}.${sequence}${extension}`);
    await rename(this.filePath, archivedPath);
    await this.pruneArchivedSegments(basename, extension);
  }

  private async pruneArchivedSegments(basename: string, extension: string): Promise<void> {
    const names = (await readdir(path.dirname(this.filePath)))
      .filter((name) => name.startsWith(`${basename}.`) && name.endsWith(extension))
      .sort();
    const excess = Math.max(0, names.length - this.retention.retainedSegments);
    for (const name of names.slice(0, excess)) {
      await unlink(path.join(path.dirname(this.filePath), name));
    }
  }
}
