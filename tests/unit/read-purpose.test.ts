import { describe, expect, it } from 'vitest';
import { bridgeRequestSchema } from '../../packages/contracts/src/index.js';
import { isJobPreservationRead } from '../../packages/contracts/src/read-purpose.js';
import { UxpBridgeServer } from '../../apps/mcp-server/src/bridge.js';
import { freshTestDirectory } from '../helpers/workspace.js';
import path from 'node:path';

describe('runtime-owned verification read purpose', () => {
  const query = { version: 1, id: 'proof', command: 'query_timeline', args: { ids: ['audio:0:0:source'], includeEffects: true }, timeoutMs: 1000 };

  it('survives the actual control wire schema without moving into public query args', () => {
    const request = bridgeRequestSchema.parse({ ...query, readPurpose: 'job_preservation' });
    expect(request.readPurpose).toBe('job_preservation');
    expect(request.args).toEqual(query.args);
    expect(bridgeRequestSchema.parse(query).readPurpose).toBeUndefined();
  });

  it.each(['set_effect_values', 'get_effect_values', 'set_effect_disclosure', 'focus_timeline'])('cannot attach verification purpose to %s', command => {
    expect(isJobPreservationRead(command, 'job_preservation')).toBe(false);
    expect(bridgeRequestSchema.safeParse({ ...query, command, readPurpose: 'job_preservation' }).success).toBe(false);
  });

  it('rejects an unknown purpose', () => {
    expect(bridgeRequestSchema.safeParse({ ...query, readPurpose: 'silent' }).success).toBe(false);
  });

  it('does not admit external/control callers into the owner-only purpose lane', async () => {
    const directory = await freshTestDirectory('read-purpose-admission');
    const bridge = new UxpBridgeServer('127.0.0.1', 0, path.join(directory, 'token'), path.join(directory, 'credentials'));
    // No socket/listener is started. Refusal precedes native connection access.
    await expect(bridge.call(bridgeRequestSchema.parse({ ...query, readPurpose: 'job_preservation' }))).rejects.toThrow('INTERNAL_READ_PURPOSE_FORBIDDEN');
  });
});
