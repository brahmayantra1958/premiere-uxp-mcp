import {afterAll,describe,expect,it} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import path from 'node:path';
import {projectLifecyclePath} from '../../apps/mcp-server/src/project-lifecycle-path.js';
import {assertEditTarget,currentRequestEditTarget,withEditTarget} from '../../apps/mcp-server/src/active-edit-target.js';
import type {PathPolicy} from '../../apps/mcp-server/src/path-policy.js';
mkdirSync(path.resolve('artifacts/scratch'), { recursive: true });
const dir=mkdtempSync(path.resolve('artifacts/scratch/active-target-test-'));
const a=path.join(dir,'a.prproj'),b=path.join(dir,'다른 프로젝트.prproj');
writeFileSync(a,'a');writeFileSync(b,'b');
afterAll(()=>rmSync(dir,{recursive:true,force:true}));
const policy={} as PathPolicy;
const target=(projectPath:string,sequenceId:string)=>({projectPath,projectId:`project-${sequenceId}`,sequenceId,sequenceName:'자유 시퀀스'});
describe('command-local editing targets',()=>{
 it('accepts another saved local project and arbitrary sequence names without redeployment',()=>{
  expect(projectLifecyclePath(policy,a,'일반 이름','a')).toBe(a);
  expect(projectLifecyclePath(policy,b,'another name','b')).toBe(b);
 });
 it('rejects NAS, non-project files, and incomplete sequence identity',()=>{
  expect(()=>projectLifecyclePath(policy,'//Example_nas/data3/source.prproj','a','a')).toThrow('LOCAL_PROJECT_REQUIRED');
  expect(()=>projectLifecyclePath(policy,a+'.txt','a','a')).toThrow('LOCAL_PROJECT_REQUIRED');
  expect(()=>projectLifecyclePath(policy,a,'','a')).toThrow('EXACT_SEQUENCE_REQUIRED');
  expect(()=>assertEditTarget(target(a,'a'),{expectedSequenceId:'b'})).toThrow('COMMAND_EDIT_TARGET_CHANGED');
 });
 it('keeps concurrent callback scopes separate and expires outside a request',async()=>{
  const first=assertEditTarget(target(a,'a')),second=assertEditTarget(target(b,'b'));
  const results=await Promise.all([withEditTarget(first,async()=>{await Promise.resolve();return currentRequestEditTarget();}),withEditTarget(second,async()=>{await Promise.resolve();return currentRequestEditTarget();})]);
  expect(results).toEqual([first,second]);
  expect(()=>currentRequestEditTarget()).toThrow('COMMAND_EDIT_TARGET_REQUIRED');
 });
});
