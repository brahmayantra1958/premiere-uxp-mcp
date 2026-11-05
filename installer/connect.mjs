import path from 'node:path';
import process from 'node:process';
import console from 'node:console';
import {spawnSync} from 'node:child_process';
import {fileURLToPath,URL} from 'node:url';
import {readJson,writeJson} from './lib.mjs';

export function verifyConnection(result,{root,panelVersion}) {
  if(result?.status!=='ready')throw Error('Premiere connection is not ready');
  const deployment=result.premiere?.deployment;
  const comparable=value=>{const normalized=path.resolve(value);return process.platform==='win32'?normalized.toLowerCase():normalized;};
  if(deployment?.panelVersion!==panelVersion||deployment?.panelMode!=='agent')throw Error('Loaded panel version/mode does not match this installation');
  if(typeof deployment.localScratchRoot!=='string'||comparable(deployment.localScratchRoot)!==comparable(path.join(root,'artifacts/scratch')))throw Error('Loaded panel belongs to a different installation');
  return {status:'PASS',panelVersion,installationRoot:root,projectPath:result.projectPath,sequenceName:result.sequenceName,editing:'UNVERIFIED'};
}

/** Read-only orientation plus explicit local pairing; never creates or edits a sequence. */
export function connectInstallation({root,node=process.execPath}) {
  const receiptFile=path.join(root,'artifacts/install/connection.json');
  try {
    const executed=spawnSync(node,[path.join(root,'apps/mcp-server/dist/runtime-cli.js'),'ready','--pair'],{cwd:root,encoding:'utf8',windowsHide:true,maxBuffer:4*1024*1024,timeout:120000});
    if(executed.error||executed.status!==0)throw Error(executed.error?.message||executed.stderr.trim()||'Connection verification failed');
    const result=JSON.parse(executed.stdout);
    const verified=verifyConnection(result,{root,panelVersion:readJson(path.join(root,'apps/uxp-plugin/package.json')).version});
    writeJson(receiptFile,verified);return verified;
  } catch(error) {writeJson(receiptFile,{status:'FAILED',editing:'UNVERIFIED',error:String(error)});throw error;}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  if(process.argv.length>2)throw Error('Connect does not accept arguments');
  console.log(JSON.stringify(connectInstallation({root:fileURLToPath(new URL('../',import.meta.url))}),null,2));
}
