import {existsSync,readFileSync} from 'node:fs';
import {it,expect} from 'vitest';
import {portablePackage,releasePolicy,releaseBuildInputs} from '../../scripts/distribution/release-policy.mjs';

it('ships every local input required by the optional native builds',()=>{
  const allow=releasePolicy('.');
  for(const input of releaseBuildInputs){expect(existsSync(input),input).toBe(true);expect(allow(input),input).toBe(true);}
  for(const blocked of ['artifacts/sdk/Adobe.h','installer/native/win-x64/private.prm','apps/native-read-bridge/private.pem'])expect(allow(blocked),blocked).toBe(false);
});
it('publishes usable package scripts without private production replay jobs',()=>{
  const manifest=JSON.parse(readFileSync('package.json','utf8')),portable=portablePackage(manifest);
  expect(portable.scripts.check).toBe(manifest.scripts.check);
  expect(portable.scripts['package:release']).toBe(manifest.scripts['package:release']);
  expect(Object.keys(portable.scripts).some(name=>/^(live:|media:|artifacts:clean|udt:|source:guard)/.test(name))).toBe(false);
  expect(portablePackage(portable)).toEqual(portable);
  expect(portable.scripts).not.toBe(manifest.scripts);
});
