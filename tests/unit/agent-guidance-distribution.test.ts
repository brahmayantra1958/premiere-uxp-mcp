import {copyFileSync,existsSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {describe,it,expect} from 'vitest';
import {guidanceInventory,validateGuidance,validateReleaseLinks,guidanceManifest,digest} from '../../scripts/distribution/guidance-lib.mjs';
import {releasePolicy} from '../../scripts/distribution/release-policy.mjs';
import {findPrivateData,loadPrivatePatterns} from '../../scripts/distribution/private-patterns.mjs';
import {installSkills} from '../../installer/install-skills.mjs';
import {loadAgentGuidance} from '../../apps/mcp-server/src/agent-guidance.js';

const root=path.resolve('.');
function fixture(){
  const base=path.join(root,'artifacts/tests/guidance');mkdirSync(base,{recursive:true});
  const target=mkdtempSync(path.join(base,'case-'));
  for(const file of [...guidanceInventory(root).files,'README.md','AI_INSTALL.md','LICENSE','THIRD_PARTY_NOTICES.md','package.json','apps/mcp-server/package.json','apps/uxp-plugin/package.json']){
    const out=path.join(target,file);mkdirSync(path.dirname(out),{recursive:true});copyFileSync(path.join(root,file),out);
  }
  return target;
}
describe('guidance release and installation',()=>{
  it('rejects a bundled skill version that differs from its installed frontmatter',()=>{
    const copy=fixture(),file=path.join(copy,'skills/USER-video-edit-premiere/SKILL.md');
    writeFileSync(file,readFileSync(file,'utf8').replace(/^ {2}version:.*$/m,'  version: "0.0.0"'));
    expect(()=>validateGuidance(copy)).toThrow('Skill version mismatch');
  });
  it('rejects guidance whose install check names a different panelVersion than the packaged panel',()=>{
    const copy=fixture(),readme=path.join(copy,'README.md'),text=readFileSync(readme,'utf8');
    const panel=JSON.parse(readFileSync(path.join(copy,'apps/uxp-plugin/package.json'),'utf8')).version;
    writeFileSync(readme,`${text}\n\`panelVersion: ${panel}\`\n`);
    expect(validateGuidance(copy).status).toBe('PASS');
    writeFileSync(readme,`${text}\n\`panelVersion: 0.0.1\`\n`);
    expect(()=>validateGuidance(copy)).toThrow('Stale panelVersion in guidance');
  });
  it('rejects workstation paths generically and private vocabulary only from a private list',()=>{
    const copy=fixture(),readme=path.join(copy,'README.md'),text=readFileSync(readme,'utf8');
    const privatePatterns={block:[/example-nas-host/gi],allow:[/legacy\.example-nas-host/gi]};
    for(const leak of ['C:\\Users\\editor\\Videos\\clip.mp4','/Users/editor/Movies/clip.mov','\\\\media-server\\share\\clip.mxf']){
      writeFileSync(readme,`${text}\nSource: ${leak}\n`);
      expect(()=>validateGuidance(copy,{privatePatterns:null})).toThrow('Workstation path in guidance: README.md');
    }
    writeFileSync(readme,`${text}\nExample: C:\\Users\\<you>\\AppData and /Users/<you>/Library.\n`);
    expect(validateGuidance(copy,{privatePatterns:null}).status).toBe('PASS');
    writeFileSync(readme,`${text}\nMedia lives on example-nas-host.\n`);
    expect(validateGuidance(copy,{privatePatterns:null}).status).toBe('PASS');
    expect(()=>validateGuidance(copy,{privatePatterns})).toThrow(/^Private data in guidance: README\.md:\d+$/);
    writeFileSync(readme,`${text}\nThe old id legacy.example-nas-host is removed on install.\n`);
    expect(validateGuidance(copy,{privatePatterns}).status).toBe('PASS');
  });
  it('loads the private list from outside the release and finds it in any staged file',()=>{
    const base=path.join(root,'artifacts/tests/private-patterns');mkdirSync(base,{recursive:true});
    const directory=mkdtempSync(path.join(base,'case-')),list=path.join(directory,'patterns.txt'),stage=path.join(directory,'stage');
    writeFileSync(list,'# private words\nexample-nas-host\nProjectNebula\n!legacy\\.example-nas-host\n');
    const patterns=loadPrivatePatterns(directory,{PREMIERE_MCP_PRIVATE_PATTERNS:list});
    expect([patterns?.block.length,patterns?.allow.length]).toEqual([2,1]);
    expect(loadPrivatePatterns(path.join(directory,'missing'),{})).toBeUndefined();
    mkdirSync(path.join(stage,'docs'),{recursive:true});
    writeFileSync(path.join(stage,'docs/allowed.md'),'removes legacy.example-nas-host\n');
    writeFileSync(path.join(stage,'docs/notes.md'),'first\nsecond on Example-NAS-Host\n');
    writeFileSync(path.join(stage,'docs/ProjectNebula.txt'),'clean\n');
    writeFileSync(path.join(stage,'docs/image.bin'),Buffer.concat([Buffer.from([0,1,2]),Buffer.from('xmp author example-nas-host')]));
    expect(findPrivateData(stage,patterns)).toEqual(['docs/ProjectNebula.txt (path)','docs/image.bin (binary)','docs/notes.md:2']);
    expect(findPrivateData(stage,undefined)).toEqual([]);
    writeFileSync(list,'(unclosed\n');
    expect(()=>loadPrivatePatterns(directory,{PREMIERE_MCP_PRIVATE_PATTERNS:list})).toThrow(/^Invalid private pattern at line 1$/);
  });
  it('rejects helper README links to histories excluded from the release',()=>{
    const copy=fixture(),readme=path.join(copy,'apps/cep-caption-helper/README.md');mkdirSync(path.dirname(readme),{recursive:true});
    writeFileSync(readme,'[current support](../../docs/release-status.md)');
    expect(validateReleaseLinks(copy).status).toBe('PASS');
    writeFileSync(readme,'[obsolete local evidence](../../docs/history/old-proof.md)');
    expect(()=>validateReleaseLinks(copy)).toThrow('Unshipped release link');
  });
  it('keeps the complete guide graph portable and rejects missing references',()=>{
    const copy=fixture();expect(validateGuidance(copy).skillCount).toBe(4);
    expect(loadAgentGuidance(copy).instructions).toBe(loadAgentGuidance(root).instructions);
    const manifest=guidanceManifest(copy);
    for(const [file,hash] of Object.entries(manifest.files))expect(digest(readFileSync(path.join(copy,file)))).toBe(hash);
    writeFileSync(path.join(copy,'skills/USER-video-edit-premiere/SKILL.md'),readFileSync(path.join(copy,'skills/USER-video-edit-premiere/SKILL.md'),'utf8')+'\n[missing](references/missing.md)\n');
    expect(()=>validateGuidance(copy)).toThrow('Unshipped link');
  });
  it('includes guidance and installers while excluding private state and developer authority',()=>{
    const allow=releasePolicy(root);
    for(const file of guidanceInventory(root).files)expect(allow(file),file).toBe(true);
    for(const file of ['AGENTS.md','docs/current-status.md','docs/history/private.md','skills/unselected/SKILL.md','artifacts/runtime/token','apps/uxp-plugin/public/deployment-config.js','apps/native-read/dist/private.prm','apps/uxp-plugin/.env'])expect(allow(file),file).toBe(false);
    expect(allow('installer/install-skills.mjs')).toBe(true);
    expect(allow('installer/AGENTS.template.md')).toBe(true);
  });
  it('previews, installs idempotently, preserves unrelated data, and protects local edits',()=>{
    const source=fixture(),target=path.join(source,'personal-skills');mkdirSync(path.join(target,'unrelated'),{recursive:true});writeFileSync(path.join(target,'unrelated','keep.txt'),'keep');
    const plan=installSkills({root:source,target});expect(plan.status).toBe('PLANNED');expect(existsSync(path.join(target,'USER-video-edit-premiere'))).toBe(false);
    const applied=installSkills({root:source,target,apply:true});expect(applied.verified).toBe(true);
    expect(installSkills({root:source,target,apply:true}).idempotent).toBe(true);
    const local=path.join(target,'USER-video-edit-premiere/SKILL.md');writeFileSync(local,'local customization');
    const refused=installSkills({root:source,target,apply:true});expect(refused.status).toBe('CONFLICT');expect(readFileSync(local,'utf8')).toBe('local customization');
    const replaced=installSkills({root:source,target,apply:true,replaceExisting:true});expect(replaced.verified).toBe(true);
    expect(readFileSync(path.join(replaced.backup!,'USER-video-edit-premiere/SKILL.md'),'utf8')).toBe('local customization');
    expect(readFileSync(path.join(target,'unrelated/keep.txt'),'utf8')).toBe('keep');
    expect(()=>installSkills({root:source,target:'relative'})).toThrow('absolute');
  });
});
