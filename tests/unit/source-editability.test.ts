import { describe, expect, it } from 'vitest';
import { derivativeEvidence, sourceEditability } from '../../apps/uxp-plugin/src/source-editability.js';
const ticks = (n: number) => String(BigInt(n) * 254016000000n);
describe('source handles are file-relative, with explicit uncertainty', () => {
  it('reports both handles independently of timeline placement', () => {
    expect(sourceEditability('original.mp4', ticks(12), ticks(2), ticks(5))).toMatchObject({ handles: { headSeconds: 2, tailSeconds: 7, extensionVerified: false }, warnings: [] });
  });
  it('warns at both file ends and retains the full source mapping', () => {
    const mapping = { originalPath: 'C:/original.mov', originalStartSeconds: 20, originalEndSeconds: 23, originalDurationSeconds: 40 };
    expect(sourceEditability('C:/cut.mov', ticks(3), '0', ticks(3), mapping)).toMatchObject({ handles: { headSeconds: 0, tailSeconds: 0 }, derivative: { suspected: true, mapping }, warnings: [expect.stringContaining('POSSIBLE_PRETRIMMED'), expect.stringContaining('NO_SOURCE_HANDLES')] });
  });
  it('does not call a single exhausted edge a zero-handle file', () => {
    expect(sourceEditability('original.wav', ticks(10), '0', ticks(3))).toMatchObject({ handles: { headSeconds: 0, tailSeconds: 7 }, warnings: [] });
  });
  it.each([undefined, '0', '-1', 'bad', ticks(1)])('keeps unreadable/inconsistent duration %s unknown', duration => {
    expect(sourceEditability('original.wav', duration, '0', ticks(3))).toMatchObject({ handles: { headSeconds: null, tailSeconds: null }, warnings: [expect.stringContaining('UNVERIFIED')] });
  });
  it.each(['U03_편집용_132f.mp4', 'C:/대사/조각/line.wav', 'C:\\render\\조각_프리미어_20261017\\overlay_f10-80.mov', 'C:/render/clip_f10-80.mov'])('flags a derivative clue without rejecting %s', path => {
    expect(derivativeEvidence(path).length).toBeGreaterThan(0);
    expect(sourceEditability(path, ticks(10), ticks(1), ticks(5)).handles).toMatchObject({ headSeconds: 1, tailSeconds: 5 });
  });
  it('does not label ordinary originals by extension or general names', () => expect(derivativeEvidence('C:/original/final_overlay.mp4')).toEqual([]));
  it('does not round a real sub-frame handle down to zero', () => expect(sourceEditability('clip.wav', ticks(1), '1', String(BigInt(ticks(1)) - 1n)).handles).toMatchObject({ headSeconds: 1 / 254016000000, tailSeconds: 1 / 254016000000 }));
});
