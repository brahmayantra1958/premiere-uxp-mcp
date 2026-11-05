import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PANEL_ENTRYPOINT_ID, PANEL_VERSION } from '../../apps/uxp-plugin/src/plugin-contract.js';

const read = (name:string) => readFileSync(path.resolve(name),'utf8');
describe('public plugin namespace',()=>{
  it('keeps the user-selected bundle identity and stable panel entrypoint together',()=>{
    const manifest=JSON.parse(read('apps/uxp-plugin/public/manifest.json'));
    expect(manifest.id).toBe('ai.brahma.yantra.pr-uxp-mcp');
    expect(manifest.version).toBe(PANEL_VERSION);
    expect(manifest.entrypoints[0].id).toBe(PANEL_ENTRYPOINT_ID);
    expect(PANEL_ENTRYPOINT_ID).toBe('premiereUxpMcpPanel');
    expect(JSON.parse(read('apps/uxp-plugin/package.json')).version).toBe(PANEL_VERSION);
  });
  it('uses one current identity throughout each newly signed CEP manifest',()=>{
    for(const suffix of ['caption-helper','track-targeting','project-selection','effect-disclosure','track-lock']){
      const text=read(`apps/cep-${suffix}/CSXS/manifest.xml`);
      const ids=[...text.matchAll(/\b(?:ExtensionBundleId|Id)="([^"]+)"/g)].map(match=>match[1]);
      expect(ids).toEqual(Array(3).fill('ai.brahma.yantra.'+suffix));
    }
  });
  it('keeps native pipe producers and consumers on the same namespace',()=>{
    const producer=read('apps/native-visual-bridge/NativeVisualBridge.cpp'),consumer=read('apps/mcp-server/src/native-visual-bridge.ts');
    expect(producer).toContain('ai.brahma.yantra.native-visual');
    for(const text of [producer,consumer])expect(text).toContain('Brahma.Yantra.NativeVisual.v1.');
    expect(read('scripts/runtime/build-runtime-launcher.mjs')).toContain('ai.brahma.yantra.runtime-launcher');
  });
});
