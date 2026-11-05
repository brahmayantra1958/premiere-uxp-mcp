import { createHash, randomBytes } from 'node:crypto';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';
import { Buffer } from 'node:buffer';

export const nativeFiles = Object.freeze([
  { name: 'PremiereMcpNativeRead.prm', destination: 'PlugIns/Common/PremiereMcpNativeRead.prm', receipt: 'native-read-build.json' },
  { name: 'PremiereMcpNativeVisual.acsrf', destination: 'PlugIns/ControlSurface/PremiereMcpNativeVisual.acsrf', receipt: 'native-visual-build.json' },
]);
export const nativePluginId = 'ai.brahma.yantra.native-visual';
export const nativePipePrefix = 'Brahma.Yantra.NativeVisual.v1.';
const fail = code => { throw Error(code); };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const readJson = file => JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));

// Also inspect parents: a regular file reached through a junction is a linked
// input. This installer never follows package links into a different checkout.
export function assertNativePlainPath(filename, { missing = false } = {}) {
  let current = path.resolve(filename);
  for (;;) {
    if (existsSync(current)) { if (lstatSync(current).isSymbolicLink()) fail('NATIVE_LINKED_PATH'); }
    else if (!missing) fail('NATIVE_PATH_MISSING');
    const parent = path.dirname(current); if (parent === current) break; current = parent;
  }
}
function validatePe(bytes) {
  if (bytes.length < 128 || bytes.readUInt16LE(0) !== 0x5a4d) fail('NATIVE_PAYLOAD_NOT_PE');
  const offset = bytes.readUInt32LE(0x3c);
  if (offset < 64 || offset + 26 > bytes.length || bytes.readUInt32LE(offset) !== 0x4550 || bytes.readUInt16LE(offset + 4) !== 0x8664 || !(bytes.readUInt16LE(offset + 22) & 0x2000) || bytes.readUInt16LE(offset + 24) !== 0x20b) fail('NATIVE_PAYLOAD_NOT_X64_DLL');
}
function validateLocalReceipts(directory, files) {
  for (const entry of nativeFiles) {
    const receiptPath = path.join(directory, entry.receipt); assertNativePlainPath(receiptPath);
    const receipt = readJson(receiptPath), actual = files.find(file => file.name === entry.name);
    if (receipt.portable !== true || receipt.configurationProtocol !== 1 || receipt.artifact !== entry.name || receipt.sha256?.toLowerCase() !== actual.sha256 || receipt.bytes !== actual.bytes || (entry.name.endsWith('.prm') && (receipt.requestTests !== 'pass' || receipt.configurationTests !== 'pass'))) fail('NATIVE_BUILD_RECEIPT_MISMATCH');
    if (entry.name.endsWith('.acsrf') && (receipt.pluginId !== nativePluginId || receipt.pipePrefix !== nativePipePrefix)) fail('NATIVE_BUILD_NAMESPACE_MISMATCH');
  }
}
function payloadFiles(directory) {
  return nativeFiles.map(({ name }) => {
    const file = path.join(directory, name); assertNativePlainPath(file);
    const bytes = readFileSync(file); validatePe(bytes);
    if (name.endsWith('.acsrf') && (!bytes.includes(Buffer.from(nativePluginId, 'utf8')) || !bytes.includes(Buffer.from(nativePipePrefix, 'utf16le')))) fail('NATIVE_BINARY_NAMESPACE_MISMATCH');
    return { name, bytes: bytes.length, sha256: hash(bytes) };
  });
}

/** Maintainer/local build step only. It deliberately cannot grant Adobe rights.
 * A distributor must supply independently reviewed evidence before opting in. */
export function createNativePayloadManifest(directory) {
  const files = payloadFiles(directory); validateLocalReceipts(directory, files);
  const manifest = { schemaVersion: 1, platform: 'win32', arch: 'x64', configurationProtocol: 1, nativeVisual: { pluginId: nativePluginId, pipePrefix: nativePipePrefix }, premiere: { major: 26, minor: 5 }, files,
    redistribution: { status: 'unverified', evidence: null, reason: 'Adobe SDK wrapper redistribution terms have not been established for this release.' } };
  writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n'); return manifest;
}

