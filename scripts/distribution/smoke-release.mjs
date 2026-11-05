import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { run } from '../../installer/lib.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const version = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const archive = path.join(root, 'artifacts/releases', `premiere-uxp-mcp-${version}-source.zip`);
const target = path.join(root, 'artifacts/release-check', `Install 한글 path ${randomUUID().slice(0, 8)}`);
mkdirSync(target, { recursive: true });
if (process.platform === 'win32') {
  const quote = value => "'" + value.replaceAll("'", "''") + "'";
  run('powershell.exe', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath ${quote(archive)} -DestinationPath ${quote(target)}`]);
} else run('/usr/bin/unzip', ['-q', archive, '-d', target]);
const environment = { ...process.env, PATH: path.dirname(process.execPath) + path.delimiter + (process.env.PATH ?? '') };
// Real installer build in a fresh folder; no Adobe install or runtime startup.
run(process.execPath, [path.join(target, 'scripts/distribution/validate-guidance.mjs')], {cwd:target});
const skillTarget=path.join(target,'artifacts','skill-install-check');
run(process.execPath, [path.join(target,'installer/install-skills.mjs'),'--target',skillTarget,'--apply'],{cwd:target});
run(process.execPath, [path.join(target,'installer/install-skills.mjs'),'--target',skillTarget,'--apply'],{cwd:target});
run(process.execPath, [path.join(target, 'installer/install.mjs'), '--prepare-only'], { cwd: target, env: environment });
const npm = process.platform === 'win32' ? path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js') : path.resolve(path.dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js');
run(process.execPath, [npm, 'run', 'check'], { cwd: target, env: environment });
run(process.execPath, [path.join(target, 'scripts/distribution/package-release.mjs')], { cwd: target });
