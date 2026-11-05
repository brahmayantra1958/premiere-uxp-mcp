# Premiere native visual adapter

Build using the user-supplied Adobe Premiere Pro 26.0 Windows C++ SDK:
`powershell -File scripts/runtime/build-native-visual-bridge.ps1`.
The SDK is an external build dependency under ignored `artifacts/sdk`; its
headers and sample source are not redistributed in this repository.
The compiled wrapper code's redistribution basis has not been established for
the current release; prebuilt SDK binaries are excluded from the public package.
See [optional native add-ons](../../docs/native-addons.md) for licensing evidence,
generic builds, destination configuration, exact installation and proof limits.

The compiled `artifacts/native-visual-build/PremiereMcpNativeVisual.acsrf` uses
Adobe's Control Surface lifecycle and host command suite. Its first slice offers
filtered command discovery and three fixed tool activations: selection, razor,
and Object Selection. It does not yet create or track a mask, expand effects,
or scroll parameters. No arbitrary SDK command, script or input endpoint exists.

The repository-local C# feature adapters separately implement native effect
section scrolling and existing-mask frame tracking, with independent readback.
For panel/effect work, a runtime-owned `PremiereEffectSessionBridge.exe` reuses the
fixed panel/state/scroll adapters over blocked stdin to avoid per-command process
startup. It performs no idle polling and exits on EOF. Its fixed operations do
not expand this SDK plugin's named-pipe command allowlist; each native state is
read afresh and correlated. See [effect execution and proof](../../skills/USER-video-edit-premiere/references/effects.md).
In 0.14.1 this worker also runs the approved no-argument Native Read menu trigger,
rediscovering the exact command per sample without adding SDK pipe operations.
Parameter observations use fresh sparse rows and same-command index hints with
independent native validation. See [bounded jobs and event waits](../../skills/USER-video-edit-premiere/references/jobs-events.md).
The 0.10.0 observer handles bounded arbitrary effect trees and validates exact
visible pane/selected clip independently of keyboard focus; panel focus has its
own native receipt. Scrolling may reuse child-index hints, but revalidates tree
count, roles, header/enable adjacency, selected tab and current bounds before
dispatch. A stale hint falls back to fresh enumeration. Header identity is
learned from an isolated disclosure transition, not a guessed screen position.
They do not expand this SDK pipe's command allowlist. See
[current scope and proofs](../../skills/USER-video-edit-premiere/references/masks-native.md).

The adapter accepts a token-authenticated, local named-pipe request. A blocking
I/O worker waits for requests; only the host's `Update` callback invokes Adobe.
Requests expire before dispatch and return correlated receipts. The server's
read-only `PremiereToolStateBridge` observes the actual native Tools pane through
MSAA. PASS requires exactly one selected requested tool in that same Premiere
process; accepted SDK dispatch alone, missing state, or a different tool remains
**UNVERIFIED**. The UXP host independently validates the proof and target identity.
No idle project scan, screen scan, timer or network polling runs in the adapter.

Installation is prepared with `scripts/runtime/install-native-visual-bridge.ps1`.
The fixed destination below the selected Premiere installation is
`PlugIns/ControlSurface/PremiereMcpNativeVisual.acsrf`. The script validates and
installs the matching Native Read/Native Visual pair. Review its prepared paths,
close Premiere normally, run with `-Apply`, restart
and add **Premiere MCP Native Visual** under Preferences → Control Surface.
No registry, Application Control, signing policy or security settings are changed.
If Windows blocks this separate plugin, stop and report the actual block. Check
the current installation's binary identity and native readback; historical proof
on a developer workstation does not establish this installation's support.
See [release dependencies and proof limits](../../docs/release-status.md).

Both ControlSurfaceBase and ControlSurfaceCommandBase suites are registered.
Host command-reference acquisition occurs on a requested host Update after
Connect returns; Connect and Update are not assumed to share a thread. After
writing a named-pipe receipt, a cancellable bounded read waits for client close
before disconnecting, because disconnect would discard unread response bytes.
Lifecycle errors are bounded and contain no credentials or clip contents.

Rollback: remove the newly added Control Surface entry, close Premiere normally,
then remove only the exact new `.acsrf` (or restore the installer's prior backup).
Native content edits are not part of this first adapter slice.
