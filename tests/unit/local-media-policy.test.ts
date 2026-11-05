import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PathPolicy } from '../../apps/mcp-server/src/path-policy.js';
import { mediaExtensions } from '../../apps/mcp-server/src/config.js';
import { sourceMediaRoots } from '../../apps/mcp-server/src/installation-settings.js';
import { readCaptionSrt } from '../../apps/mcp-server/src/caption-srt-source.js';
import { registerProjectMediaTools } from '../../apps/mcp-server/src/project-edit-tools.js';
import { registerEffectTools } from '../../apps/mcp-server/src/effect-tools.js';

let sandbox: string, media: string, registered: string, output: string, policy: PathPolicy;
beforeEach(async () => {
  // Canonical temp path also handles macOS's /var -> /private/var OS alias.
  sandbox = await realpath(await mkdtemp(path.join(os.tmpdir(), 'local-media-')));
  media = path.join(sandbox, 'Any New Title 한글', 'audio');
  registered = path.join(sandbox, 'registered'); output = path.join(sandbox, 'output');
  await Promise.all([media, registered, output].map(directory => mkdir(directory, { recursive: true })));
  for (const name of ['voice.wav', 'video.mp4', 'bad.exe']) await writeFile(path.join(media, name), 'fixture');
  await writeFile(path.join(media, 'captions.srt'), '1\n00:00:00,000 --> 00:00:01,000\n대사\n');
  policy = new PathPolicy([...sourceMediaRoots([registered], mediaExtensions), { path: output, role: 'output', access: 'readWrite', isNas: false, allowedExtensions: ['.mp4'], pathBoundary: 'enforced' }], { mediaReadExtensions: mediaExtensions, settingsPath: 'test-settings.json' });
});
afterEach(async () => { await rm(sandbox, { recursive: true, force: true }); });

describe('explicit local media without per-folder registration', () => {
  it('accepts WAV/MP4/SRT from arbitrary new folders with the same policy instance', async () => {
    for (const name of ['voice.wav', 'video.mp4', 'captions.srt']) expect(policy.authorizeRead(path.join(media, name))).toMatchObject({ root: { access: 'readOnly', role: 'source' } });
    const next = path.join(sandbox, 'Completely Different Folder'); await mkdir(next); await writeFile(path.join(next, 'next.wav'), 'fixture');
    expect(policy.authorizeRead(path.join(next, 'next.wav')).path).toBe(path.join(next, 'next.wav'));
    expect((await readCaptionSrt(path.join(media, 'captions.srt'), policy)).cues).toHaveLength(1);
    await writeFile(path.join(output, 'voice.wav'), 'fixture');
    expect(policy.authorizeRead(path.join(output, 'voice.wav')).root.role).toBe('source');
    expect(() => policy.authorizeWrite(path.join(output, 'voice.wav'))).toThrow('Extension');
  });

  it.each(['import_media', 'place_voiceover', 'place_music'])('uses the common policy at the public %s entry point', async name => {
    const handlers = new Map<string, any>();
    const server: any = { registerTool: (key: string, _schema: unknown, run: any) => handlers.set(key, run) };
    const host: any = { mutate: vi.fn(async () => ({ status: 'pass' })) };
    registerProjectMediaTools(server, host, policy); registerEffectTools(server, host, policy);
    const pins = { expectedProjectId: 'p', expectedSequenceId: 's' };
    const args = name === 'import_media' ? { filePaths: [path.join(media, 'voice.wav'), path.join(media, 'video.mp4')] } : { filePath: path.join(media, 'voice.wav'), timeSeconds: 2, audioTrackIndex: 0 };
    expect((await handlers.get(name)({ ...pins, ...args })).isError).not.toBe(true);
    expect(host.mutate).toHaveBeenCalledWith(name, expect.objectContaining({ ...pins, ...args }), undefined);
    host.mutate.mockClear();
    const invalid = name === 'import_media' ? { filePaths: [path.join(media, 'voice.wav'), path.join(media, 'bad.exe')] } : { filePath: path.join(media, 'bad.exe') };
    const denied = await handlers.get(name)({ ...pins, ...args, ...invalid });
    expect(denied.isError).toBe(true);expect(denied.structuredContent).toMatchObject({ code: 'EXTENSION_NOT_ALLOWED', contentDispatched: false, errorClassification: 'preflight' });
    expect(host.mutate).not.toHaveBeenCalled();
  });

  it('does not expand writes, including NAS roots marked readWrite by mistake', () => {
    expect(() => policy.authorizeWrite(path.join(media, 'voice.wav'))).toThrow('outside configured roots');
    expect(policy.authorizeWrite(path.join(output, 'new.mp4')).root.role).toBe('output');
    const nas = new PathPolicy([{ ...sourceMediaRoots([registered], mediaExtensions)[0]!, isNas: true, access: 'readWrite' }], { mediaReadExtensions: mediaExtensions });
    expect(() => nas.authorizeWrite(path.join(registered, 'new.wav'))).toThrow('Writes are forbidden');
  });

  it('denies relative and non-media paths with roots and remedies', () => {
    for (const value of ['relative.wav', path.join(media, 'bad.exe')]) {
      try { policy.authorizeRead(value); expect.fail('must refuse'); }
      catch (error: any) {
        expect(error.message).toContain('Allowed roots:');expect(error.message).toContain('Resolution:');
        expect(error.details.allowedRoots).toEqual(expect.arrayContaining([expect.objectContaining({ path: output })]));
        expect(error.details.mediaReadScope).toMatchObject({ enabled: true, access: 'readOnly' });
        expect(error.details.suggestion).toContain('test-settings.json');
      }
    }
  });

  it('does not let all-local reads bypass a configured root or a new-folder junction', async () => {
    const configuredLink = path.join(registered, 'escape'), localLink = path.join(sandbox, 'redirect');
    await symlink(media, configuredLink, 'junction'); await symlink(media, localLink, 'junction');
    // Direct input is allowed; an alias escaping the stated boundary is not.
    expect(policy.authorizeRead(path.join(media, 'voice.wav')).root.access).toBe('readOnly');
    for (const alias of [configuredLink, localLink]) {
      expect(() => policy.authorizeRead(path.join(alias, 'voice.wav'))).toThrow('escaped through a link');
      await expect(readCaptionSrt(path.join(alias, 'captions.srt'), policy)).rejects.toThrow('escaped through a link');
      expect(() => policy.authorizeWrite(path.join(alias, 'new.mp4'))).toThrow();
    }
  });
});
