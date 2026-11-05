import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { isLocalProjectPath, normalizeLocalPath, pathIsWithin } from '../../packages/contracts/src/local-path.js';
import { readInstallationSettings } from '../../apps/mcp-server/src/installation-settings.js';
import { verifyReadySnapshot } from '../../apps/mcp-server/src/ready-check.js';
import { uxpModules } from '../helpers/uxp-modules.js';
import { assertSupported, mcpConfiguration, premiereIsRunning, zipDirectory } from '../../installer/lib.mjs';

const temporary: string[] = [];
function fixture() { const root = mkdtempSync(path.join(os.tmpdir(), 'premiere install 한글 ')); temporary.push(root); return root; }
afterEach(() => { for (const root of temporary.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('portable local paths', () => {
  it.each(['C:\\Users\\other\\project.prproj', 'D:/Work/project.prproj', '/Users/editor/Movies/편집.prproj', '/private/tmp/edit.prproj'])('accepts saved local %s', value => expect(isLocalProjectPath(value)).toBe(true));
  it.each(['\\\\NAS\\share\\edit.prproj', '//NAS/share/edit.prproj', '/Volumes/NAS/edit.prproj', '/Network/share/edit.prproj', '/Users/editor/../edit.prproj', 'relative.prproj', '/Users/editor/edit.txt'])('rejects remote, relative or escaping %s', value => expect(isLocalProjectPath(value)).toBe(false));
  it('does not collapse case-sensitive macOS files or sibling directories', () => {
    expect(normalizeLocalPath('/Users/Editor/A.prproj')).not.toBe(normalizeLocalPath('/Users/Editor/a.prproj'));
    expect(pathIsWithin('/Users/Editor/output', '/Users/Editor/output-bypass/a.png')).toBe(false);
    expect(pathIsWithin('/Users/Editor/output', '/Users/Editor/output/../a.png')).toBe(false);
    expect(pathIsWithin('/Users/Editor/output', '/Users/Editor/output/a.png')).toBe(true);
    expect(pathIsWithin('', '/a.png')).toBe(false);
  });
  it('readiness and the actual host mutation guard accept a Mac project', () => {
    const project = { path: '/Users/editor/Movies/Test.prproj' };
    const host = uxpModules({})('apps/uxp-plugin/src/host-context.ts');
    expect(() => host.assertWorkingProject(project)).not.toThrow();
    expect(() => host.assertWorkingProject({ path: '/Volumes/NAS/Test.prproj' })).toThrow('local');
    expect(verifyReadySnapshot({ projectId: 'p', projectPath: project.path, activeSequence: { id: 's', name: 'Edit' } }, { scratchRoot: '/Users/editor/scratch', activeLocalTarget: true })).toEqual([]);
  });
  it('preserves POSIX output directory spelling sent to Premiere', () => {
    const host = uxpModules({}, { __PREMIERE_MCP_LOCAL_SCRATCH_ROOT__: '/Users/editor/scratch' })('apps/uxp-plugin/src/host-foundation.ts');
    expect(host.splitWindowsPath('/Users/Editor/Movies/Frame.png')).toEqual({ directory: '/Users/Editor/Movies/', filename: 'Frame.png' });
    expect(() => host.assertLocalScratchPath('/Users/editor/scratch/copy.prproj', '.prproj')).not.toThrow();
    expect(() => host.assertLocalScratchPath('/Users/editor/Scratch/copy.prproj', '.prproj')).toThrow();
  });
});
describe('installation boundary', () => {
  it('detects annual, beta and unversioned Mac Premiere processes without matching unrelated tools', () => {
    for (const app of ['Adobe Premiere Pro 2026', 'Adobe Premiere Pro (Beta)', 'Adobe Premiere Pro'])
      expect(premiereIsRunning(`/Applications/${app}/${app}.app/Contents/MacOS/Adobe Premiere Pro`, 'darwin')).toBe(true);
    expect(premiereIsRunning('/Applications/Adobe Media Encoder.app/Contents/MacOS/Adobe Media Encoder', 'darwin')).toBe(false);
    expect(premiereIsRunning('"Adobe Premiere Pro.exe","1234","Console","1","200 K"', 'win32')).toBe(true);
  });
  it('defaults to no personal source paths and rejects malformed or writable source settings', () => {
    const root = fixture(), file = path.join(root, 'settings.json');
    expect(readInstallationSettings(file)).toEqual({ version: 1, sourceRoots: [] });
    writeFileSync(file, JSON.stringify({ version: 1, sourceRoots: [root] }));
    expect(readInstallationSettings(file).sourceRoots).toEqual([root]);
    writeFileSync(file, JSON.stringify({ version: 1, sourceRoots: ['relative'] }));
    expect(() => readInstallationSettings(file)).toThrow('absolute');
    writeFileSync(file, JSON.stringify({ version: 1, sourceRoots: [], access: 'readWrite' }));
    expect(() => readInstallationSettings(file)).toThrow('Invalid installation settings');
  });
  it('uses exact relocated paths as MCP arguments without shell interpretation', () => {
    const root = fixture(), node = path.join(root, 'Node & tools', 'node');
    const config = mcpConfiguration(root, node).mcpServers.premiere;
    expect(config.command).toBe(node);
    expect(config.args).toEqual([path.join(root, 'apps/mcp-server/dist/index.js')]);
    expect(() => assertSupported('darwin', 'arm64')).not.toThrow();
    expect(() => assertSupported('darwin', 'x64')).not.toThrow();
    expect(() => assertSupported('win32', 'x64')).not.toThrow();
    expect(() => assertSupported('win32', 'arm64')).toThrow('Unsupported');
  });
  it('packages deterministic UTF-8 ZIP records while excluding private runtime data', () => {
    const root = fixture(); mkdirSync(path.join(root, 'artifacts')); writeFileSync(path.join(root, 'artifacts/token'), 'secret');
    writeFileSync(path.join(root, 'Setup.command'), '#!/bin/sh\necho hello\n'); writeFileSync(path.join(root, '안내.md'), 'hello');
    const zip = path.join(fixture(), 'package.zip');
    const entries = zipDirectory(root, zip, (name: string) => !name.startsWith('artifacts'));
    const bytes = readFileSync(zip);
    expect(entries).toEqual(['Setup.command', '안내.md']); expect(bytes.includes(Buffer.from('secret'))).toBe(false);
    zipDirectory(root, zip, (name: string) => !name.startsWith('artifacts'));
    expect(readFileSync(zip)).toEqual(bytes);
    expect(bytes.readUInt32LE(0)).toBe(0x04034b50);
    const central = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    expect(bytes.readUInt32LE(central + 38) >>> 16).toBe(0o100755);
  });
});
