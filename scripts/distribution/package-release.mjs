import path from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, lstatSync, copyFileSync, mkdtempSync } from 'node:fs';
import console from 'node:console';
import process from 'node:process';
import { zipDirectory } from '../../installer/lib.mjs';
import {inspectNativePayload} from '../../installer/native-addons.mjs';
import { releasePolicy, portablePackage, releaseBuildInputs } from './release-policy.mjs';
import { validateGuidance, validateReleaseLinks, guidanceManifest, digest } from './guidance-lib.mjs';
import { loadPrivatePatterns, findPrivateData } from './private-patterns.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const args=process.argv.slice(2);
if(args.length&&!(args.length===2&&args[0]==='--native-payload'&&path.isAbsolute(args[1])))throw Error('Usage: package-release.mjs [--native-payload <absolute directory>]');
const nativeDirectory=args[1];
// Adobe rights are independent of this project's license. Default releases are
// source-only; an explicit payload needs hashes, x64 PE validation and evidence.
const nativePayload=nativeDirectory?inspectNativePayload(nativeDirectory):undefined;
const privatePatterns=loadPrivatePatterns(root);
const validation=validateGuidance(root,{privatePatterns}), manifest=guidanceManifest(root), allow=releasePolicy(root);
const releaseRoot=path.join(root,'artifacts/releases');mkdirSync(releaseRoot,{recursive:true});
// Stage an allowlisted source tree. The root agent contract is a portable template,
// never the developer's personal approvals or machine paths. No runtime is stopped.
const stagingRoot=path.join(root,'artifacts/release-staging');mkdirSync(stagingRoot,{recursive:true});
const stage=mkdtempSync(path.join(stagingRoot,'source-'));
function copy(relative='') {
  for(const name of readdirSync(path.join(root,relative)).sort()) {
    const entry=relative?relative+'/'+name:name;if(!allow(entry))continue;
    const from=path.join(root,entry),to=path.join(stage,entry),stat=lstatSync(from);
    if(stat.isSymbolicLink())throw Error('Linked release entry: '+entry);
    if(stat.isDirectory())copy(entry);else if(stat.isFile()){mkdirSync(path.dirname(to),{recursive:true});copyFileSync(from,to);}
  }
}
copy();
for(const file of releaseBuildInputs)if(!lstatSync(path.join(stage,file)).isFile())throw Error('Missing release build input: '+file);
writeFileSync(path.join(stage,'package.json'),JSON.stringify(portablePackage(JSON.parse(readFileSync(path.join(root,'package.json'),'utf8'))),null,2)+'\n');
if(nativePayload) {
  const target=path.join(stage,'installer/native/win-x64');mkdirSync(target,{recursive:true});
  for(const name of ['manifest.json','ADOBE-NOTICES.txt',...nativePayload.files.map(file=>file.name)])copyFileSync(path.join(nativeDirectory,name),path.join(target,name));
  inspectNativePayload(target);
}
// The public sidecar is deliberately regenerated, even if a workstation has
// accidentally personalized its source stub. Build/Setup write only the dist copy.
writeFileSync(path.join(stage,'apps/uxp-plugin/public/deployment-config.js'),"// Replaced locally by Setup. Do not distribute a personalized copy.\nglobalThis.__PREMIERE_MCP_DEPLOYMENT__ = { scratchRoot: '' };\n");
writeFileSync(path.join(stage,'AGENTS.md'),readFileSync(path.join(root,'installer/AGENTS.template.md')));
writeFileSync(path.join(stage,'guidance-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
validateGuidance(stage,{privatePatterns});
// Private vocabulary must not reach any shipped file, not only guidance: the
// release ZIP is also uploaded as a Release asset, outside every Git hook.
const privateData=findPrivateData(stage,privatePatterns);
if(privateData.length)throw Error('Private data in release: '+privateData.slice(0,20).join(', '));
const releaseLinks=validateReleaseLinks(stage);
for(const [file,hash] of Object.entries(manifest.files))if(digest(readFileSync(path.join(stage,file)))!==hash)throw Error('Staged guidance hash differs: '+file);
const filename='premiere-uxp-mcp-'+manifest.packageVersion+(nativePayload?'-source-with-native.zip':'-source.zip');
const destination=path.join(releaseRoot,filename),files=zipDirectory(stage,destination);
const sha256=digest(readFileSync(destination));writeFileSync(destination+'.sha256',sha256+'  '+filename+'\n');
console.log(JSON.stringify({file:destination,stage,files:files.length,sha256,nativePayload:nativePayload?'VERIFIED_FOR_REDISTRIBUTION':'NOT_INCLUDED',privateData:privatePatterns?'PASS':'NOT_CONFIGURED',guidance:validation,releaseLinks}));
