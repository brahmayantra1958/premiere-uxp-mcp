import { afterEach, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createNativePayloadManifest, inspectNativePayload, migrateNativeRuntimeConfiguration, nativeFiles, nativePipePrefix, nativePluginId, nativeSettingsText, prepareNativeAddons } from '../../installer/native-addons.mjs';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  // A structural PE fixture tests packaging, never host load or Adobe behavior.
  const parent = fileURLToPath(new URL('../../artifacts/native-addon-tests/', import.meta.url)); mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(path.join(parent, 'case-')); roots.push(root);
  for (const [index, entry] of nativeFiles.entries()) {
    const bytes = Buffer.alloc(1024); bytes.write('MZ'); bytes.writeUInt32LE(64, 0x3c); bytes.writeUInt32LE(0x4550, 64); bytes.writeUInt16LE(0x8664, 68); bytes.writeUInt16LE(0x2000, 86); bytes.writeUInt16LE(0x20b, 88); bytes[255] = index;
    bytes.write(nativePluginId, 256, 'utf8'); bytes.write(nativePipePrefix, 512, 'utf16le');
    writeFileSync(path.join(root, entry.name), bytes);
    writeFileSync(path.join(root, entry.receipt), JSON.stringify({ artifact: entry.name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), configurationProtocol: 1, pluginId: nativePluginId, pipePrefix: nativePipePrefix, portable: true, requestTests: 'pass', configurationTests: 'pass' }));
  }
  return root;
}
function mutate(root: string, update: (manifest: Record<string, any>) => void) {
  const file = path.join(root, 'manifest.json'), manifest = JSON.parse(readFileSync(file, 'utf8')); update(manifest); writeFileSync(file, JSON.stringify(manifest));
}
describe('portable native payload boundaries', () => {
  it('makes tested local binaries inspectable but never self-grants redistribution rights', () => {
    const root = fixture(), manifest = createNativePayloadManifest(root);
    expect(manifest.redistribution.status).toBe('unverified');
    expect(inspectNativePayload(root, { requireRedistributable: false }).files).toHaveLength(2);
    expect(() => inspectNativePayload(root)).toThrow('NATIVE_REDISTRIBUTION_UNVERIFIED');
    const receipt = prepareNativeAddons({ root, payloadDirectory: root });
    expect(['blocked', 'unsupported']).toContain(receipt.status);
    expect(receipt.installed).toBe(false);
  });
  it('rejects byte tampering, missing files, duplicate names, foreign platforms and wrong configuration versions', () => {
    for (const change of [
      (root: string) => writeFileSync(path.join(root, nativeFiles[0].name), Buffer.alloc(256)),
      (root: string) => rmSync(path.join(root, nativeFiles[1].name)),
      (root: string) => mutate(root, manifest => { manifest.files[1] = manifest.files[0]; }),
      (root: string) => mutate(root, manifest => { manifest.platform = 'darwin'; }),
      (root: string) => mutate(root, manifest => { manifest.configurationProtocol = 0; }),
      (root: string) => mutate(root, manifest => { manifest.nativeVisual.pipePrefix = 'unrelated'; }),
    ]) { const root = fixture(); createNativePayloadManifest(root); change(root); expect(() => inspectNativePayload(root, { requireRedistributable: false })).toThrow(); }
  });
  it('rejects a valid PE whose bytes no longer match the manifest and a linked package directory', () => {
    const root = fixture(); createNativePayloadManifest(root);
    const artifact = path.join(root, nativeFiles[0].name), bytes = readFileSync(artifact); bytes[255] ^= 1; writeFileSync(artifact, bytes);
    expect(() => inspectNativePayload(root, { requireRedistributable: false })).toThrow('NATIVE_PAYLOAD_HASH_MISMATCH');
    const owner = fixture(), linked = path.join(owner, 'linked'); symlinkSync(root, linked, 'junction');
    expect(() => inspectNativePayload(linked, { requireRedistributable: false })).toThrow('NATIVE_LINKED_PATH');
  });
  it('rejects a binary with a different native namespace even if a manifest was relabeled', () => {
    const root = fixture(); createNativePayloadManifest(root);
    const artifact = path.join(root, nativeFiles[1].name), bytes = readFileSync(artifact); bytes[256] = 'z'.charCodeAt(0); writeFileSync(artifact, bytes);
    expect(() => inspectNativePayload(root, { requireRedistributable: false })).toThrow('NATIVE_BINARY_NAMESPACE_MISMATCH');
  });
  it('requires byte-exact notices and an explicit reviewed evidence reference for release payloads', () => {
    const root = fixture(); createNativePayloadManifest(root);
    const notices = 'Test fixture only; no Adobe rights are granted by this test.\n';
    writeFileSync(path.join(root, 'ADOBE-NOTICES.txt'), notices);
    mutate(root, manifest => { manifest.redistribution = { status: 'verified', evidence: 'Fixture evidence, not a real Adobe license.', noticesFile: 'ADOBE-NOTICES.txt', noticesSha256: createHash('sha256').update(notices).digest('hex') }; });
    expect(inspectNativePayload(root).files).toHaveLength(2);
    writeFileSync(path.join(root, 'ADOBE-NOTICES.txt'), notices + 'changed');
    expect(() => inspectNativePayload(root)).toThrow('NATIVE_NOTICES_HASH_MISMATCH');
  });
  it('does not accept legacy workstation-specific build receipts', () => {
    const root = fixture(); writeFileSync(path.join(root, nativeFiles[0].receipt), JSON.stringify({ portable: false }));
    expect(() => createNativePayloadManifest(root)).toThrow('NATIVE_BUILD_RECEIPT_MISMATCH');
  });
  it('serializes a Unicode local checkout while refusing network, traversal, stream and line injection paths', () => {
    const token = 'a'.repeat(64);
    expect(nativeSettingsText('C:\\설치 공백\\premiere', token)).toBe(`PREMIERE_UXP_MCP_NATIVE_V1\n${token}\nC:\\설치 공백\\premiere\\artifacts\\runtime\n`);
    for (const root of ['relative', '\\\\server\\share', 'C:\\x\\..\\repo', 'C:\\x:stream', 'C:\\x\nnext', 'C:\\x.\\repo', 'C:\\x \\repo', 'C:\\x\\\\repo']) expect(() => nativeSettingsText(root, token)).toThrow();
    expect(() => nativeSettingsText('C:\\repo', 'INVALID')).toThrow('NATIVE_CONFIG_TOKEN');
  });
  it('returns an unavailable receipt without creating a missing payload', () => {
    const root = fixture(), missing = path.join(root, 'missing');
    expect(['unavailable', 'unsupported']).toContain(prepareNativeAddons({ root, payloadDirectory: missing }).status);
  });
  it('keeps the secret and unrelated settings on reinstall and rejects any other plug-in ID', () => {
    const previous = { protocol: 1, token: 'b'.repeat(64), pluginId: 'ai.brahma.yantra.native-visual', retainedSetting: 'keep' };
    const next = migrateNativeRuntimeConfiguration(previous);
    expect(next).toEqual(previous);
    expect(next).not.toBe(previous);
    expect(() => migrateNativeRuntimeConfiguration({ ...previous, pluginId: 'unrelated-plugin' })).toThrow('NATIVE_EXISTING_CONFIG_INCOMPATIBLE');
    expect(() => migrateNativeRuntimeConfiguration({ ...previous, token: 'invalid' })).toThrow('NATIVE_CONFIG_TOKEN');
    const fresh = migrateNativeRuntimeConfiguration(null);
    expect(fresh.pluginId).toBe('ai.brahma.yantra.native-visual'); expect(fresh.token).toMatch(/^[a-f0-9]{64}$/);
  });
});
