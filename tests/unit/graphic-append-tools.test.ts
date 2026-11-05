import { expect, it, vi } from 'vitest';
import { z } from 'zod/v4';
import { createHash } from 'node:crypto';
vi.mock('node:fs/promises', () => ({ readFile: vi.fn(async () => Buffer.from('mogrt')) }));
import { registerGraphicsTools } from '../../apps/mcp-server/src/graphics-tools.js';

it('exposes trailing append only for MOGRT, defaults to empty track and preserves hash dispatch guards', async () => {
  const tools = new Map<string, any>(), host = { mutate: vi.fn(async () => ({ status: 'pass' })) };
  registerGraphicsTools({ registerTool: (name: string, config: any, handler: any) => tools.set(name, { config, handler }) } as any, host as any, { authorizeRead: (file: string) => ({ path: file }) } as any);
  const tool=tools.get('insert_mogrt_caption'), schema=z.object(tool.config.inputSchema);
  const base={ expectedProjectId:'p',expectedSequenceId:'s',expectedSequenceName:'S',expectedVideoTrackCount:1,expectedAudioTrackCount:1,expectedCaptionTrackCount:0,expectedTimelineItemCount:1,videoTrackIndex:0,expectedVideoTrackId:1,expectedVideoTrackName:'V',expectedVideoTrackItemCount:0,audioTrackIndex:0,timeSeconds:1,mogrtPath:'C:/fixture.mogrt',expectedMogrtSha256:createHash('sha256').update('mogrt').digest('hex') };
  expect(schema.parse(base)).toMatchObject({ insertionMode:'empty_track' });
  const append=schema.parse({ ...base,insertionMode:'trailing_append',expectedVideoTrackItemCount:1 });
  expect((await tool.handler(append)).structuredContent.status).toBe('pass');
  expect(host.mutate).toHaveBeenCalledWith('insert_mogrt_caption',expect.objectContaining({ insertionMode:'trailing_append',expectedVideoTrackItemCount:1 }),undefined);
  expect((await tool.handler({ ...append,insertionMode:'empty_track' })).isError).toBe(true);
  expect((await tool.handler({ ...append,expectedMogrtSha256:'0'.repeat(64) })).isError).toBe(true);
  expect(host.mutate).toHaveBeenCalledTimes(1);
  const rectangle=tools.get('insert_editable_graphic').config.inputSchema;
  expect(rectangle).not.toHaveProperty('insertionMode');
  expect(rectangle.expectedVideoTrackItemCount.safeParse(1).success).toBe(false);
});
