import {copyFileSync,existsSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {describe,it,expect} from 'vitest';
import {parse as parseToml} from 'smol-toml';
import {guidanceInventory} from '../../scripts/distribution/guidance-lib.mjs';
import {applyClientRegistration,clientLocations,mergeCodexConfiguration,mergeClaudeConfiguration,mergeGeminiConfiguration,planClientRegistration,registerClients,publicClientPlan} from '../../installer/client-registration.mjs';
import {setupOptions} from '../../installer/setup-options.mjs';
import {verifyConnection} from '../../installer/connect.mjs';

const repository=path.resolve('.');
const server={command:'C:\\Program Files\\Node\\node.exe',args:['C:\\설치 폴더\\apps\\mcp-server\\dist\\index.js'],env:{PREMIERE_MCP_PROFILE:'inspect,edit,delivery'}};
function fixture(){
  const base=path.join(repository,'artifacts/tests/client-registration');mkdirSync(base,{recursive:true});
  const root=mkdtempSync(path.join(base,'case-'));
  for(const file of [...guidanceInventory(repository).files,'README.md','AI_INSTALL.md','LICENSE','THIRD_PARTY_NOTICES.md','apps/uxp-plugin/package.json']){
    const destination=path.join(root,file);mkdirSync(path.dirname(destination),{recursive:true});copyFileSync(path.join(repository,file),destination);
  }
  return {root,node:path.join(root,'node','node.exe'),home:path.join(root,'fixture-user'),environment:{}};
}

describe('selected client registration',()=>{
  it('preserves TOML comments, unrelated settings and headers inside multiline values',()=>{
    const before='# keep this comment\r\nmodel = "example"\r\nprompt = """\r\n[mcp_servers.premiere]\r\ninside a string\r\n"""\r\n[mcp_servers.other]\r\ncommand = "keep"\r\n[mcp_servers."premiere"]\r\ncommand = "old"\r\n[mcp_servers.premiere.env]\r\nOLD = "value"\r\n[profiles.personal]\r\nmodel = "personal"\r\n';
    const merged=mergeCodexConfiguration(before,server);
    expect(merged.text).toContain('# keep this comment\r\n');
    expect(merged.text).toContain('prompt = """\r\n[mcp_servers.premiere]\r\ninside a string\r\n"""');
    const parsed:any=parseToml(merged.text);
    expect(parsed.mcp_servers.premiere).toEqual(server);
    expect(parsed.mcp_servers.other.command).toBe('keep');
    expect(parsed.profiles.personal.model).toBe('personal');
  });
  it('rejects invalid or inline target TOML without silently replacing unrelated data',()=>{
    expect(()=>mergeCodexConfiguration('invalid = [',server)).toThrow();
    expect(()=>mergeCodexConfiguration('mcp_servers = {premiere={command="old"}, other={command="keep"}}',server)).toThrow('Inline/dotted');
    expect(()=>mergeCodexConfiguration('mcp_servers = {other={command="keep"}}',server)).toThrow('layout');
  });
  it('preserves Claude projects, approvals and other servers semantically',()=>{
    const before={theme:'dark',projects:{'/private/work':{hasTrustDialogAccepted:false}},mcpServers:{other:{type:'http',url:'https://example.invalid'}}};
    const merged=JSON.parse(mergeClaudeConfiguration(JSON.stringify(before),server).text);
    expect(merged).toEqual({...before,mcpServers:{...before.mcpServers,premiere:{type:'stdio',...server}}});
    expect(()=>mergeClaudeConfiguration('[]',server)).toThrow();
    expect(mergeClaudeConfiguration('\uFEFF{}',server).text.startsWith('\uFEFF')).toBe(true);
    expect(mergeCodexConfiguration('\uFEFF# utf8\n',server).text.startsWith('\uFEFF# utf8')).toBe(true);
  });
  it('merges only the Gemini premiere server in the documented shape and keeps other servers',()=>{
    const before={mcpServers:{obs:{command:'node',args:['obs.js'],env:{}},premiere:{command:'manual'}},other:{keep:true}};
    const merged=mergeGeminiConfiguration(JSON.stringify(before,null,2).replace(/\n/g,'\r\n'),server);
    expect(JSON.parse(merged.text)).toEqual({...before,mcpServers:{...before.mcpServers,premiere:server}});
    expect(JSON.parse(merged.text).mcpServers.premiere).not.toHaveProperty('type');
    expect(merged.previous).toEqual({command:'manual'});
    expect(merged.text.split('\n').every(line=>!line||line.endsWith('\r'))).toBe(true);
    expect(mergeGeminiConfiguration('\uFEFF{}',server).text.startsWith('\uFEFF')).toBe(true);
    expect(()=>mergeGeminiConfiguration('[]',server)).toThrow('Gemini configuration must contain an mcpServers object');
    expect(()=>mergeGeminiConfiguration('{"mcpServers":[]}',server)).toThrow('mcpServers object');
    expect(()=>mergeGeminiConfiguration('{"mcpServers": // comment\n{}}',server)).toThrow();
  });
  it('supports explicit home/config overrides without accessing the actual user',()=>{
    const options=fixture();
    expect(clientLocations('codex',options).config).toBe(path.join(options.home,'.codex/config.toml'));
    expect(clientLocations('claude',options).skillsTarget).toBe(path.join(options.home,'.claude/skills'));
    const custom=path.join(options.home,'custom');
    expect(clientLocations('claude',{...options,environment:{CLAUDE_CONFIG_DIR:custom}}).config).toBe(path.join(custom,'.claude.json'));
    expect(()=>clientLocations('codex',{...options,config:'relative'})).toThrow('absolute');
  });
  it('plans both clients before writing; installs all four skills and is idempotent',()=>{
    const options=fixture();
    const preview=registerClients({...options,client:'both'});
    expect(preview.status).toBe('PLANNED');expect(existsSync(options.home)).toBe(false);
    const installed=registerClients({...options,client:'both',apply:true});
    expect(installed.status).toBe('PASS');
    for(const client of installed.clients){expect(client.skillCount).toBe(4);expect(client.skillsVerified).toBe(true);}
    expect(registerClients({...options,client:'both',apply:true}).clients.every(client=>!client.configChanged)).toBe(true);
    const claude=JSON.parse(readFileSync(path.join(options.home,'.claude.json'),'utf8'));
    expect(claude.mcpServers.premiere.env.PREMIERE_MCP_PROFILE).toBe('inspect,edit,delivery');
  });
  it('registers Gemini in Antigravity global config and skills with the same conflict, backup and idempotence rules',()=>{
    const options=fixture(),locations=clientLocations('gemini',options);
    expect(locations.config).toBe(path.join(options.home,'.gemini/config/mcp_config.json'));
    expect(locations.skillsTarget).toBe(path.join(options.home,'.gemini/config/skills'));
    mkdirSync(path.dirname(locations.config),{recursive:true});
    const before='{\n  "mcpServers": {\n    "obs": {"command": "node", "args": ["obs.js"]},\n    "premiere": {"command": "manual"}\n  }\n}\n';
    writeFileSync(locations.config,before);
    const blocked=registerClients({...options,client:'gemini',apply:true});
    expect(blocked.status).toBe('CONFLICT');expect(blocked.clients[0].configConflict).toBe(true);
    expect(readFileSync(locations.config,'utf8')).toBe(before);expect(existsSync(locations.skillsTarget)).toBe(false);
    const replaced=registerClients({...options,client:'gemini',apply:true,replaceClient:true}).clients[0];
    expect(replaced).toMatchObject({status:'PASS',configChanged:true,skillCount:4,skillsVerified:true});
    expect(readFileSync(replaced.backup,'utf8')).toBe(before);
    const after=JSON.parse(readFileSync(locations.config,'utf8'));
    expect(after.mcpServers.obs).toEqual({command:'node',args:['obs.js']});
    expect(after.mcpServers.premiere).toEqual({command:options.node,args:[path.join(options.root,'apps/mcp-server/dist/index.js')],env:{PREMIERE_MCP_PROFILE:'inspect,edit,delivery'}});
    const again=registerClients({...options,client:'gemini',apply:true}).clients[0];
    expect(again).toMatchObject({status:'PASS',configChanged:false,backup:null,skillsBackup:null});
    const skill=path.join(locations.skillsTarget,'USER-video-edit-premiere/SKILL.md');writeFileSync(skill,'older copy');
    expect(registerClients({...options,client:'gemini',apply:true}).status).toBe('CONFLICT');
    const updated=registerClients({...options,client:'gemini',apply:true,replaceSkills:true}).clients[0];
    expect(readFileSync(path.join(updated.skillsBackup,'USER-video-edit-premiere/SKILL.md'),'utf8')).toBe('older copy');
  });
  it('does not overwrite an unmanaged entry and keeps its full backup after explicit replacement',()=>{
    const options=fixture(),config=clientLocations('codex',options).config;
    mkdirSync(path.dirname(config),{recursive:true});const before='# retain\n[mcp_servers.premiere]\ncommand="old"\n[mcp_servers.other]\ncommand="other"\n';writeFileSync(config,before);
    expect(registerClients({...options,client:'both',apply:true}).status).toBe('CONFLICT');
    expect(existsSync(path.join(options.home,'.claude.json'))).toBe(false);expect(readFileSync(config,'utf8')).toBe(before);
    const replaced=registerClients({...options,client:'codex',replaceClient:true,apply:true});
    expect(readFileSync(replaced.clients[0].backup,'utf8')).toBe(before);
    expect((parseToml(readFileSync(config,'utf8')) as any).mcp_servers.other.command).toBe('other');
  });
  it('allows managed path updates but refuses concurrent or locally edited settings',()=>{
    const options=fixture();registerClients({...options,client:'codex',apply:true});
    const moved={...options,node:path.join(options.root,'new-node.exe'),client:'codex'};
    const plan=planClientRegistration(moved);expect(plan.status).toBe('PLANNED');
    expect(publicClientPlan(plan)).not.toHaveProperty('private');
    writeFileSync(plan.config,readFileSync(plan.config,'utf8')+'\n# concurrently edited\n');
    expect(()=>applyClientRegistration({root:options.root,plan})).toThrow('changed after planning');
    expect(registerClients({...moved,apply:true}).status).toBe('PASS');
    writeFileSync(plan.config,readFileSync(plan.config,'utf8').replace('new-node.exe','custom-node.exe'));
    expect(registerClients({...moved,apply:true}).status).toBe('CONFLICT');
  });
  it('blocks skill conflicts before changing the client and rolls back a late conflict',()=>{
    const options=fixture();const plan=planClientRegistration({...options,client:'codex'});
    const target=path.join(plan.skillsTarget,'USER-video-edit-premiere/SKILL.md');mkdirSync(path.dirname(target),{recursive:true});writeFileSync(target,'local edits');
    expect(()=>applyClientRegistration({root:options.root,plan})).toThrow('rolled back');
    expect(existsSync(plan.config)).toBe(false);expect(readFileSync(target,'utf8')).toBe('local edits');
    expect(registerClients({...options,client:'codex',apply:true}).status).toBe('CONFLICT');
    expect(registerClients({...options,client:'codex',apply:true,replaceSkills:true}).status).toBe('PASS');
  });
});

describe('setup and connection boundaries',()=>{
  it('requires an explicit client in automation and keeps preparation isolated',()=>{
    expect(()=>setupOptions([])).toThrow('requires --client');
    expect(setupOptions([],{interactive:true}).client).toBeUndefined();
    expect(setupOptions(['--prepare-only']).prepareOnly).toBe(true);
    expect(()=>setupOptions(['--prepare-only','--client','codex'])).toThrow('cannot register');
    expect(()=>setupOptions(['--client'])).toThrow('Missing value');
    expect(()=>setupOptions(['--client','both','--client-config',path.join(repository,'fixture.toml')])).toThrow('single');
    expect(setupOptions(['--client','none','--non-interactive']).client).toBe('none');
    expect(setupOptions(['--client','gemini','--non-interactive']).client).toBe('gemini');
    expect(setupOptions(['--client','gemini','--client-config',path.join(repository,'settings.json')]).config).toBe(path.join(repository,'settings.json'));
    expect(()=>setupOptions(['--client','antigravity'])).toThrow('codex, claude, gemini, both or none');
  });
  it('rejects an old panel or another checkout even when the runtime says ready',()=>{
    const root=repository,panelVersion='0.15.1';
    const result={status:'ready',premiere:{deployment:{panelVersion,panelMode:'agent',localScratchRoot:path.join(root,'artifacts/scratch')}},projectPath:path.join(root,'example.prproj'),sequenceName:'Current sequence'};
    expect(verifyConnection(result,{root,panelVersion}).editing).toBe('UNVERIFIED');
    expect(()=>verifyConnection(result,{root,panelVersion:'different'})).toThrow('version/mode');
    expect(()=>verifyConnection(result,{root:path.join(root,'other'),panelVersion})).toThrow('different installation');
  });
});