export function inspectNativePayload(directory, { requireRedistributable = true } = {}) {
  assertNativePlainPath(path.join(directory, 'manifest.json'));
  const manifest = readJson(path.join(directory, 'manifest.json'));
  if (manifest.schemaVersion !== 1 || manifest.platform !== 'win32' || manifest.arch !== 'x64' || manifest.configurationProtocol !== 1 || manifest.premiere?.major !== 26 || manifest.premiere?.minor !== 5) fail('NATIVE_MANIFEST_INCOMPATIBLE');
  if (manifest.nativeVisual?.pluginId !== nativePluginId || manifest.nativeVisual?.pipePrefix !== nativePipePrefix) fail('NATIVE_MANIFEST_NAMESPACE_MISMATCH');
  const files = payloadFiles(directory);
  if (!Array.isArray(manifest.files) || manifest.files.length !== files.length || files.some(file => manifest.files.filter(expected => expected.name === file.name && expected.bytes === file.bytes && expected.sha256 === file.sha256).length !== 1)) fail('NATIVE_PAYLOAD_HASH_MISMATCH');
  if (requireRedistributable) {
    if (manifest.redistribution?.status !== 'verified' || typeof manifest.redistribution.evidence !== 'string' || manifest.redistribution.evidence.trim().length < 20 || manifest.redistribution.noticesFile !== 'ADOBE-NOTICES.txt' || !/^[a-f0-9]{64}$/.test(manifest.redistribution.noticesSha256 ?? '')) fail('NATIVE_REDISTRIBUTION_UNVERIFIED');
    const notices = path.join(directory, 'ADOBE-NOTICES.txt'); assertNativePlainPath(notices);
    if (hash(readFileSync(notices)) !== manifest.redistribution.noticesSha256) fail('NATIVE_NOTICES_HASH_MISMATCH');
  }
  return { manifest, files };
}

