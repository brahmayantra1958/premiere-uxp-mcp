import process from 'node:process';
import console from 'node:console';
import { fileURLToPath, URL } from 'node:url';
import { run } from '../../installer/lib.mjs';
if (process.platform === 'win32') run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', fileURLToPath(new URL('./build-premiere-feature-bridge.ps1', import.meta.url))]);
else console.log('Windows native UI adapters are unavailable on this platform; building the UXP/MCP core.');
