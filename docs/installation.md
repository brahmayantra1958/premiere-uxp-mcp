# Installation

## Prerequisites installed separately

- Windows x64 or macOS Intel/Apple Silicon, on an OS supported by your Premiere version.
- Adobe Premiere Pro 26.3+ and Creative Cloud Desktop. Some optional native features target Premiere 26.5 only.
- Codex, Claude Code or Gemini (the Antigravity app or CLI) for automatic MCP and skill registration. Other MCP clients use the generated configuration manually.
- UXP environment/UXP Developer Tool for the developer loading route. Enable Premiere's UXP developer mode yourself when required by Adobe. Setup does not change it.
- Internet access to nodejs.org, the npm registry and Adobe's GitHub repository.

No global Node, npm, Git, Python or Visual Studio is required for standard setup. Windows uses its .NET Framework C# compiler; a missing compiler produces an error. Adobe SDK add-ons are separate and require their SDK/build tools.

## One setup entry point

Extract the source package to a permanent local writable directory. Close Premiere normally. Run Setup.cmd on Windows or Setup.command on macOS. Do not run from a NAS, ZIP viewer or Program Files. Keep the folder: the MCP runtime runs from it.

Setup asks once for Codex, Claude Code, both of those, manual setup, or Gemini (Antigravity). It verifies the pinned Node archive SHA-256, installs package-lock.json dependencies, previews client/skill conflicts, builds supported components, preserves or creates artifacts/settings.json, and creates a local CCX and MCP configurations. Windows also installs the legacy bounded signed CEP helpers; both platforms install the separate track-lock helper. Adobe UPIA installs the CCX and owns any consent dialog. Setup then registers only the selected client's `premiere` entry and installs all four bundled skills. Once the user opens Premiere and the panel, Enter continues to pairing and connection verification. Choose `later` to use Connect separately.

A failed installation step stops with a nonzero exit code and records FAILED in artifacts/install/receipt.json. A later connection failure leaves the package INSTALLED with livePremiere FAILED and a separate connection receipt; retry Connect after resolving the cause. PREPARED is neither installed nor connected. Automated agents can follow the self-contained [AI installation guide](../AI_INSTALL.md).

