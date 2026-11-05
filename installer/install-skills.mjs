import {readFileSync,writeFileSync,mkdirSync,existsSync,lstatSync,copyFileSync,unlinkSync} from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import console from 'node:console';
import {randomUUID} from 'node:crypto';
import {fileURLToPath, URL} from 'node:url';
import {guidanceInventory,portableFiles,digest,readJson,validateGuidance} from '../scripts/distribution/guidance-lib.mjs';

const manifestName='.premiere-uxp-mcp-skills.json';
function checkAncestors(filename) {
  for(let item=path.resolve(filename);;item=path.dirname(item)) {
    if(existsSync(item)&&lstatSync(item).isSymbolicLink())throw Error(`Refusing linked skill path: ${item}`);
    if(path.dirname(item)===item)break;
  }
}

/** Only selected bundle files are owned. Unmanaged extras survive; divergent
 * files need an explicit replacement choice and recoverable copies before writes. */
export function installSkills({root,target,apply=false,replaceExisting=false}) {
  validateGuidance(root);
  if(!target||!path.isAbsolute(target))throw Error('An absolute --target skills directory is required');
  checkAncestors(target);
  if(existsSync(target)&&!lstatSync(target).isDirectory())throw Error('Target is not a directory');
  const {bundle}=guidanceInventory(root), changes=[], conflicts=[], desired={};
  const mf=path.join(target,manifestName); checkAncestors(mf);
  const previous=existsSync(mf)?readJson(mf):{schemaVersion:1,skills:{}};
  for(const skill of bundle.skills) {
    const source=path.join(root,'skills',skill.name), destination=path.join(target,skill.name);
    if(path.resolve(source)===path.resolve(destination))throw Error('Cannot install onto the source skill');
    const names=portableFiles(source); desired[skill.name]={version:skill.version,files:{}};
    for(const file of names) {
      const from=path.join(source,file),to=path.join(destination,file); checkAncestors(to);
      const bytes=readFileSync(from),sha=digest(bytes); desired[skill.name].files[file]=sha;
      if(existsSync(to)&&!lstatSync(to).isFile())throw Error(`Not a regular skill file: ${to}`);
      const before=existsSync(to)?digest(readFileSync(to)):null;
      if(before===sha)continue;
      if(before!==null&&before!==previous.skills?.[skill.name]?.files?.[file]&&!replaceExisting)conflicts.push({skill:skill.name,file,reason:'unmanaged or locally modified file'});
      changes.push({skill:skill.name,file,from,to,before,sha});
    }
  }
  const next={schemaVersion:1,bundleVersion:bundle.version,skills:{...previous.skills,...desired}};
  const summary={status:conflicts.length?'CONFLICT':apply?'PASS':'PLANNED',skillCount:bundle.skills.length,changes:changes.map(({skill,file,before,sha})=>({skill,file,before,sha})),conflicts};
  if(!apply||conflicts.length)return summary;
  const manifestText=JSON.stringify(next,null,2)+'\n';
  if(!changes.length&&existsSync(mf)&&readFileSync(mf,'utf8')===manifestText)return {...summary,idempotent:true};
  const backup=path.join(root,'artifacts/skill-install-backups',randomUUID());mkdirSync(backup,{recursive:true});
  const oldManifest=existsSync(mf)?readFileSync(mf):null;
  for(const row of changes)if(row.before!==null){const b=path.join(backup,row.skill,row.file);mkdirSync(path.dirname(b),{recursive:true});copyFileSync(row.to,b);}
  if(oldManifest)writeFileSync(path.join(backup,manifestName),oldManifest);
  writeFileSync(path.join(backup,'plan.json'),JSON.stringify(summary,null,2));
  const written=[];
  try {
    for(const row of changes){const current=existsSync(row.to)?digest(readFileSync(row.to)):null;if(current!==row.before)throw Error(`Skill changed during install: ${row.to}`);mkdirSync(path.dirname(row.to),{recursive:true});written.push(row);copyFileSync(row.from,row.to);}
    mkdirSync(target,{recursive:true});writeFileSync(mf,manifestText);
    for(const [name,skill] of Object.entries(desired))for(const [file,sha] of Object.entries(skill.files))if(digest(readFileSync(path.join(target,name,file)))!==sha)throw Error(`Skill parity failed: ${name}/${file}`);
    return {...summary,backup,verified:true};
  } catch(error) {
    for(const row of written.reverse())if(row.before===null){if(existsSync(row.to))unlinkSync(row.to);}else copyFileSync(path.join(backup,row.skill,row.file),row.to);
    if(oldManifest)writeFileSync(mf,oldManifest);else if(existsSync(mf))unlinkSync(mf);
    throw error;
  }
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2);let target;let apply=false;let replaceExisting=false;
  for(let i=0;i<args.length;i++){if(args[i]==='--target')target=args[++i];else if(args[i]==='--apply')apply=true;else if(args[i]==='--replace-existing')replaceExisting=true;else throw Error(`Unknown argument: ${args[i]}`);}
  const result=installSkills({root:fileURLToPath(new URL('../',import.meta.url)),target,apply,replaceExisting});
  console.log(JSON.stringify(result,null,2));if(result.conflicts.length)process.exitCode=1;
}
