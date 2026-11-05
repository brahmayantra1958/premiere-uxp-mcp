import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readFile,readdir,rename,stat,unlink,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {bridgeResponseSchema,type BridgeRequest,type BridgeResponse} from '@premiere-uxp/contracts';
import {canonicalizeOperationValue} from './operation-identity.js';

type Identity={id:string;command:string;fingerprint:string;rootOperationId:string};
const fingerprint=(command:string,args:Record<string,unknown>)=>JSON.stringify([command,canonicalizeOperationValue(args)]);
/** Authenticated terminal host responses, separate from rotating audit logs.
 * This is evidence only: no scheduling, replay, automatic success or unlock.
 * The owner runtime flushes it BEFORE acknowledging a leased command. Late
 * replies may be recorded but never settle the already timed-out caller.
 */
export class ExecutionEvidenceStore {
 private writes=0;
 readonly directory:string;
 constructor(private readonly receiptPath:string,private readonly maximum=1000){
  if(!Number.isSafeInteger(maximum)||maximum<1)throw Error('INVALID_EVIDENCE_RETENTION');
  this.directory=receiptPath+'.execution';
 }
 private file(id:string){return path.join(this.directory,createHash('sha256').update(id).digest('hex')+'.json');}
 private async lease(){
  try{return JSON.parse(await readFile(this.receiptPath+'.mutation-lock','utf8'));}
  catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw e;}
 }
 private async actions(){
  try{return JSON.parse(await readFile(this.receiptPath+'.mutation-lock.recovery-actions.json','utf8')).actions??[];}
  catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return [];throw e;}
 }
 async prepare(request:BridgeRequest):Promise<Identity|undefined>{
  const lease=await this.lease();if(!lease)return undefined;
  const step=lease.operations?.find((s:any)=>s.commandId===request.id)??(await this.actions()).find((s:any)=>s.commandId===request.id);
  if(!step||step.kind!=='host'||!step.dispatched)return undefined;
  const expected=fingerprint(step.command,step.args);
  if(step.command!==request.command||expected!==fingerprint(request.command,request.args))throw Error('EXECUTION_EVIDENCE_INTENT_MISMATCH');
  return {id:request.id,command:request.command,fingerprint:expected,rootOperationId:lease.commandId};
 }
 async complete(identity:Identity,response:BridgeResponse):Promise<void>{
  const verified=bridgeResponseSchema.parse(response);if(verified.id!==identity.id)throw Error('EXECUTION_EVIDENCE_RESPONSE_MISMATCH');
  const record={protocol:1,...identity,state:'complete',response:verified,receivedAt:new Date().toISOString()};
  const serialized=JSON.stringify(record);if(Buffer.byteLength(serialized)>9*1024*1024)throw Error('EXECUTION_EVIDENCE_UNBOUNDED');
  await mkdir(this.directory,{recursive:true});const destination=this.file(identity.id),temporary=destination+'.'+randomUUID()+'.tmp';
  await writeFile(temporary,serialized,{flag:'wx',flush:true});await rename(temporary,destination);
  // Retain active/quarantined root steps regardless of age. Do directory work
  // only once per 32 completions, never scan the historical audit on this path.
  if(this.writes++%32===0)await this.prune();
 }
 async find(ids:string[]):Promise<Record<string,any>[]>{
  const rows=[];for(const id of ids){
   try{const file=this.file(id),info=await stat(file);if(info.size>9*1024*1024)throw Error('EXECUTION_EVIDENCE_UNBOUNDED');
    const r=JSON.parse(await readFile(file,'utf8'));
    if(r.protocol!==1||r.id!==id||r.state!=='complete'||typeof r.command!=='string'||typeof r.fingerprint!=='string'||bridgeResponseSchema.parse(r.response).id!==id)throw Error('EXECUTION_EVIDENCE_CORRUPT');
    rows.push({...r,evidenceSource:file});
   }catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  }return rows;
 }
 private async prune(){
  const names=(await readdir(this.directory)).filter(n=>/^[a-f0-9]{64}\.json$/.test(n));if(names.length<=this.maximum)return;
  const lease=await this.lease(),protectedFiles=new Set<string>();
  if(lease)for(const step of [...lease.operations,...await this.actions()])protectedFiles.add(path.basename(this.file(step.commandId)));
  const entries=[];for(const name of names){if(protectedFiles.has(name))continue;try{entries.push({name,mtime:(await stat(path.join(this.directory,name))).mtimeMs});}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}}
  entries.sort((a,b)=>b.mtime-a.mtime||a.name.localeCompare(b.name));
  for(const entry of entries.slice(this.maximum))await unlink(path.join(this.directory,entry.name)).catch(e=>{if(e.code!=='ENOENT')throw e;});
 }
}
export type ExecutionIdentity=Identity;
