import {createHash} from 'node:crypto';
import {mkdir,readFile,stat,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {runtimePaths} from './config.js';
import type {PathPolicy} from './path-policy.js';
import {parseCaptionSrt} from './caption-inspection.js';

/** SRT uses the same scoped source/extension/link policy as media. Only an
 * immutable repository copy is passed to the create-only helper. */
export async function readCaptionSrt(candidate:string,paths:PathPolicy,copy=false) {
  const canonical=paths.authorizeRead(candidate).path;
  if(path.extname(canonical).toLowerCase()!=='.srt')throw Error('SRT_EXTENSION_REQUIRED');
  if((await stat(canonical)).size>5*1024*1024)throw Error('SRT_EXCEEDS_5_MIB');
  const bytes=await readFile(canonical);
  if(bytes.length>5*1024*1024)throw Error('SRT_EXCEEDS_5_MIB');
  const source=new TextDecoder('utf-8',{fatal:true}).decode(bytes),cues=parseCaptionSrt(source);
  const sha256=createHash('sha256').update(bytes).digest('hex');
  let scratchPath:string|undefined;
  if(copy){
    const root=path.join(runtimePaths.scratch,'caption-inputs');await mkdir(root,{recursive:true});
    scratchPath=path.join(root,sha256+'.srt');
    try{await writeFile(scratchPath,bytes,{flag:'wx'});}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw e;}
    if(!(await readFile(scratchPath)).equals(bytes))throw Error('SRT_SCRATCH_HASH_MISMATCH');
  }
  return {sourcePath:canonical,sha256,bytes:bytes.length,cues,scratchPath};
}