export function nativeSettingsText(root, token) {
  if (!/^[a-f0-9]{64}$/.test(token)) fail('NATIVE_CONFIG_TOKEN');
  if (!/^[A-Za-z]:\\/.test(root) || [...root].some(character => character.charCodeAt(0) < 32) || /[/:*?"<>|]/.test(root.slice(2)) || root.slice(3).split('\\').some(part => !part || /[. ]$/.test(part))) fail('NATIVE_CONFIG_LOCAL_PATH');
  return `PREMIERE_UXP_MCP_NATIVE_V1\n${token}\n${root}\\artifacts\\runtime\n`;
}
/** Keep the installation secret and unrelated settings when reinstalling.
 * Applying this object is part of the backed-up install transaction. */
export function migrateNativeRuntimeConfiguration(previous) {
  if (previous == null) return { protocol: 1, token: randomBytes(32).toString('hex'), pluginId: nativePluginId };
  if (previous.protocol !== 1 || previous.pluginId !== nativePluginId) fail('NATIVE_EXISTING_CONFIG_INCOMPATIBLE');
  if (!/^[a-f0-9]{64}$/.test(previous.token)) fail('NATIVE_CONFIG_TOKEN');
  return { ...previous, pluginId: nativePluginId };
}
function powershell(script, environment = {}) {
  const env = { ...process.env, ...environment }; for (const key of Object.keys(env)) if (key.toLowerCase() === 'psmodulepath') delete env[key];
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from("[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);" + script, 'utf16le').toString('base64')], { env, windowsHide: true, encoding: 'utf8' });
  if (result.error || result.status !== 0) throw Error(`NATIVE_PREFLIGHT_FAILED: ${result.error?.message ?? result.stderr.trim()}`);
  return result.stdout.trim();
}
function hostState(premiereRoot) {
  return JSON.parse(powershell("$ErrorActionPreference='Stop';$v=(Get-Item -LiteralPath $env:PREMIERE_NATIVE_EXE).VersionInfo;[ordered]@{major=$v.FileMajorPart;minor=$v.FileMinorPart;running=@(Get-Process -Name 'Adobe Premiere Pro' -ErrorAction SilentlyContinue).Count -gt 0;localAppData=[Environment]::GetFolderPath('LocalApplicationData')}|ConvertTo-Json -Compress", { PREMIERE_NATIVE_EXE: path.join(premiereRoot, 'Adobe Premiere Pro.exe') }));
}
function privateFile(file, bytes) {
  assertNativePlainPath(file, { missing: true }); mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.install-${randomBytes(8).toString('hex')}`;
  try {
    writeFileSync(temp, '', { mode: 0o600, flag: 'wx' });
    // Node's mode does not set a Windows DACL. Strip inheritance from credentials
    // before publishing; current user, SYSTEM, and administrators retain access.
    powershell("$ErrorActionPreference='Stop';$file=$env:PREMIERE_NATIVE_PRIVATE;$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User; $acl=New-Object Security.AccessControl.FileSecurity;$acl.SetOwner($sid);$acl.SetAccessRuleProtection($true,$false);foreach($id in @($sid.Value,'S-1-5-18','S-1-5-32-544')){$identity=New-Object Security.Principal.SecurityIdentifier($id);$rule=New-Object Security.AccessControl.FileSystemAccessRule($identity,'FullControl','Allow');$acl.AddAccessRule($rule)};Set-Acl -LiteralPath $file -AclObject $acl", { PREMIERE_NATIVE_PRIVATE: temp });
    writeFileSync(temp, bytes);
    renameSync(temp, file);
  } finally { if (existsSync(temp)) rmSync(temp); }
}

/** Read-only by default. Only explicit Setup --native-addons or the local-build
 * CLI selects apply. This function never stops Premiere, registers a surface,
 * changes Windows policy, or claims host verification. */
export function prepareNativeAddons({ root, payloadDirectory = path.join(root, 'installer/native/win-x64'), premiereRoot, apply = false, allowLocalBuild = false } = {}) {
  if (process.platform !== 'win32' || process.arch !== 'x64') return { status: 'unsupported', reason: 'NATIVE_WINDOWS_X64_ONLY', installed: false, hostVerified: false };
  if (!existsSync(path.join(payloadDirectory, 'manifest.json'))) return { status: 'unavailable', reason: 'NATIVE_PAYLOAD_MISSING', installed: false, hostVerified: false };
  let payload;
  try { payload = inspectNativePayload(payloadDirectory, { requireRedistributable: !allowLocalBuild }); }
  catch (error) { if (error.message === 'NATIVE_REDISTRIBUTION_UNVERIFIED') return { status: 'blocked', reason: error.message, installed: false, hostVerified: false }; throw error; }
  if (allowLocalBuild) validateLocalReceipts(payloadDirectory, payload.files);
  root = path.resolve(root); nativeSettingsText(root, '0'.repeat(64)); assertNativePlainPath(root);
  if (!premiereRoot) return { status: 'prepared', reason: 'PREMIERE_ROOT_REQUIRED', files: payload.files, installed: false, hostVerified: false };
  premiereRoot = path.resolve(premiereRoot); assertNativePlainPath(path.join(premiereRoot, 'Adobe Premiere Pro.exe'));
  const state = hostState(premiereRoot);
  if (state.major !== payload.manifest.premiere.major || state.minor !== payload.manifest.premiere.minor) fail('NATIVE_PREMIERE_VERSION_UNVERIFIED');
  const targets = nativeFiles.map(file => ({ ...file, source: path.join(payloadDirectory, file.name), destination: path.join(premiereRoot, file.destination), sha256: payload.files.find(item => item.name === file.name).sha256 }));
  for (const target of targets) assertNativePlainPath(target.destination, { missing: true });
  const configuration = path.join(state.localAppData, 'PremiereUxpMcp/native-bridge-v1.txt'); assertNativePlainPath(configuration, { missing: true });
  const runtimeConfig = path.join(root, 'artifacts/runtime/native-visual-config.json'); assertNativePlainPath(runtimeConfig, { missing: true });
  const previousRuntime = existsSync(runtimeConfig) ? readJson(runtimeConfig) : null;
  const migratedRuntime = previousRuntime ? migrateNativeRuntimeConfiguration(previousRuntime) : null;
  const prepared = { status: 'prepared', files: targets.map(({ destination, sha256 }) => ({ destination, sha256 })), configuration, nativeVisual: { pluginId: nativePluginId, pipePrefix: nativePipePrefix }, installed: false, hostVerified: false, next: 'Quit Premiere normally; install; restart; add Premiere MCP Native Visual in Preferences > Control Surface; verify native readback.' };
  if (!apply) return prepared;
  if (state.running) fail('NATIVE_PREMIERE_MUST_BE_CLOSED');
  const nextRuntime = migratedRuntime ?? migrateNativeRuntimeConfiguration(null); const text = nativeSettingsText(root, nextRuntime.token);
  const backups = [];
  // Installation is a small transaction. Backups remain local for explicit rollback.
  const backupDirectory = path.join(root, 'artifacts/native-install', randomBytes(12).toString('hex')); assertNativePlainPath(backupDirectory, { missing: true }); mkdirSync(backupDirectory, { recursive: true });
  const remember = (file, sensitive = false) => { const backup = existsSync(file) ? path.join(backupDirectory, `${backups.length}-${path.basename(file)}`) : null; if (backup) { if (sensitive) privateFile(backup, readFileSync(file)); else copyFileSync(file, backup); } backups.push({ file, backup, sensitive }); };
  try {
    for (const target of targets) { remember(target.destination); mkdirSync(path.dirname(target.destination), { recursive: true }); copyFileSync(target.source, target.destination); if (hash(readFileSync(target.destination)) !== target.sha256) fail('NATIVE_INSTALLED_HASH_MISMATCH'); }
    remember(runtimeConfig, true); privateFile(runtimeConfig, JSON.stringify(nextRuntime, null, 2) + '\n');
    remember(configuration, true); privateFile(configuration, text);
    const receipt = { ...prepared, status: 'installed', installed: true, backupDirectory, backups, localBuild: allowLocalBuild };
    writeFileSync(path.join(backupDirectory, 'install.json'), JSON.stringify(receipt, null, 2) + '\n'); return receipt;
  } catch (error) {
    const failures = [];
    for (const item of backups.reverse()) try { if (item.backup) { if (item.sensitive) privateFile(item.file, readFileSync(item.backup)); else copyFileSync(item.backup, item.file); } else if (existsSync(item.file)) rmSync(item.file); } catch { failures.push(item.file); }
    if (failures.length) throw Error(`${error.message}; NATIVE_ROLLBACK_INCOMPLETE: ${failures.join(', ')}`); throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), value = key => { const index = args.indexOf(key); if (index < 0) return undefined; if (!args[index + 1] || args[index + 1].startsWith('--')) fail('NATIVE_ARGUMENT_VALUE_REQUIRED'); return args[index + 1]; };
  try {
    const directory = value('--payload');
    const result = args.includes('--manifest') ? createNativePayloadManifest(directory ?? fail('NATIVE_PAYLOAD_REQUIRED')) : prepareNativeAddons({ root: value('--root') ?? fileURLToPath(new URL('../', import.meta.url)), payloadDirectory: directory, premiereRoot: value('--premiere-root'), apply: args.includes('--apply'), allowLocalBuild: args.includes('--local-build') });
    process.stdout.write(JSON.stringify(result, null, 2) + '\n'); if (args.includes('--apply') && result.status !== 'installed') process.exitCode = 1;
  } catch (error) { process.stderr.write(error.message + '\n'); process.exitCode = 1; }
}