For automation, choose a client explicitly and skip the terminal's final wait:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\installer\bootstrap.ps1 -Client codex -NonInteractive -NoConnect
```

```sh
/bin/bash Setup.command --client claude --non-interactive --no-connect
```

The Node entry point accepts `--client codex|claude|gemini|both|none` (`both` means Codex and Claude Code), `--non-interactive`, `--no-connect` and `--connect`. `--connect` immediately attempts verification when the panel is already open; Adobe installation itself still requires Premiere to be closed first. Noninteractive setup without a client is refused before installation. `none` generates manual config and does not modify a client's files or skills. Windows bootstrap uses corresponding PowerShell names (`-Client`, `-NonInteractive`, `-NoConnect`, `-Connect`). Running `Setup.cmd -Client codex -NoConnect` preserves its double-click terminal behavior. Agents should call bootstrap directly to avoid the batch file's final pause.

Default targets are Codex `$CODEX_HOME/config.toml` (or `~/.codex/config.toml`) with `~/.agents/skills`, Claude Code `~/.claude.json` with `~/.claude/skills`, and Gemini `~/.gemini/config/mcp_config.json` with `~/.gemini/config/skills`. `CLAUDE_CONFIG_DIR` redirects Claude's configuration directory, including `.claude.json` inside it. The Gemini targets are the global MCP file and global skills folder that the Antigravity app and CLI both read; the entry is written as `command`, `args` and `env`. A workspace `.agents/mcp_config.json` with its own `premiere` entry can take precedence in that workspace. A legacy Gemini CLI that reads `~/.gemini/settings.json` can use `--client gemini --client-config <home>/.gemini/settings.json --skills-target <home>/.gemini/skills`. With a single client, `--client-config <absolute file>` and `--skills-target <absolute directory>` override those targets. Configuration and skill paths containing links/junctions are refused. Existing other servers, settings and skills are retained. The installer does not alter trust, permissions or enabled-server policies.

The client plan is written to `artifacts/install/client-plan.json` without configuration contents or credentials. A differing unmanaged `premiere` entry or locally edited bundled skill is a conflict. Inspect the difference before using `--replace-client` / `--replace-skills` (`-ReplaceClient` / `-ReplaceSkills` in Windows bootstrap); originals are backed up under `artifacts/client-install-backups` and `artifacts/skill-install-backups`. Configs are parsed before writing, unrelated Codex TOML values are compared after merging, and concurrent changes are refused. Inline/dotted TOML layouts that cannot safely accept the target table require manual registration. Close or restart the affected AI client to prevent its own config writer from restoring an old version.

Use this CCX route for normal use. UDT is a separate developer route, not a prerequisite for using an installed CCX. Do not load competing CCX/UDT copies of this panel. Keep one intended installation root and compare it with the live deployment after loading.

<a id="developer-loading"></a>
### Developer loading with UDT

1. In a Node 24 development environment, run `npm ci` then `node installer/install.mjs --prepare-only --skip-dependencies` from the intended installation. This builds local artifacts without installing Adobe plugins. It does not prove helper installation or live support.
2. Open UXP Developer Tool as a normal visible application. When Adobe requires developer mode, follow its own UI; the installer does not enable it. Register the **absolute** `apps/uxp-plugin/dist/manifest.json` inside this installation and Load that entry for Premiere. Do not register the source manifest or another checkout's dist.
3. Open the Premiere UXP MCP panel, then complete First connection below. Newly required CEP/SDK helpers have separate installation and restart requirements; UDT Load cannot install them.
4. For later changes, rebuild the affected component and use the [recovery decision table](operator-runbook.md#recovery-decision). For panel-only code use `npm run build -w @premiere-uxp/uxp-plugin`; it also regenerates the local sidecar. A full native build can encounter an executable held by the existing owner; finish active work and stop that owner normally before rebuilding it. UDT code/sidecar changes use Reload; manifest changes use Unload → Load. CCX users follow Update and removal instead of attempting UDT Reload.

The panel ID and setup key remain `premiereUxpMcpPanel`. A collision is not a reason to rename that entrypoint. The build regenerates the machine-local `dist/deployment-config.js`; its public source stays blank. Never distribute this local sidecar, credentials or personalized CCX. Updating files alone does not replace an already loaded panel.

### macOS

The release ZIP preserves executable permissions for Setup.command and Connect.command. If a source ZIP stripped them, run `chmod +x Setup.command Connect.command` in that folder. If macOS blocks a downloaded script, review it and use the normal Open/security confirmation. Setup does not remove quarantine or change Gatekeeper. Terminal alternative: `/bin/bash Setup.command`.

The argument-free runtime launcher is generated locally as a .app. MCP clients also autostart the same Node runtime. If the local .app is blocked, connect through the MCP client or Connect.command. macOS support is experimental until a live acceptance run is recorded. C# adapters, Windows SDK plugins and legacy caption/targeting/selection/disclosure helper installation are unavailable there. The separate track-lock helper has a portable installer; Adobe's Intel 4.1.3 signer requires Rosetta on Apple Silicon. Setup does not install Rosetta or alter Gatekeeper. Video effect time/color/Point and keyframe paths requiring native proof remain unsupported.

## First connection

Open Premiere, save a local .prproj, select a sequence, then open Window → UXP Plugins → Premiere UXP MCP. Run Connect.cmd / Connect.command once to approve the next local connection and verify its context. Credentials are generated locally.

The selected Codex, Claude Code or Gemini entry and four skills are already installed by normal Setup. Restart/reconnect that client, then verify its actual MCP and skill catalog. In Antigravity, restart `premiere` under MCP Servers (the CLI reloads with `/mcp`) and open a new conversation. For manual clients, use artifacts/install/mcp.json; Codex's generated table is in artifacts/install/codex.toml. Preserve unrelated servers. No model bridge is needed. To repair registration without rebuilding or reinstalling Adobe plugins, use the Node executable in artifacts/install/node.json with `installer/client-registration.mjs --client codex` (preview), then add `--apply`. Use `--client claude` for Claude Code and `--client gemini` for Gemini; optional `--config` / `--skills-target` require a single client. This separate command also supports `--replace-client` / `--replace-skills` and uses the same backup/conflict rules.

Connect must return PASS and write artifacts/install/connection.json. It requires runtime ready, the panel version declared in this package's apps/uxp-plugin/public/manifest.json, panelMode agent and this installation's scratch root. Compare premiere_ping panelVersion with that manifest. Use [release status](release-status.md) for dependency limits and the live ping for the actually loaded version. An Adobe installer return code does not prove Premiere loaded the panel.

For a manual client or a UDT development install, install the [four bundled skills and their references](../skills/README.md#install) separately. In the MCP client, verify `tools/list`, `get_agent_context`, `premiere_ping` and, before editing, `get_mutation_recovery`. Confirm the intended current project/sequence, `premiere.deployment.panelVersion`, `panelMode` and `localScratchRoot` under this installation's `artifacts/scratch`. Keep project IDs from this fresh context, never from examples. Guidance is also available without personal skills through `resources/list` and `premiere://guide/installation`.

