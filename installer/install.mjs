import { existsSync, writeFileSync, mkdirSync, openSync, closeSync, unlinkSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import path from 'node:path';
import process from 'node:process';
import console from 'node:console';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { assertSupported, adobeInstaller, defaultSettings, mcpConfiguration, premiereIsRunning, readJson, run, writeJson, writeLocalDeployment, zipDirectory } from './lib.mjs';
import { installTrackLockHelper } from './track-lock-helper.mjs';
import { setupOptions } from './setup-options.mjs';
import { connectInstallation } from './connect.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const options=setupOptions(process.argv.slice(2),{interactive:Boolean(process.stdin.isTTY)});
if(options.help) {
  console.log('Setup: --client codex|claude|gemini|both|none [--non-interactive] [--no-connect|--connect]\nOptional: --client-config <absolute file> --skills-target <absolute directory> --replace-client --replace-skills\nPrepare only: --prepare-only [--skip-dependencies]\nOptional verified SDK payload: --native-addons <absolute directory>\nSee AI_INSTALL.md and docs/installation.md.');
  process.exit(0);
}
const {prepareOnly}=options;
assertSupported();
async function ask(message) {const input=createInterface({input:process.stdin,output:process.stdout});try{return await input.question(message);}finally{input.close();}}
if(!prepareOnly&&!options.client) {
  // Existing numbers keep their meaning; Gemini (Antigravity) is appended.
  const choice=(await ask('Install MCP and four skills for: 1 Codex, 2 Claude Code, 3 Both (Codex and Claude Code), 4 Manual, 5 Gemini (Antigravity) (default 1): ')).trim();
  options.client=({'':'codex','1':'codex','2':'claude','3':'both','4':'none','5':'gemini'})[choice];
  if(!options.client)throw Error('Choose 1, 2, 3, 4 or 5; no installation was performed');
}
const resultDirectory = path.join(root, 'artifacts/install');
mkdirSync(resultDirectory, { recursive: true });
const lock = path.join(resultDirectory, 'setup.lock');
const lockHandle = openSync(lock, 'wx');
const receipt = { status: 'RUNNING', platform: process.platform, arch: process.arch, root, steps: {}, livePremiere: 'UNVERIFIED' };
function step(name, action) { console.log(`\n${name}`); action(); receipt.steps[name] = 'PASS'; writeJson(path.join(resultDirectory, 'receipt.json'), receipt); }
try {
  // Never update binaries under a running editor/runtime or terminate user work.
  step('Preflight', () => {
    const runtimeState = path.join(root, 'artifacts/runtime/runtime-daemon-state.json');
    if (existsSync(runtimeState)) {
      const state = readJson(runtimeState);
      if (Number.isSafeInteger(state.processId)) {
        let running = false; try { process.kill(state.processId, 0); running = true; } catch (error) { if (error.code !== 'ESRCH') throw error; }
        if (running) throw Error('Stop this installation runtime before updating: npm run runtime:stop');
      }
    }
    if (!prepareOnly) {
      const probe = process.platform === 'win32'
        ? spawnSync('tasklist.exe', ['/FI', 'IMAGENAME eq Adobe Premiere Pro.exe', '/FO', 'CSV', '/NH'], { encoding: 'utf8', windowsHide: true })
        : spawnSync('/bin/ps', ['-ax', '-o', 'comm='], { encoding: 'utf8' });
      if (probe.error || probe.status !== 0) throw Error('Could not check whether Premiere is closed.');
      if (premiereIsRunning(probe.stdout)) throw Error('Save your project and quit Premiere before installing. Setup does not close it.');
      if (!existsSync(adobeInstaller())) throw Error('Adobe Creative Cloud/UXP installer is missing. See docs/installation.md for prerequisites.');
    }
  });
  const environment = { ...process.env, PATH: path.dirname(process.execPath) + path.delimiter + (process.env.PATH ?? '') };
  const npm = process.platform === 'win32' ? path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js') : path.resolve(path.dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js');
  const npmRun = args => run(process.execPath, [npm, ...args], { cwd: root, env: environment });
  if (!options.skipDependencies) step('Install locked dependencies', () => npmRun(['ci', '--no-audit', '--no-fund']));
  // Parse every selected client and preview skill conflicts before Adobe changes.
  let registerClients;
  if(!prepareOnly) {
    ({registerClients}=await import('./client-registration.mjs'));
    const plan=registerClients({root,node:process.execPath,...options});
    writeJson(path.join(resultDirectory,'client-plan.json'),plan);
    if(plan.status==='CONFLICT')throw Error('Existing premiere entry or skills conflict. See artifacts/install/client-plan.json. Compare them before explicitly using --replace-client/--replace-skills. No client configuration was changed.');
  }
  step('Build', () => npmRun(['run', 'build']));
  for (const folder of ['runtime', 'scratch', 'output', 'proxies']) mkdirSync(path.join(root, 'artifacts', folder), { recursive: true });
  const settings = path.join(root, 'artifacts/settings.json');
  step('Local settings', () => {
    if (!existsSync(settings)) writeJson(settings, defaultSettings());
    // Use the same schema and discovery as the running server; refuse bad settings.
  });
  const configuration = await import(new URL('../apps/mcp-server/dist/config.js', import.meta.url));
  if (configuration.installationSettings.premiereRoot === undefined) {
    const { discoverPremiereRoot } = await import(new URL('../apps/mcp-server/dist/installation-settings.js', import.meta.url));
    const premiereRoot = discoverPremiereRoot();
    if (premiereRoot) writeJson(settings, { ...readJson(settings), premiereRoot });
  }
  if (process.platform === 'win32' && !prepareOnly) step('Install bounded signed CEP helpers', () => {
    for (const [script, args] of [
      ['install-cep-caption-helper.ps1', []], ['install-cep-track-targeting.ps1', []],
      ['install-cep-project-selection.ps1', ['-Apply']], ['install-cep-effect-disclosure.ps1', ['-Apply']],
    ]) run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'tests/live-premiere', script), ...args], {env:environment});
  });
  if (!prepareOnly) {
    const helper = await installTrackLockHelper({root,apply:true});
    receipt.steps['Install signed track lock helper'] = helper.status;
    writeJson(path.join(resultDirectory, 'track-lock-helper.json'),helper);
  }
  if(!prepareOnly) {
    const {prepareNativeAddons}=await import('./native-addons.mjs');
    if(options.nativeAddons) {
      const native=await prepareNativeAddons({root,payloadDirectory:options.nativeAddons,premiereRoot:readJson(settings).premiereRoot,apply:true});
      receipt.nativeAddons=native;
      if(!['installed','PASS','pass'].includes(native.status))throw Error('Requested SDK add-ons were not installed: '+native.status);
    } else receipt.nativeAddons={status:'NOT_REQUESTED',reason:'Optional Adobe SDK add-ons are separate; see docs/installation.md'};
  }
  step('Create local plugin and MCP configuration', () => {
    writeLocalDeployment(root);
    const mcp = mcpConfiguration(root, process.execPath);
    writeJson(path.join(resultDirectory, 'mcp.json'), mcp);
    writeFileSync(path.join(resultDirectory, 'codex.toml'), `[mcp_servers.premiere]\ncommand = ${JSON.stringify(process.execPath)}\nargs = [${JSON.stringify(mcp.mcpServers.premiere.args[0])}]\n[mcp_servers.premiere.env]\nPREMIERE_MCP_PROFILE = "inspect,edit,delivery"\n`);
    zipDirectory(path.join(root, 'apps/uxp-plugin/dist'), path.join(resultDirectory, 'PremiereUXPMCP.ccx'), name => !name.endsWith('.map'));
    // Paths are JSON arguments, never executable shell strings.
    writeFileSync(path.join(resultDirectory, 'connection-instructions.txt'), `Selected client: ${options.client??'none (preparation only)'}\nCheck receipt.json and client-registration.json for actual registration/skill results.\nManual MCP configuration: ${path.join(resultDirectory, 'mcp.json')}\nManual Codex configuration: ${path.join(resultDirectory, 'codex.toml')}\nOpen Premiere, a saved local project, a sequence and the Premiere UXP MCP panel.\nThen continue Setup or double-click Connect${process.platform === 'win32' ? '.cmd' : '.command'} in the installation folder.\nReconnect the selected AI client and verify its MCP/skill catalog.\nSettings: ${settings}\nAI installation guide: ${path.join(root,'AI_INSTALL.md')}\nAgent guidance: ${path.join(root, 'docs/agent-start-here.md')}\n`);
    writeJson(path.join(resultDirectory, 'node.json'), { executable: process.execPath });
  });
  if (!prepareOnly) step('Install UXP package through Adobe', () => run(adobeInstaller(), [process.platform === 'win32' ? '/install' : '--install', path.join(resultDirectory, 'PremiereUXPMCP.ccx')]));
  if(!prepareOnly)step('Register selected MCP clients and four bundled skills',()=>{
    receipt.clients=registerClients({root,node:process.execPath,...options,apply:true});
    if(receipt.clients.status==='CONFLICT')throw Error('Client/skills changed during setup; inspect client-plan.json and retry registration separately');
  });
  receipt.status = prepareOnly ? 'PREPARED' : 'INSTALLED';
  receipt.limitations = process.platform === 'darwin' ? ['Windows native UI adapters and legacy caption/targeting/selection/disclosure helpers are not installed on macOS. Track-lock helper installation is included; its Adobe Intel signer requires Rosetta on Apple Silicon. See the support matrix.'] : ['Adobe SDK add-ons require separate SDK builds; see the support matrix.'];
  writeJson(path.join(resultDirectory,'receipt.json'),receipt);
  console.log(`\n${receipt.status}. See ${path.join(resultDirectory, 'connection-instructions.txt')}\nRestart the selected AI client to load its MCP entry and skills. Open Premiere, a saved local project, a sequence, and Window > UXP Plugins > Premiere UXP MCP.`);
  let connect=options.connect;
  if(!prepareOnly&&!options.nonInteractive&&!options.noConnect)connect=(await ask('When the panel is open, press Enter to pair and verify (or type later): ')).trim().toLowerCase()!=='later';
  if(!prepareOnly&&connect) {
    // An installed package remains installed when a later live check fails.
    try {receipt.connection=connectInstallation({root});receipt.livePremiere='PASS';console.log('Connection PASS. Editing is UNVERIFIED; verify tools and current context in the AI client.');}
    catch(error) {receipt.livePremiere='FAILED';receipt.connection={error:String(error)};console.error('Installed; connection still needs attention. Open the panel and retry Connect. '+error);process.exitCode=1;}
  } else if(!prepareOnly)console.log('Run Connect.cmd / Connect.command when the panel is open. Live connection and editing are UNVERIFIED.');
} catch (error) {
  receipt.status = 'FAILED'; receipt.error = String(error); throw error;
} finally {
  writeJson(path.join(resultDirectory, 'receipt.json'), receipt);
  closeSync(lockHandle); unlinkSync(lock);
}
