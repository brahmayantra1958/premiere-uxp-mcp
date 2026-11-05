import {describe,it,expect} from 'vitest';
import {mkdir,readFile,readdir,rename,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {AtomicJsonFileWriter} from '../../apps/mcp-server/src/atomic-json-file.js';
import {freshTestDirectory} from '../helpers/workspace.js';

const fault=(code:string)=>Object.assign(new Error(code),{code});
describe('atomic JSON replacement without replaying its producer',()=>{
 it('retries the exact flushed temporary rename on transient Windows sharing errors',async()=>{
  const dir=await freshTestDirectory('atomic-json-transient'),file=path.join(dir,'job.json');await writeFile(file,'{"old":true}');
  const delays:number[]=[],sources:string[]=[];
  const writer=new AtomicJsonFileWriter({platform:'win32',delay:async ms=>{delays.push(ms);},rename:async(from,to)=>{
   sources.push(String(from));expect(await readFile(file,'utf8')).toBe('{"old":true}');
   if(sources.length<3)throw fault(sources.length===1?'EPERM':'EBUSY');await rename(from,to);
  }});
  await writer.write(file,{completedSteps:8});expect(delays).toEqual([10,20]);expect(new Set(sources).size).toBe(1);
  expect(JSON.parse(await readFile(file,'utf8'))).toEqual({completedSteps:8});expect(await readdir(dir)).toEqual(['job.json']);
 });
 it.each(['EPERM','EACCES','EBUSY'])('bounds permanent %s retries, preserves the old record and removes only its own temp',async code=>{
  const dir=await freshTestDirectory('atomic-json-'+code),file=path.join(dir,'job.json');await writeFile(file,'{"old":true}');await writeFile(path.join(dir,'unrelated.tmp'),'keep');let attempts=0;
  const writer=new AtomicJsonFileWriter({platform:'win32',delay:async()=>{},rename:async()=>{attempts++;throw fault(code);}});
  await expect(writer.write(file,{new:true})).rejects.toMatchObject({code});expect(attempts).toBe(7);
  expect(await readFile(file,'utf8')).toBe('{"old":true}');expect((await readdir(dir)).sort()).toEqual(['job.json','unrelated.tmp']);
 });
 it('does not retry unrelated errors or POSIX permission denial',async()=>{
  for(const [platform,code] of [['win32','ENOSPC'],['linux','EPERM']] as const){
   const dir=await freshTestDirectory('atomic-json-'+platform+code);let attempts=0;
   const writer=new AtomicJsonFileWriter({platform,delay:async()=>{},rename:async()=>{attempts++;throw fault(code);}});
   await expect(writer.write(path.join(dir,'job.json'),{})).rejects.toMatchObject({code});expect(attempts).toBe(1);expect(await readdir(dir)).toEqual([]);
  }
 });
 it('serializes the same destination across writers and snapshots each invocation',async()=>{
  const dir=await freshTestDirectory('atomic-json-concurrent'),file=path.join(dir,'job.json'),seen:unknown[]=[],sources:string[]=[];
  let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(resolve=>release=resolve),ready=new Promise<void>(resolve=>entered=resolve);
  const one=new AtomicJsonFileWriter({rename:async(from,to)=>{entered();await gate;sources.push(String(from));seen.push(JSON.parse(await readFile(from,'utf8')));await rename(from,to);}});
  const two=new AtomicJsonFileWriter({rename:async(from,to)=>{sources.push(String(from));seen.push(JSON.parse(await readFile(from,'utf8')));await rename(from,to);}});
  const first=one.write(file,{revision:1}),value={revision:2},second=two.write(file,value);value.revision=99;
  await ready;expect(seen).toEqual([]);release();await Promise.all([first,second]);
  expect(seen).toEqual([{revision:1},{revision:2}]);expect(new Set(sources).size).toBe(2);expect(JSON.parse(await readFile(file,'utf8'))).toEqual({revision:2});
 });
 it('refuses a directory destination without replacing it',async()=>{
  const dir=await freshTestDirectory('atomic-json-directory'),file=path.join(dir,'job.json');await mkdir(file);await writeFile(path.join(file,'preserved'),'keep');
  await expect(new AtomicJsonFileWriter().write(file,{})).rejects.toThrow('NOT_REGULAR');expect(await readFile(path.join(file,'preserved'),'utf8')).toBe('keep');
 });
});