An installation receipt, a ready connection, skill availability and a verified edit are separate results. Report each with its own evidence. Initial setup should not create, clone, save or change a user's sequence merely to test the connection.

### Claude Code registration

Setup's Claude Code choice registers user scope so new creative folders can use the same server. It targets Claude Code, not Claude Desktop's separate settings. If an organization policy or a same-name project/local entry overrides it, inspect `claude mcp get premiere` and the current `/mcp` panel rather than deleting other scopes automatically. For manual CLI registration, run this in PowerShell from this installation directory after Setup:

```powershell
$premiereConfig = Get-Content -LiteralPath './artifacts/install/mcp.json' -Raw | ConvertFrom-Json
$premiereServer = $premiereConfig.mcpServers.premiere
$premiereArgs = @($premiereServer.args)
claude mcp add --scope user --env 'PREMIERE_MCP_PROFILE=inspect,edit,delivery' --transport stdio premiere -- $premiereServer.command @premiereArgs
claude mcp get premiere
```

On macOS or for manual registration, use the exact command and args from that
generated JSON (placeholders below are not literal paths):

```sh
claude mcp add --scope user --env PREMIERE_MCP_PROFILE=inspect,edit,delivery --transport stdio premiere -- /absolute/node /absolute/installation/apps/mcp-server/dist/index.js
```

