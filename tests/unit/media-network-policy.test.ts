import { beforeEach, describe, expect, it, vi } from 'vitest';
import path from 'node:path';

const filesystem = vi.hoisted(() => ({ targets: new Map<string, string>() }));
vi.mock('node:fs', () => ({
  existsSync: (candidate: string) => filesystem.targets.has(candidate),
  realpathSync: { native: (candidate: string) => filesystem.targets.get(candidate) ?? candidate },
  statSync: () => ({ isFile: () => true }),
}));
import { PathPolicy } from '../../apps/mcp-server/src/path-policy.js';

// Filesystem protocol proof only: no NAS connection or credentials in unit tests.
const share = process.platform === 'win32' ? '\\\\arbitrary-workstation-nas\\new-share' : '/Volumes/arbitrary-workstation-nas';
const media = path.join(share, 'new title', 'voice.wav');
beforeEach(() => { filesystem.targets.clear(); filesystem.targets.set(media, media); });

describe('explicit network media without hard-coded NAS roots', () => {
  it('reads an unregistered share as a source and cannot write to it', () => {
    const policy = new PathPolicy([], { mediaReadExtensions: ['.wav'] });
    expect(policy.authorizeRead(media)).toMatchObject({ path: media, root: { isNas: true, access: 'readOnly', role: 'source' } });
    expect(() => policy.authorizeWrite(media)).toThrow('outside configured roots');
  });

  it('refuses a network link redirect and keeps the extension allowlist', () => {
    const policy = new PathPolicy([], { mediaReadExtensions: ['.wav'] });
    const executable = path.join(share, 'payload.exe');
    filesystem.targets.set(executable, executable);
    expect(() => policy.authorizeRead(executable)).toThrow('Extension');
    filesystem.targets.set(media, path.join(share, 'somewhere else', 'voice.wav'));
    expect(() => policy.authorizeRead(media)).toThrow('escaped through a link');
  });
});
