import { existsSync, readdirSync, readFileSync, writeFileSync, renameSync, mkdirSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import process from 'node:process';
import { Buffer } from 'node:buffer';

export function run(command, args, options = {}) {
  const environment = { ...(options.env ?? process.env) };
  // PowerShell 7's inherited module path cannot be loaded by Windows PowerShell.
  // Let the child discover its own built-in modules; do not edit machine settings.
  if (process.platform === 'win32' && path.basename(command).toLowerCase() === 'powershell.exe') {
    for (const key of Object.keys(environment)) if (key.toLowerCase() === 'psmodulepath') delete environment[key];
  }
  const result = spawnSync(command, args, { stdio: 'inherit', windowsHide: true, ...options, env: environment });
  if (result.error || result.status !== 0) throw Error(`${path.basename(command)} failed: ${result.error?.message ?? result.status}`);
  return result;
}
export function readJson(filename) { return JSON.parse(readFileSync(filename, 'utf8').replace(/^\uFEFF/, '')); }
export function writeJson(filename, value) {
  mkdirSync(path.dirname(filename), { recursive: true });
  const temporary = filename + '.install-tmp';
  writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  renameSync(temporary, filename);
}
export function assertSupported(platform = process.platform, arch = process.arch) {
  if (!(platform === 'win32' && arch === 'x64' || platform === 'darwin' && ['arm64', 'x64'].includes(arch)))
    throw Error(`Unsupported platform: ${platform}/${arch}. Use Windows x64 or macOS Intel/Apple Silicon.`);
}
export function defaultSettings() {
  // Explicit absolute local media is read-only by default, on every workstation.
  // Roots are optional for network sources, never a per-title local allowlist.
  return { version: 1, sourceRoots: [] };
}
export function adobeInstaller(platform = process.platform, environment = process.env) {
  return platform === 'win32'
    ? path.join(environment.CommonProgramFiles ?? '', 'Adobe/Adobe Desktop Common/RemoteComponents/UPI/UnifiedPluginInstallerAgent/UnifiedPluginInstallerAgent.exe')
    : '/Library/Application Support/Adobe/Adobe Desktop Common/RemoteComponents/UPI/UnifiedPluginInstallerAgent/UnifiedPluginInstallerAgent.app/Contents/MacOS/UnifiedPluginInstallerAgent';
}
export function mcpConfiguration(root, node) {
  return { mcpServers: { premiere: { command: node, args: [path.join(root, 'apps/mcp-server/dist/index.js')], env: { PREMIERE_MCP_PROFILE: 'inspect,edit,delivery' } } } };
}
export function writeLocalDeployment(root) {
  // Vite empties dist and copies the intentionally blank public template. Rebuild
  // this machine's sidecar after that copy, retaining existing helper credentials.
  // Only dist is personalized: public source and the release ZIP must stay portable.
  // Loaded UDT panels still need Reload; generating a sidecar does not load it.
  const connection = name => { const file = path.join(root, 'artifacts/runtime', name + '-connection.json'); return existsSync(file) ? readJson(file) : null; };
  const deployment = { scratchRoot: path.join(root, 'artifacts/scratch'), runtimeLauncher: path.join(root, 'artifacts/runtime-launcher', process.platform === 'win32' ? 'PremiereMcpRuntimeLauncher.exe' : 'PremiereMcpRuntimeLauncher.app'), trackTargeting: connection('track-targeting'), trackLock: connection('track-lock') };
  writeFileSync(path.join(root, 'apps/uxp-plugin/dist/deployment-config.js'), 'globalThis.__PREMIERE_MCP_DEPLOYMENT__ = ' + JSON.stringify(deployment) + ';\n', { mode: 0o600 });
}
export function premiereIsRunning(listing, platform = process.platform) {
  return listing.split(/\r?\n/).some(line => platform === 'win32'
    ? /^"Adobe Premiere Pro\.exe",/i.test(line.trim())
    : /\/Adobe Premiere Pro[^/]*\.app\/Contents\/MacOS\/Adobe Premiere Pro\s*$/.test(line));
}

/** Small uncompressed ZIP writer: sorted files, no symlinks, portable slash paths,
 * UTF-8 names and executable mode for the macOS double-click entry point. */
export function zipDirectory(directory, destination, allow = () => true) {
  const files = [];
  function walk(relative = '') {
    for (const name of readdirSync(path.join(directory, relative)).sort()) {
      const entry = relative ? `${relative}/${name}` : name;
      if (!allow(entry)) continue;
      const stat = lstatSync(path.join(directory, entry));
      if (stat.isSymbolicLink()) throw Error(`Refusing to package a symlink: ${entry}`);
      if (stat.isDirectory()) walk(entry); else if (stat.isFile()) files.push(entry);
    }
  }
  walk();
  const local = [], central = []; let offset = 0;
  for (const file of files) {
    const data = readFileSync(path.join(directory, file)), name = Buffer.from(file);
    let crc = 0xffffffff;
    for (const byte of data) { crc ^= byte; for (let n = 0; n < 8; n++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1; }
    crc = (crc ^ 0xffffffff) >>> 0;
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6); header.writeUInt16LE(33, 12); header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(name.length, 26);
    const index = Buffer.alloc(46); index.writeUInt32LE(0x02014b50); index.writeUInt16LE(0x0314, 4); header.copy(index, 6, 4, 30);
    index.writeUInt32LE(((file.endsWith('.command') || file.endsWith('.sh') ? 0o100755 : 0o100644) * 65536) >>> 0, 38);
    index.writeUInt32LE(offset, 42); central.push(index, name); local.push(header, name, data); offset += header.length + name.length + data.length;
  }
  const index = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(index.length, 12); end.writeUInt32LE(offset, 16);
  mkdirSync(path.dirname(destination), { recursive: true }); writeFileSync(destination, Buffer.concat([...local, index, end]));
  return files;
}