Existing installations without that JSON may use their current absolute Node
executable and server entrypoint directly. A bundled/embedded Node is fine; no
global Node is needed. Quote paths containing spaces. Do not replace unrelated
MCP servers. In a new Claude Code session use `/mcp` to check `premiere`, then
`get_agent_context` and `premiere_ping`. For an already registered old definition,
inspect `claude mcp get premiere` first and update only that entry. See
[Claude Code's official stdio/scope documentation](https://code.claude.com/docs/en/mcp#option-3-add-a-local-stdio-server).

## Local settings

The server reads artifacts/settings.json, or the explicit PREMIERE_MCP_CONFIG file. For example:

```json
{
  "version": 1,
  "sourceRoots": [],
  "premiereRoot": "/Applications/Adobe Premiere Pro 2026/Adobe Premiere Pro 2026.app"
}
```

**Media needs no folder registration.** Pass the exact absolute WAV/MP4/SRT
or other supported media filename to import/placement tools, from any local
folder or accessible NAS share on Windows or macOS. No user name, NAS address, creative-root name, project directory
or ancestor depth is hard-coded. Setup defaults to empty sourceRoots. Existing
sourceRoots are compatible but unnecessary for direct media inputs.

`sourceRoots` remains available for explicit source boundaries;
all such roots are read-only. Unregistered UNC shares and mounted POSIX volumes
also accept explicit media filenames as read-only sources, without scanning the share.
Local file permission does not add a writable directory. Outputs/proxies/scratch
retain their existing artifact roots and role-specific extension restrictions.
Relative paths, non-media extensions, missing files, directories and redirected
link/junction paths are refused. Use a file's actual absolute target path when
an alias is rejected. A junction escaping a configured root cannot fall through
to the general explicit-file rule. Errors include `code`, `allowedRoots`,
`mediaReadScope`, `suggestion` and `contentDispatched:false`.

`import_caption_track` and `apply_srt_to_caption_track` now use the same path
policy as `import_media`, `place_voiceover` and `place_music`. SRT additionally
requires valid UTF-8, valid cues and at most 5 MiB; caption import still passes an
immutable scratch copy to the helper. There is no separate arbitrary-SRT bypass.

Use actual absolute paths in settings. Windows JSON paths can use forward
slashes. Setup discovers Premiere when possible; set premiereRoot for
nonstandard/multiple installations (application directory on Windows, .app on
macOS). Reconnect/restart the MCP **stdio client process** after changing settings
that it reads. If the shared owner also reads the changed settings or code, wait
for active work to finish, disconnect clients that could autostart it, stop/start
that owner normally, then reconnect clients. A new stdio connection reuses a
running owner and cannot refresh that owner's loaded code. Settings-only changes
need no Premiere restart or UXP Reload. Rerun Setup after moving the installation;
launcher, MCP configuration and plugin sidecar paths are local to it.

| Setting or file | Purpose and application boundary |
| --- | --- |
| `artifacts/settings.json` / `PREMIERE_MCP_CONFIG` | Version 1 installation settings. An explicit override is a full absolute filename; the owner and clients must use the intended same configuration. Restart affected processes after changing it. |
| `sourceRoots` | Optional read-only source boundaries; default `[]`. No per-project folder registration is required for explicit supported absolute media inputs. |
| `premiereRoot` | Actual Premiere application location when discovery is insufficient. It does not select the editing project. |
| `graphicsRoot` | Actual installed Essential Graphics directory, only when discovery fails. |
| MCP entry `command` / `args` | Exact Node executable and `apps/mcp-server/dist/index.js` generated by Setup. Update these if the installation moves. Do not replace unrelated MCP entries. |
| `PREMIERE_MCP_PROFILE` | Comma-separated tool exposure: `inspect` for reads, `edit` for editing, `delivery` for public save/close/open/export. Unset defaults to `inspect`; Setup generates all three. Change only as needed and reconnect that MCP client. This does not authorize unrelated actions. |
| `dist/deployment-config.js` | Generated local scratch/launcher/helper connection data. Rebuild with the supplied build configuration; do not hand-edit or publish tokens. UDT Reload applies a regenerated sidecar. |
| Personal skill folders | Instructions and references, separate from MCP registration. Reinstall, refresh the client's skill catalog and check a new conversation. UXP Reload cannot refresh skills. |

Do not turn project/sequence changes into installation settings. Discover fresh IDs through `get_agent_context`. Keep the user's current editing target and last work location. See the [exact restart and Reload procedure](operator-runbook.md#recovery-decision) before applying an update.

Optional `graphicsRoot` can point to an installed Essential Graphics directory
when template discovery fails. Missing templates produce ADOBE_TEMPLATE_UNAVAILABLE;
the server does not silently use a developer's template path.

Protocol ports are localhost 8099 (UXP), 8098 (targeting), 8097 (project selection), 8096 (effect disclosure). One installation owns them; concurrent installations are unsupported. The separate runtime control port is dynamic.

Track locking adds the dedicated authenticated localhost port 8095. For an existing
installation, prepare with `node installer/track-lock-helper.mjs --prepare-only`;
after installation approval and normal Premiere exit, use `--apply`. The helper
starts on a normal Premiere launch, not UDT Reload. Use UXP 0.15.1 or later;
apply code-only changes with Reload and manifest changes with Unload → Load when
using UDT. Reconnect MCP clients if their tools changed. [Usage and current live-verification
status](release-status.md).

## Optional features

Windows Setup includes the C# adapters and signed caption/targeting/project-selection/effect-disclosure CEP helpers. It does not change PlayerDebugMode or registry security policy. Restart Premiere normally to discover newly installed helpers.

The native visual .acsrf and native read .prm require Adobe SDK builds and separate installation/registration. They are not included in the basic source package. A separately supplied, redistribution-verified payload can be explicitly requested with `--native-addons <absolute directory>` (`-NativeAddons` on Windows bootstrap). The installer checks its manifest, hashes, host version, closed Premiere and destination; missing, damaged or rights-unverified requested payloads stop that optional installation. Installing files still leaves host loading/Control Surface registration UNVERIFIED. See [native add-ons](native-addons.md) for the host/version/readback requirements.

## Namespace upgrade

The UXP bundle ID is `ai.brahma.yantra.pr-uxp-mcp`; the panel entrypoint remains
`premiereUxpMcpPanel`. An older UDT registration is a different plugin: unload
that registration, remove only its UDT registration (keep the source files), and
use Add Plugin with this package's `apps/uxp-plugin/dist/manifest.json`. Then Load
the new registration. A manifest change with the same ID uses Unload → Load.
Do not keep both old and new panels loaded. Reconnect the
new panel and verify its version and installation path with Connect.

Optional CEP helpers use `ai.brahma.yantra.caption-helper`, `.track-targeting`,
`.project-selection`, `.effect-disclosure` and `.track-lock`. Their signed
installers require Premiere to be closed. Reinstalling a helper backs up the
current directory first and restores it if the new copy fails verification.
Existing projects, helper credentials and edit journals are kept.

The native visual add-on uses `ai.brahma.yantra.native-visual`; after installing
that optional update, follow the [native add-on registration](native-addons.md)
steps. The macOS runtime launcher uses `ai.brahma.yantra.runtime-launcher`.

FFmpeg is optional for media analysis/transcoding. Install ffmpeg/ffprobe on PATH, or use scripts/runtime/install-media-tools.ps1 on Windows. Basic UXP timeline operations do not require it. No segmentation model is installed automatically.

## Update and removal

Save and quit Premiere and close MCP clients. Stop the owner with its Node executable and `apps/mcp-server/dist/runtime-cli.js stop`, or `npm run runtime:stop`. Back up the installation, extract the new source package over it and rerun Setup. Settings, outputs and pairing credentials in artifacts are retained. Never replace artifacts with another person's copy. Setup refuses a running owner PID and does not kill it.

Interrupted installs retain a step receipt. Only remove a stale artifacts/install/setup.lock after proving the installer is no longer running. Correct the reported cause and rerun Setup. A failed later helper install does not roll back earlier successful helpers.

To remove, stop the runtime, remove only the premiere MCP entry and uninstall Premiere UXP MCP in Creative Cloud Manage Plugins. Remove only the helper directories named in this installation's receipts from the current user's Adobe/CEP/extensions directory. Remove separately installed SDK add-ons through their documented paths. Back up wanted outputs/projects, then remove the installation folder. Setup creates no OS login service or machine PATH entry.

For a development code update that does not install helpers, use the smaller action in the [runbook](operator-runbook.md#recovery-decision); saving or restarting Premiere is not a routine prerequisite for UDT Reload. Never reload a running job or replay an unknown result after reconnecting.

## Validation and release

`node installer/install.mjs --prepare-only` installs dependencies, builds and produces local files without installing Adobe plugins, modifying MCP clients or personal skills, starting a runtime or editing Premiere. Client registration/add-on/connection flags cannot be combined with this mode. Use --skip-dependencies only after npm ci. CI runs this mode on Windows and both Mac architectures; public runners have no live Premiere. Client merge/conflict/backup/skills tests run only against repository-local fixture homes. Windows is the primary platform; macOS is experimental. A complete install on another person's PC remains UNVERIFIED.

The real media integration test runs only when ffmpeg and ffprobe are available.
Without them it is reported as skipped; the core protocol and path tests still run.

`npm run package:release` creates artifacts/releases/*-source.zip plus SHA-256 using an explicit source allowlist. **Do not upload artifacts/install/PremiereUXPMCP.ccx**: it is personalized and may contain a helper token. CI uploads only clean source, never receipts, CCX, logs or credentials.

References: [CaYatur installer](https://github.com/CaYatur/PremiereProMCP/blob/fe105a1640e6b6a487e2a3918c80c09fa44dd975/installer/Setup.ps1), [leancoderkavy distribution](https://github.com/leancoderkavy/premiere-pro-mcp/blob/f610059a765c9cfc659b818c8c23b7c4995af978/uxp-plugin/DISTRIBUTION.md), [Adobe installation](https://developer.adobe.com/premiere-pro/uxp/plugins/distribution/install/), [Adobe packaging](https://developer.adobe.com/premiere-pro/uxp/plugins/distribution/package/).

## Agent guidance and skills

MCP initialization supplies the short operating contract. resources/list exposes fixed premiere://guide/* documents from this installation; resource reads do not query Premiere.
Normal Setup installs the four bundled skills for the selected client. For manual repair/update use the [skill installer](../skills/README.md). Keep SKILL.md and all references together. Preview the plan before apply; changed local files are backed up and require an explicit replacement choice. Other skills and MCP entries are preserved.
The release guidance-manifest.json records bundle/contract/server/panel versions and hashes. MCP-only clients can read the same documents without personal skill installation.
