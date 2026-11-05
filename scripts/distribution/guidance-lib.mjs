import {readFileSync, readdirSync, lstatSync, existsSync} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {loadPrivatePatterns, privateDataLine} from './private-patterns.mjs';

// Generic workstation markers. Named hosts, accounts and productions stay in the
// maintainer's private pattern file, because listing them here would publish them.
const WORKSTATION_PATHS = [
  /\b[A-Za-z]:[\\/]+Users[\\/]+(?![<%${])[^\\/\s'"`)<>]+/, // a concrete Windows profile
  /(?<![\w.])\/Users\/(?![<${])[^/\s'"`)<>]+\//, // a concrete macOS home
  /(?<![\\\w])\\\\[A-Za-z][\w.-]*\\[\w$.-]+/, // a UNC share
];

export const digest = data => createHash('sha256').update(data).digest('hex');
export const readJson = filename => JSON.parse(readFileSync(filename, 'utf8'));
export function portableFiles(root, relative = '') {
  const output = [];
  for (const name of readdirSync(path.join(root, relative)).sort()) {
    const child = relative ? `${relative}/${name}` : name;
    const info = lstatSync(path.join(root, child));
    if (info.isSymbolicLink()) throw Error(`Symbolic link in portable content: ${child}`);
    if (info.isDirectory()) output.push(...portableFiles(root, child));
    else if (info.isFile()) output.push(child);
  }
  return output;
}

export function guidanceInventory(root) {
  const bundle = readJson(path.join(root, 'skills/bundle.json'));
  const names = bundle.skills.map(skill => skill.name);
  if (new Set(names.map(name => name.toLowerCase())).size !== names.length) throw Error('Duplicate skill name');
  for (const name of names) if (!/^USER-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) throw Error(`Invalid skill name: ${name}`);
  const files = [...bundle.documents];
  for (const name of names) files.push(...portableFiles(path.join(root, 'skills', name)).map(file => `skills/${name}/${file}`));
  for (const file of files) {
    if (!/^(docs|skills)\//.test(file) || file.includes('\\') || file.includes(':') || file.split('/').some(part => !part || part === '..' || part === '.')) throw Error(`Invalid guidance path: ${file}`);
    if (!existsSync(path.join(root, file)) || !lstatSync(path.join(root, file)).isFile()) throw Error(`Missing guidance file: ${file}`);
  }
  if (new Set(files).size !== files.length) throw Error('Duplicate guidance file');
  for (const resource of bundle.resources) if (!files.includes(resource.path)) throw Error(`Resource not shipped: ${resource.path}`);
  if (new Set(bundle.resources.map(row => row.name)).size !== bundle.resources.length) throw Error('Duplicate resource name');
  return {bundle, files: files.sort()};
}

/** `privatePatterns`: null runs only the generic checks; omitted, the root's private file is used if present. */
export function validateGuidance(root, {privatePatterns = loadPrivatePatterns(root)} = {}) {
  const {bundle, files} = guidanceInventory(root);
  const published = new Set([...files, 'README.md', 'AI_INSTALL.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md']);
  // An install check that pins a literal panelVersion must name the packaged panel;
  // README kept 0.16.5 through five releases because nothing compared it.
  const panelVersion = readJson(path.join(root, 'apps/uxp-plugin/package.json')).version;
  let links = 0;
  for (const file of [...published].filter(file => file.endsWith('.md'))) {
    const text = readFileSync(path.join(root, file), 'utf8');
    if (WORKSTATION_PATHS.some(expression => expression.test(text))) throw Error(`Workstation path in guidance: ${file}`);
    const privateLine = privateDataLine(text, privatePatterns);
    // Report the location only; echoing the match would spread the private value.
    if (privateLine) throw Error(`Private data in guidance: ${file}:${privateLine}`);
    for (const match of text.matchAll(/\bpanelVersion\b["'`]?\s*[:=]\s*["'`]?v?([0-9]+\.[0-9]+\.[0-9]+)/g))
      if (match[1] !== panelVersion) throw Error(`Stale panelVersion in guidance: ${file} says ${match[1]}, packaged panel is ${panelVersion}`);
    for (const match of text.matchAll(/\[[^\]]*\]\((?:<([^>]+)>|([^\s)]+))(?:\s+"[^"]*")?\)/g)) {
      const href = match[1] ?? match[2];
      if (/^(?:https?:|premiere:|app:|#)/.test(href)) continue;
      if (/^[a-z]+:/i.test(href) || href.startsWith('/')) throw Error(`Nonportable link in ${file}: ${href}`);
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), decodeURIComponent(href.split('#')[0])));
      if (!published.has(target)) throw Error(`Unshipped link in ${file}: ${href} -> ${target}`);
      if (file.startsWith('skills/USER-') && !target.startsWith(file.split('/').slice(0,2).join('/')+'/')) throw Error(`Skill link escapes its portable folder: ${file}`);
      links++;
    }
  }
  for (const skill of bundle.skills) {
    const text = readFileSync(path.join(root, 'skills', skill.name, 'SKILL.md'), 'utf8');
    const front = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
    if (!front || !new RegExp(`^name: ${skill.name}$`, 'm').test(front[1])) throw Error(`Skill identity mismatch: ${skill.name}`);
    const skillVersion = front[1].match(/^ {2}version:\s*"([0-9]+\.[0-9]+\.[0-9]+)"\s*$/m)?.[1];
    if (skillVersion !== skill.version) throw Error(`Skill version mismatch: ${skill.name}`);
    const description = front[1].match(/^description:\s*"(.+)"\s*$/m)?.[1];
    if (!description || !/[가-힣]/.test(description) || description.length > 1024) throw Error(`Invalid skill description: ${skill.name}`);
  }
  return {status:'PASS', skillCount:bundle.skills.length, fileCount:files.length, resourceCount:bundle.resources.length, links};
}

export function guidanceManifest(root) {
  const {bundle, files} = guidanceInventory(root);
  return {schemaVersion:1, packageVersion:readJson(path.join(root,'package.json')).version,
    serverVersion:readJson(path.join(root,'apps/mcp-server/package.json')).version,
    panelSourceVersion:readJson(path.join(root,'apps/uxp-plugin/package.json')).version,
    bundleVersion:bundle.version, contractVersion:bundle.contractVersion,
    minimumPanelVersion:bundle.minimumPanelVersion, optionalFeatures:bundle.optionalFeatures ?? {},
    livePremiere:'UNVERIFIED_BY_THIS_PACKAGE',
    files:Object.fromEntries(files.map(file => [file,digest(readFileSync(path.join(root,file)))]))};
}

/** Validate the staged source archive too: helper READMEs are user entry points,
 * so their links must not depend on developer-only histories omitted by policy. */
export function validateReleaseLinks(root) {
  const files=portableFiles(root), published=new Set(files);let links=0;
  for(const file of files.filter(file=>file.endsWith('.md')&&file!=='installer/AGENTS.template.md')) {
    const text=readFileSync(path.join(root,file),'utf8');
    for(const match of text.matchAll(/\[[^\]]*\]\((?:<([^>]+)>|([^\s)]+))(?:\s+"[^"]*")?\)/g)) {
      const href=match[1]??match[2];
      if(/^(?:https?:|premiere:|app:|#)/.test(href))continue;
      if(/^[a-z]+:/i.test(href)||href.startsWith('/'))throw Error(`Nonportable release link in ${file}: ${href}`);
      const target=path.posix.normalize(path.posix.join(path.posix.dirname(file),decodeURIComponent(href.split('#')[0])));
      if(!published.has(target))throw Error(`Unshipped release link in ${file}: ${href}`);
      links++;
    }
  }
  return {status:'PASS',links};
}
