import {guidanceInventory} from './guidance-lib.mjs';

/** Production-specific replay scripts and cleanup jobs are developer tooling,
 * not a public installation interface. Keep their local package entries intact. */
export function portablePackage(manifest) {
  const names=['build','build:native-bridge','typecheck','lint','test','test:watch','check','start','start:pair','start:ready','runtime:status','runtime:stop','dev:server','dev:plugin','package:release','install:prepare','guidance:check','skills:install'];
  return {...manifest,scripts:Object.fromEntries(names.map(name=>{
    if(typeof manifest.scripts?.[name]!=='string')throw Error('Missing public package script: '+name);
    return [name,manifest.scripts[name]];
  }))};
}

// Dependencies invoked by the optional SDK build are part of the source
// release even when proprietary SDK headers and compiled add-ons are absent.
export const releaseBuildInputs=[
  'tests/native/native-read-request.cpp','tests/native/native-runtime-config.cpp',
  'apps/native-read-bridge/NativeRuntimeConfiguration.h','apps/native-read-bridge/NativeRuntimeSettings.h',
  'apps/native-read-bridge/NativeReadRequest.h','apps/native-read-bridge/NativeClipClock.h',
];

/** A release ships one closed operator-guide dependency set, not personal
 * approvals/history or arbitrary files found under docs/skills. */
export function releasePolicy(root) {
  const guidance = new Set(guidanceInventory(root).files);
  const rootFiles = new Set(['.gitattributes','README.md','AI_INSTALL.md','LICENSE','THIRD_PARTY_NOTICES.md','package.json','package-lock.json','tsconfig.base.json','eslint.config.mjs','vitest.config.mts','Setup.cmd','Setup.command','Connect.cmd','Connect.command']);
  const helperInstallers = new Set(['install-cep-caption-helper.ps1','install-cep-track-targeting.ps1','install-cep-project-selection.ps1','install-cep-effect-disclosure.ps1']);
  // README renders this image with an HTML <img>, which the markdown link checks do not see.
  const publicAssets = new Set(['docs/assets/build-timelapse.webp']);
  return name => {
    const parts = name.split('/');
    if (parts.some(part => ['node_modules','dist','bin','artifacts','.git','deprecated'].includes(part)) || /\.(?:tsbuildinfo|log|p12|pem|exe|dll|prm|acsrf)$/.test(name) || parts.some(part => part.startsWith('.env')) || name === 'apps/uxp-plugin/public/deployment-config.js') return false;
    if (guidance.has(name) || [...guidance].some(file => file.startsWith(name+'/'))) return true;
    if (publicAssets.has(name) || [...publicAssets].some(file => file.startsWith(name+'/'))) return true;
    if (parts.length === 1) return rootFiles.has(name) || ['apps','packages','scripts','installer','tests'].includes(name);
    if (['apps','packages','installer'].includes(parts[0])) return true;
    if (parts[0] === 'scripts') return ['runtime','distribution'].includes(parts[1]);
    if (parts[0] === 'tests') return ['unit','contract','helpers','fixtures','native'].includes(parts[1]) || name === 'tests/live-premiere' || parts.length === 3 && helperInstallers.has(parts[2]);
    return false;
  };
}
