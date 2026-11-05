import {randomUUID} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {z} from 'zod/v4';
import {AtomicJsonFileWriter} from './atomic-json-file.js';
import type {EffectSequenceJob} from './effect-command-sequence.js';

/** One runtime owns execution. Records (including failure witnesses) are for
 * inspection only and never authorize replay after restart. */
export class EffectJobStore{
 constructor(private readonly directory:string,private readonly writer=new AtomicJsonFileWriter()){}
 private file(id:string){z.string().uuid().parse(id);return path.join(this.directory,id+'.json');}
 persist(job:EffectSequenceJob){return this.writer.write(this.file(job.id),job);}
 async recordFailure(job:EffectSequenceJob){
  this.file(job.id);
  // A uniquely named, immutable witness can survive a lock on the main target.
  // It is still fallible; the caller reports whether this write actually passed.
  await this.writer.write(path.join(this.directory,job.id+'.failures',randomUUID()+'.json'),{...job,persistenceFailure:{...job.persistenceFailure,journal:'recorded'}});
 }
 async load(id:string):Promise<unknown>{
  const file=this.file(id);let main:any;
  try{main=JSON.parse(await readFile(file,'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  let names:string[];
  try{names=await readdir(path.join(this.directory,id+'.failures'));}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return main;throw error;}
  const failures=[];
  for(const name of names.filter(name=>/^[a-f0-9-]{36}\.json$/.test(name))){
   const record=JSON.parse(await readFile(path.join(this.directory,id+'.failures',name),'utf8'));
   if(record.id!==id||record.persistenceFailure?.journal!=='recorded'||record.state!=='unverified')throw Error('JOB_FAILURE_RECORD_CORRUPT');
   failures.push(record);
  }
  failures.sort((a,b)=>String(b.completedAt??b.persistenceFailure.at).localeCompare(String(a.completedAt??a.persistenceFailure.at)));
  const failure=failures[0];if(!failure)return main;
  // A final main record containing the same failure is newer than its witness.
  // A stale queued/running/pass main record must not hide a persistence failure.
  if(main?.persistenceFailure?.at===failure.persistenceFailure.at&&main.completedAt)return main;
  return failure;
 }
}
