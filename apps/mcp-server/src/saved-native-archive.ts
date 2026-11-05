import {readFile,stat} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {NativeArchiveDocument} from './native-archive-document.js';

/** Filesystem boundary for an already-authorized project path. Every call reads
 * fresh bytes; there is no path/mtime cache. Callers retain their public error
 * code, scope authorization and save/close/reopen transaction ownership. */
async function readBoundedFile(file:string,boundsError:string){
  const info=await stat(file);
  if(!info.isFile()||info.size>48*1024*1024)throw Error(boundsError);
  const bytes=await readFile(file);
  // A file growing after stat must not bypass the same input-size bound.
  if(bytes.length>48*1024*1024)throw Error(boundsError);
  return {bytes,savedAt:info.mtime.toISOString()};
}

/** Fresh compressed bytes for the final optimistic write guard. Deliberately
 * does not inflate or parse: only byte identity is evidence at this boundary. */
export async function readNativeArchiveBytes(file:string,boundsError:string){
  return (await readBoundedFile(file,boundsError)).bytes;
}

/** One bounded read/decompression produces one immutable parsing lifetime.
 * Save, patch and reopen callers must acquire a new document afterward. */
export async function readNativeArchiveFile(file:string,boundsError:string,encoding:'auto'|'gzip'='auto'){
  const {bytes,savedAt}=await readBoundedFile(file,boundsError);
  const xml=(encoding==='gzip'||bytes[0]===31?gunzipSync(bytes,{maxOutputLength:256*1024*1024}):bytes).toString('utf8');
  return {bytes,xml,savedAt,document:new NativeArchiveDocument(xml)};
}
