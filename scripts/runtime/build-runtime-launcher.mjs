import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath,URL} from 'node:url';
import {spawnSync} from 'node:child_process';
import process from 'node:process';
import console from 'node:console';

const root=fileURLToPath(new URL('../../',import.meta.url));
const output=resolve(root,'artifacts/runtime-launcher');
mkdirSync(output,{recursive:true});
if (process.platform === 'darwin') {
 const app=join(output,'PremiereMcpRuntimeLauncher.app/Contents');
 mkdirSync(join(app,'MacOS'),{recursive:true});
 const quote=value=>"'"+value.replaceAll("'", "'\\''")+"'";
 writeFileSync(join(app,'Info.plist'),'<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>ai.brahma.yantra.runtime-launcher</string><key>CFBundleExecutable</key><string>launcher</string><key>CFBundleName</key><string>Premiere MCP Runtime</string><key>CFBundlePackageType</key><string>APPL</string><key>LSUIElement</key><true/></dict></plist>');
 writeFileSync(join(app,'MacOS/launcher'),`#!/bin/sh\n[ "$#" -eq 0 ] || exit 64\ncd -- ${quote(resolve(root))} || exit 66\nexec ${quote(process.execPath)} ${quote(resolve(root,'apps/mcp-server/dist/runtime-cli.js'))} start\n`,{mode:0o755});
 console.log('Built fixed macOS runtime launcher.');
} else if (process.platform === 'win32') {
const executable=join(output,'PremiereMcpRuntimeLauncher.exe');
if (!process.env.WINDIR) throw Error('Windows directory is unavailable (WINDIR)');
const compiler=join(process.env.WINDIR,'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
if(!existsSync(compiler))throw Error('Existing Windows .NET compiler is unavailable; no dependency will be installed');
const literal=value=>'@"'+value.replaceAll('"','""')+'"';
const source=readFileSync(resolve(root,'apps/runtime-launcher/RuntimeLauncher.cs'),'utf8')
 .replace('__REPOSITORY__',literal(resolve(root)))
 .replace('__NODE__',literal(process.execPath))
 .replace('__LAUNCHER__',literal(executable));
const generated=join(output,'RuntimeLauncher.generated.cs');
writeFileSync(generated,source);
const result=spawnSync(compiler,['/nologo','/target:winexe','/optimize+','/out:'+executable,generated],{windowsHide:true,encoding:'utf8'});
if(result.error||result.status!==0)throw Error(result.error?.message??result.stdout+result.stderr);
console.log('Built fixed runtime launcher using existing Node and Windows .NET.');
} else {
 console.log('No desktop runtime launcher for this platform.');
}
