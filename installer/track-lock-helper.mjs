import { existsSync, readFileSync, writeFileSync, mkdirSync, cpSync, rmSync, lstatSync, chmodSync } from 'node:fs';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { inflateRawSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import process from 'node:process';
import console from 'node:console';
import { premiereIsRunning, readJson, writeJson, writeLocalDeployment } from './lib.mjs';

export const extensionId = 'ai.brahma.yantra.track-lock';
export function installationPath(platform, environment, home) {
  if (platform === 'win32' && environment.APPDATA) return path.join(environment.APPDATA, 'Adobe/CEP/extensions', extensionId);
  if (platform === 'darwin') return path.join(home, 'Library/Application Support/Adobe/CEP/extensions', extensionId);
  throw Error('Track lock helper installation requires Windows or macOS and a valid user profile');
}
function child(candidate, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw Error(`Path escaped declared root: ${candidate}`);
}
/** Extract only our signer-produced, bounded ZIP. No shell strings or zip-slip. */
export function extractSignedZip(filename, destination) {
  const data = readFileSync(filename);
  if (data.length > 16 * 1024 * 1024) throw Error('Helper package exceeds bound');
  let end = data.length - 22;
  while (end >= Math.max(0, data.length - 65557) && data.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0 || data.readUInt32LE(end) !== 0x06054b50) throw Error('ZIP directory missing');
  const count = data.readUInt16LE(end + 10); let offset = data.readUInt32LE(end + 16), total = 0;
  if (count > 32) throw Error('Unexpected helper file count');
  const names = new Set();
  for (let i = 0; i < count; i++) {
    if (data.readUInt32LE(offset) !== 0x02014b50) throw Error('Invalid ZIP directory');
    const method = data.readUInt16LE(offset + 10), size = data.readUInt32LE(offset + 20), expanded = data.readUInt32LE(offset + 24);
    const length = data.readUInt16LE(offset + 28), extra = data.readUInt16LE(offset + 30), comment = data.readUInt16LE(offset + 32), local = data.readUInt32LE(offset + 42);
    const name = data.subarray(offset + 46, offset + 46 + length).toString('utf8');
    const target = path.resolve(destination, name); child(target, destination);
    if (name.includes('\\') || name.includes(':') || name.split('/').includes('..') || names.has(name) || ![0,8].includes(method) || expanded > 1024 * 1024 || (total += expanded) > 4 * 1024 * 1024 || data.readUInt16LE(offset + 8) & 1 || ((data.readUInt32LE(offset + 38) >>> 16) & 0o170000) === 0o120000) throw Error('Unsafe helper ZIP entry');
    names.add(name);
    if (data.readUInt32LE(local) !== 0x04034b50) throw Error('Invalid ZIP local header');
    const start = local + 30 + data.readUInt16LE(local + 26) + data.readUInt16LE(local + 28);
    if (start + size > data.length) throw Error('Truncated helper ZIP');
    const packed = data.subarray(start, start + size), bytes = method === 8 ? inflateRawSync(packed, { maxOutputLength: 1024 * 1024 }) : packed;
    if (bytes.length !== expanded) throw Error('Helper ZIP size mismatch');
    if (name.endsWith('/')) mkdirSync(target, { recursive: true });
    else { mkdirSync(path.dirname(target), { recursive: true }); writeFileSync(target, bytes, { flag: 'wx', mode: 0o600 }); }
    offset += 46 + length + extra + comment;
  }
}

export async function installTrackLockHelper({ root, apply = false }) {
  const platform = process.platform;
  const destination = installationPath(platform, process.env, os.homedir()), extensionsRoot = path.dirname(destination);
  child(destination, extensionsRoot);
  if (apply) {
    const probe = platform === 'win32' ? spawnSync('tasklist.exe', ['/FI', 'IMAGENAME eq Adobe Premiere Pro.exe', '/FO', 'CSV', '/NH'], {encoding:'utf8',windowsHide:true}) : spawnSync('/bin/ps', ['-ax','-o','comm='], {encoding:'utf8'});
    if (probe.status !== 0 || probe.error || premiereIsRunning(probe.stdout, platform)) throw Error('Save and quit Premiere before installing this helper. The installer never closes the editor.');
    if (existsSync(destination) && lstatSync(destination).isSymbolicLink()) throw Error('Helper destination is a link');
  }
  const runRoot = path.join(root, 'artifacts/cep-track-lock-deployment', randomUUID()), staging = path.join(runRoot, 'unsigned'), verified = path.join(runRoot, 'verified');
  mkdirSync(staging, {recursive:true});
  const connectionFile = path.join(root, 'artifacts/runtime/track-lock-connection.json');
  const token = existsSync(connectionFile) ? readJson(connectionFile).token : randomBytes(32).toString('hex');
  if (!/^[a-f0-9]{64}$/.test(token)) throw Error('Invalid local track lock credential');
  const connection = {port:8095,token,version:'0.1.0'};
  for (const file of ['CSXS/manifest.xml','host/locks.jsx','index.html','client.js','service.cjs']) {
    const source = path.join(root, 'apps/cep-track-lock', file);
    if (lstatSync(source).isSymbolicLink()) throw Error('Helper source is a link');
    mkdirSync(path.dirname(path.join(staging,file)), {recursive:true});cpSync(source,path.join(staging,file));
  }
  writeFileSync(path.join(staging,'config.js'), 'window.BrahmaYantraTrackLockConfig = ' + JSON.stringify({...connection,extensionId,installation:destination,repositoryRoot:root}) + ';\n', {mode:0o600});
  const signerInfo = platform === 'win32'
    ? {directory:'x64',filename:'ZXPSignCmd.exe',sha256:'ffc2223167225ce61d024eb463fc5ad1a1be16133f99ef334a646f7311916c98'}
    : {directory:'macOS',filename:'ZXPSignCmd',sha256:'bc773fae0b97416fc7a462e7dadcc00270428a9913480c9b78b5606ff1cfb095'};
  const signer = path.join(root,'artifacts/tools/ZXPSignCmd-4.1.3',signerInfo.directory,signerInfo.filename);
  if (!existsSync(signer)) {
    const response = await globalThis.fetch(`https://raw.githubusercontent.com/Adobe-CEP/CEP-Resources/master/ZXPSignCMD/4.1.3/${signerInfo.directory}/${signerInfo.filename}`);
    if (!response.ok) throw Error(`Adobe signer download HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (createHash('sha256').update(bytes).digest('hex') !== signerInfo.sha256) throw Error('Adobe signer hash mismatch');
    mkdirSync(path.dirname(signer),{recursive:true});writeFileSync(signer,bytes,{mode:0o700});
  }
  if (createHash('sha256').update(readFileSync(signer)).digest('hex') !== signerInfo.sha256) throw Error('Adobe signer hash mismatch');
  if (platform === 'darwin') chmodSync(signer,0o700);
  const password = randomBytes(32).toString('hex'), certificate = path.join(runRoot,'ephemeral.p12'), archive = path.join(runRoot,extensionId+'.zxp');
  const sign = args => {
    const execution = spawnSync(signer,args,{encoding:'utf8',windowsHide:true});
    const output = `${execution.stdout??''}\n${execution.stderr??''}`.replaceAll(password,'[redacted]');
    if (execution.error || execution.status !== 0) throw Error(`Adobe signing failed: ${String(execution.error??output)}${platform === 'darwin' ? '; the Adobe 4.1.3 macOS signer is Intel and requires Rosetta on Apple Silicon. No Gatekeeper/security setting is changed.' : ''}`);
    return output.trim();
  };
  let packageVerification;
  try {
    sign(['-selfSignedCert','KR','Seoul','Local Premiere Tools','Track lock helper',password,certificate,'-validityDays','3650']);
    sign(['-sign',staging,archive,certificate,password]);packageVerification=sign(['-verify',archive]);
  } finally { if(existsSync(certificate))rmSync(certificate); }
  extractSignedZip(archive,verified);
  let directoryVerification=sign(['-verify',verified]);
  if (apply) {
    const backup=path.join(runRoot,'previous-installation');
    const sidecar=path.join(root,'apps/uxp-plugin/dist/deployment-config.js');
    const originalConnection=existsSync(connectionFile)?readFileSync(connectionFile):undefined;
    const originalSidecar=existsSync(sidecar)?readFileSync(sidecar):undefined;
    if(existsSync(destination))cpSync(destination,backup,{recursive:true});
    let destinationTouched = false;
    try {
      child(destination,extensionsRoot);
      destinationTouched = true;
      if(existsSync(destination))rmSync(destination,{recursive:true});
      cpSync(verified,destination,{recursive:true});directoryVerification=sign(['-verify',destination]);
      writeJson(connectionFile,connection);
      if(originalSidecar)writeLocalDeployment(root);
    }catch(error){
      if(destinationTouched){
        child(destination,extensionsRoot);if(existsSync(destination))rmSync(destination,{recursive:true});if(existsSync(backup))cpSync(backup,destination,{recursive:true});
        if(originalConnection)writeFileSync(connectionFile,originalConnection);else if(existsSync(connectionFile))rmSync(connectionFile);
        if(originalSidecar)writeFileSync(sidecar,originalSidecar);
      }
      throw error;
    }
  }
  const receipt={status:apply?'INSTALLED':'PREPARED',extensionId,version:'0.1.0',destination,packagePath:archive,packageSha256:createHash('sha256').update(readFileSync(archive)).digest('hex'),packageVerification,directoryVerification,registryChanged:false,privateKeyRetained:false,port:8095,livePremiere:'UNVERIFIED'};
  writeJson(path.join(runRoot,'deployment.json'),receipt);return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2);
  if(args.some(a=>!['--prepare-only','--apply'].includes(a)) || args.includes('--apply')&&args.includes('--prepare-only'))throw Error('Use --prepare-only (default) or --apply');
  console.log(JSON.stringify(await installTrackLockHelper({root:fileURLToPath(new URL('../',import.meta.url)),apply:args.includes('--apply')}),null,2));
}
