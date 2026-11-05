import { afterEach, beforeEach, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { installationPath, extractSignedZip } from '../../installer/track-lock-helper.mjs';
import { zipDirectory, writeLocalDeployment } from '../../installer/lib.mjs';
let sandbox:string;
beforeEach(()=>{sandbox=mkdtempSync(path.join(os.tmpdir(),'track-lock-install-'));});
afterEach(()=>{rmSync(sandbox,{recursive:true,force:true});});
it('derives each installation from the current user profile',()=>{
  expect(installationPath('win32',{APPDATA:path.join(sandbox,'Another User')},'ignored')).toBe(path.join(sandbox,'Another User','Adobe/CEP/extensions/ai.brahma.yantra.track-lock'));
  expect(installationPath('darwin',{},path.join(sandbox,'Different Mac User'))).toBe(path.join(sandbox,'Different Mac User','Library/Application Support/Adobe/CEP/extensions/ai.brahma.yantra.track-lock'));
});
it('extracts signed ZIP structure and refuses path escape entries',()=>{
  const source=path.join(sandbox,'source'),zip=path.join(sandbox,'helper.zip');mkdirSync(source);writeFileSync(path.join(source,'safe.js'),'fixed code');zipDirectory(source,zip);
  extractSignedZip(zip,path.join(sandbox,'good'));expect(readFileSync(path.join(sandbox,'good/safe.js'),'utf8')).toBe('fixed code');
  const bytes=readFileSync(zip);let cursor=0;while((cursor=bytes.indexOf('safe.js',cursor))>=0){bytes.write('../x.js',cursor);cursor+=7;}writeFileSync(zip,bytes);
  expect(()=>extractSignedZip(zip,path.join(sandbox,'bad'))).toThrow('Path escaped');
});
it('generates deployment without losing another helper and keeps absent lock installation explicit',()=>{
  mkdirSync(path.join(sandbox,'apps/uxp-plugin/dist'),{recursive:true});mkdirSync(path.join(sandbox,'artifacts/runtime'),{recursive:true});
  const read=()=>JSON.parse(readFileSync(path.join(sandbox,'apps/uxp-plugin/dist/deployment-config.js'),'utf8').split(' = ')[1]!.replace(/;\s*$/,''));
  const targeting={port:8098,token:'a'.repeat(64),version:'0.1.2'},locking={port:8095,token:'b'.repeat(64),version:'0.1.0'};
  writeFileSync(path.join(sandbox,'artifacts/runtime/track-targeting-connection.json'),JSON.stringify(targeting));writeLocalDeployment(sandbox);expect(read().trackLock).toBe(null);
  writeFileSync(path.join(sandbox,'artifacts/runtime/track-lock-connection.json'),JSON.stringify(locking));writeLocalDeployment(sandbox);expect(read()).toMatchObject({trackTargeting:targeting,trackLock:locking});
});
