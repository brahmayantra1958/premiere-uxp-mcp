import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod/v4';
import { registerInspectionTools } from '../../apps/mcp-server/src/inspection-tools.js';
import path from 'node:path';
import {freshTestDirectory} from '../helpers/workspace.js';

describe('review frame navigation', () => {
  it.each([undefined, true])('forwards the requested restoration policy for every frame: %s', async restorePlayhead => {
    const directory=await freshTestDirectory('review-frame-navigation');
    let tool: any;
    const server = { registerTool: (name: string, definition: any, run: any) => { if (name === 'export_review_frames') tool = { definition, run }; } };
    let position = 7;
    const host = {
      mutateLocal: async (_name: string, _args: any, run: any) => run(),
      read: vi.fn(async (_name: string, args: any) => {
        if (!args.restorePlayhead) position = args.timeSeconds;
        return { status: 'pass', frame: { finalizedSha256: 'hash' } };
      }),
    };
    const paths = { authorizeWrite: (value: string) => ({ path: value, root: { role: 'output' } }) };
    registerInspectionTools(server as any, {} as any, host as any, paths as any, {} as any);
    const args = z.object(tool.definition.inputSchema).parse({ expectedProjectId: 'p', expectedSequenceId: 's', expectedSequenceName: 's',
      timesSeconds: [12, 23], outputPaths: [path.join(directory,'one.png'),path.join(directory,'two.png')], ...(restorePlayhead === undefined ? {} : { restorePlayhead }) });
    const reply = await tool.run(args);
    expect(reply.isError).not.toBe(true);
    expect(host.read).toHaveBeenCalledTimes(2);
    expect(host.read.mock.calls.map((call: any) => call[1].restorePlayhead)).toEqual([restorePlayhead ?? false, restorePlayhead ?? false]);
    expect(position).toBe(restorePlayhead ? 7 : 23);
  });
});
