import {existsSync,readFileSync,writeFileSync,mkdirSync,lstatSync,renameSync,unlinkSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import process from 'node:process';
import console from 'node:console';
import {randomUUID,createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {fileURLToPath,URL} from 'node:url';
import {parse as parseToml} from 'smol-toml';
import {installSkills} from './install-skills.mjs';
import {mcpConfiguration,writeJson} from './lib.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const canonical=value=>JSON.stringify(value,(_key,child)=>object(child)?Object.fromEntries(Object.entries(child).sort(([a],[b])=>a.localeCompare(b))):child);
const serverHash=value=>value===undefined?null:hash(canonical(value));

function safePath(filename) {
  if(!path.isAbsolute(filename))throw Error('Client configuration and skills paths must be absolute');
  for(let cursor=path.resolve(filename);;cursor=path.dirname(cursor)) {
    if(existsSync(cursor)&&lstatSync(cursor).isSymbolicLink())throw Error('Linked client/skills path refused: '+cursor);
    if(path.dirname(cursor)===cursor)break;
  }
}

export const CLIENTS=['codex','claude','gemini'];

export function clientLocations(client,{home=os.homedir(),environment=process.env,config,skillsTarget}={}) {
  if(!CLIENTS.includes(client))throw Error('Client must be codex, claude or gemini');
  const codexHome=environment.CODEX_HOME||path.join(home,'.codex');
  const claudeHome=environment.CLAUDE_CONFIG_DIR||path.join(home,'.claude');
  // Antigravity, the current Gemini app and CLI, reads one global MCP file and global
  // skills under ~/.gemini/config (antigravity.google/docs/mcp and /docs/skills).
  const geminiHome=path.join(home,'.gemini','config');
  const defaults={
    codex:{config:path.join(codexHome,'config.toml'),skillsTarget:path.join(home,'.agents/skills')},
    claude:{config:environment.CLAUDE_CONFIG_DIR?path.join(claudeHome,'.claude.json'):path.join(home,'.claude.json'),skillsTarget:path.join(claudeHome,'skills')},
    gemini:{config:path.join(geminiHome,'mcp_config.json'),skillsTarget:path.join(geminiHome,'skills')},
  }[client];
  const result={client,config:config||defaults.config,skillsTarget:skillsTarget||defaults.skillsTarget};
  safePath(result.config);safePath(result.skillsTarget);return result;
}

function decodeHeader(header) {
  let value=parseToml(header+'\n__premiere_header_probe__ = true\n'),keys=[];
  while(object(value)&&!Object.hasOwn(value,'__premiere_header_probe__')) {
    const entries=Object.entries(value);if(entries.length!==1)return [];
    keys.push(entries[0][0]);value=entries[0][1];if(Array.isArray(value))value=value[0];
  }
  return keys;
}

/** Parse first, splice only explicit premiere table blocks, then compare every
 * unrelated value. Prefix parsing rejects apparent headers inside TOML strings.
 * Inline/dotted premiere declarations are refused instead of rewriting a file. */
export function mergeCodexConfiguration(text,server) {
  const bom=text.startsWith('\uFEFF')?'\uFEFF':'';if(bom)text=text.slice(1);
  const before=parseToml(text),headers=[];
  if(before.mcp_servers!==undefined&&!object(before.mcp_servers))throw Error('mcp_servers must be a table');
  for(const match of text.matchAll(/^[\t ]*(\[\[?[^\r\n]+?\]\]?)[\t ]*(?:#[^\r\n]*)?(?:\r?\n|$)/gm)) {
    try {parseToml(text.slice(0,match.index));headers.push({start:match.index,keys:decodeHeader(match[1])});} catch { /* Not a top-level table header. */ }
  }
  const owned=headers.filter(row=>row.keys[0]==='mcp_servers'&&row.keys[1]==='premiere');
  if(before.mcp_servers?.premiere!==undefined&&!owned.length)throw Error('Inline/dotted premiere configuration cannot be safely replaced; use an explicit [mcp_servers.premiere] table');
  let retained='',cursor=0;
  for(const row of owned) {
    const index=headers.indexOf(row),end=headers[index+1]?.start??text.length;
    retained+=text.slice(cursor,row.start);cursor=end;
  }
  retained+=text.slice(cursor);
  const eol=text.includes('\r\n')?'\r\n':'\n';
  const block=['[mcp_servers.premiere]',`command = ${JSON.stringify(server.command)}`,`args = ${JSON.stringify(server.args)}`,'[mcp_servers.premiere.env]',`PREMIERE_MCP_PROFILE = ${JSON.stringify(server.env.PREMIERE_MCP_PROFILE)}`,''].join(eol);
  const updated=retained+(retained&&!retained.endsWith('\n')?eol:'')+(retained?eol:'')+block;
  let after;try {after=parseToml(updated);} catch {throw Error('This TOML layout cannot accept a scoped premiere table; leave it unchanged and register through the client CLI');}
  const without=value=>{const copy={...value};if(copy.mcp_servers){copy.mcp_servers={...copy.mcp_servers};delete copy.mcp_servers.premiere;if(!Object.keys(copy.mcp_servers).length)delete copy.mcp_servers;}return copy;};
  // smol-toml tables intentionally use a null prototype; compare the generated
  // server's data, while retaining strict date/value checks for unrelated data.
  if(!isDeepStrictEqual(without(before),without(after))||canonical(after.mcp_servers.premiere)!==canonical(server))throw Error('Codex merge did not preserve unrelated settings');
  return {text:bom+updated,previous:before.mcp_servers?.premiere};
}

/** JSON clients keep stdio servers under mcpServers. Only the premiere entry is
 * replaced; every other server and setting, the BOM and the line ending survive. */
function mergeJsonConfiguration(text,desired,label) {
  const bom=text.startsWith('\uFEFF')?'\uFEFF':'';if(bom)text=text.slice(1);
  const before=text.trim()?JSON.parse(text):{};
  if(!object(before)||before.mcpServers!==undefined&&!object(before.mcpServers))throw Error(label+' configuration must contain an mcpServers object');
  const after={...before,mcpServers:{...before.mcpServers,premiere:desired}};
  const eol=text.includes('\r\n')?'\r\n':'\n';
  return {text:bom+JSON.stringify(after,null,2).replace(/\n/g,eol)+eol,previous:before.mcpServers?.premiere,desired};
}

export function mergeClaudeConfiguration(text,server) {
  return mergeJsonConfiguration(text,{type:'stdio',...server},'Claude');
}

/** Antigravity's mcp_config.json documents stdio servers as {command,args,env}
 * with no type key. Gemini CLI's settings.json, passed as --client-config, uses
 * the same mcpServers shape. */
export function mergeGeminiConfiguration(text,server) {
  return mergeJsonConfiguration(text,{...server},'Gemini');
}

function readConfiguration(filename) {
  safePath(filename);if(!existsSync(filename))return '';
  if(!lstatSync(filename).isFile()||lstatSync(filename).size>1024*1024)throw Error('Client configuration must be a regular file under 1 MiB');
  return readFileSync(filename,'utf8');
}

export function planClientRegistration({root,node,client,config,skillsTarget,home,environment,replaceClient=false,replaceSkills=false}) {
  const locations=clientLocations(client,{config,skillsTarget,home,environment}),before=readConfiguration(locations.config);
  const server=mcpConfiguration(root,node).mcpServers.premiere;
  const merge={codex:mergeCodexConfiguration,claude:mergeClaudeConfiguration,gemini:mergeGeminiConfiguration}[client];
  const merged=merge(before,server);
  const desired=merged.desired??server,desiredHash=serverHash(desired),previousHash=serverHash(merged.previous);
  const receiptFile=path.join(root,'artifacts/install/client-registration.json');
  const receipt=existsSync(receiptFile)?JSON.parse(readFileSync(receiptFile,'utf8')):{clients:{}};
  const managed=receipt.clients?.[client];
  const same=previousHash===desiredHash;
  const conflict=previousHash!==null&&!same&&!(managed?.config===locations.config&&managed?.serverHash===previousHash)&&!replaceClient;
  const skills=installSkills({root,target:locations.skillsTarget,replaceExisting:replaceSkills});
  return {...locations,status:conflict||skills.conflicts.length?'CONFLICT':'PLANNED',configConflict:conflict,configChanged:!same,
    beforeHash:hash(before),serverHash:desiredHash,skills,replaceSkills,
    // The contents may contain credentials. Never serialize this private plan.
    private:{before,after:same?before:merged.text}};
}

export function publicClientPlan(plan) {
  const safe={...plan};delete safe.private;return safe;
}

export function applyClientRegistration({root,plan}) {
  if(plan.status==='CONFLICT')throw Error('Client/skill conflict: inspect the plan and explicitly choose --replace-client and/or --replace-skills');
  if(hash(readConfiguration(plan.config))!==plan.beforeHash)throw Error('Client configuration changed after planning; retry with a fresh plan');
  let backup=null,written=false;
  const temporary=plan.config+'.premiere-'+randomUUID()+'.tmp';
  try {
    if(plan.configChanged) {
      if(existsSync(plan.config)) {backup=path.join(root,'artifacts/client-install-backups',randomUUID(),path.basename(plan.config));mkdirSync(path.dirname(backup),{recursive:true});writeFileSync(backup,plan.private.before,{mode:0o600});}
      mkdirSync(path.dirname(plan.config),{recursive:true});writeFileSync(temporary,plan.private.after,{mode:0o600,flag:'wx'});
      if(hash(readConfiguration(plan.config))!==plan.beforeHash)throw Error('Client configuration changed during installation');
      renameSync(temporary,plan.config);written=true;
      if(readConfiguration(plan.config)!==plan.private.after)throw Error('Client configuration readback mismatch');
    }
    const skills=installSkills({root,target:plan.skillsTarget,apply:true,replaceExisting:plan.replaceSkills});
    if(skills.status!=='PASS')throw Error('Skills changed after planning; client registration was rolled back');
    const receiptFile=path.join(root,'artifacts/install/client-registration.json');
    const receipt=existsSync(receiptFile)?JSON.parse(readFileSync(receiptFile,'utf8')):{schemaVersion:1,clients:{}};
    // Replaced skill files are as recoverable as a replaced configuration: record both backups.
    const result={client:plan.client,status:'PASS',config:plan.config,skillsTarget:plan.skillsTarget,serverHash:plan.serverHash,configChanged:plan.configChanged,backup,skillsBackup:skills.backup??null,skillsVerified:skills.verified===true||skills.idempotent===true,skillCount:skills.skillCount};
    receipt.clients[plan.client]=result;writeJson(receiptFile,receipt);return result;
  } catch(error) {
    if(written&&readConfiguration(plan.config)===plan.private.after) {
      if(backup)writeFileSync(plan.config,plan.private.before,{mode:0o600});else unlinkSync(plan.config);
    }
    throw error;
  } finally {if(existsSync(temporary))unlinkSync(temporary);}
}

export function registerClients({root,node,client,apply=false,...options}) {
  if(client==='none')return {status:'MANUAL',clients:[]};
  if(![...CLIENTS,'both'].includes(client))throw Error('--client must be codex, claude, gemini, both or none');
  if(client==='both'&&(options.config||options.skillsTarget))throw Error('Custom --config/--skills-target requires one client per invocation');
  const plans=(client==='both'?['codex','claude']:[client]).map(selected=>planClientRegistration({root,node,client:selected,...options}));
  if(!apply||plans.some(plan=>plan.status==='CONFLICT'))return {status:plans.some(plan=>plan.status==='CONFLICT')?'CONFLICT':'PLANNED',clients:plans.map(publicClientPlan)};
  return {status:'PASS',clients:plans.map(plan=>applyClientRegistration({root,plan}))};
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const options={root:fileURLToPath(new URL('../',import.meta.url)),node:process.execPath};
  for(let i=2;i<process.argv.length;i++) {
    const arg=process.argv[i];
    if(['--client','--config','--skills-target'].includes(arg)&&(!process.argv[i+1]||process.argv[i+1].startsWith('--')))throw Error('Missing value: '+arg);
    if(arg==='--client')options.client=process.argv[++i];
    else if(arg==='--config')options.config=process.argv[++i];
    else if(arg==='--skills-target')options.skillsTarget=process.argv[++i];
    else if(arg==='--apply')options.apply=true;
    else if(arg==='--replace-client')options.replaceClient=true;
    else if(arg==='--replace-skills')options.replaceSkills=true;
    else throw Error('Unknown argument: '+arg);
  }
  const result=registerClients(options);console.log(JSON.stringify(result,null,2));if(result.status==='CONFLICT')process.exitCode=1;
}
