# Optional native SDK add-ons

The public source package includes the project's native adapter sources and
build/install tools. **It does not include Adobe SDK headers, SDK sample source,
or the compiled `.prm` / `.acsrf` add-ons.** Base Setup does not require Visual
Studio or an Adobe C++ SDK. Advanced features below need the separate add-ons;
installing the base UXP panel does not establish that they work.

| Feature | Additional dependency and proof |
| --- | --- |
| SDK evaluation of a video effect parameter, exact video time mapping used by effect/keyframe edits | Native Read `.prm`, the built C# trigger, exact UXP/SDK target correlation |
| Selection, Razor and Object Selection tool activation | Native Visual `.acsrf`, Control Surface registration, independent native selected-tool readback |
| UXP project/timeline reads and features with public UXP-only implementations | No SDK add-on required; each command still needs its normal readback |
| Native effect panel/state/scroll adapters | C# adapters built by Windows Setup; this is separate from SDK add-on installation |

An absent add-on is a feature dependency, not a reason to claim all editing is
unavailable. Conversely, a connected UXP panel is not evidence for native time
mapping or tool activation. Setup records `NOT_REQUESTED`, `unavailable`, or
`blocked` when appropriate. `NATIVE_PAYLOAD_MISSING` means no payload was supplied;
`NATIVE_REDISTRIBUTION_UNVERIFIED` means the distributor has not established the
payload's redistribution basis. A runtime response such as
`NATIVE_READ_CREDENTIAL_UNAVAILABLE` or `NATIVE_VISUAL_PIPE_UNAVAILABLE` must be
reported with the missing add-on and this document. Do not turn a missing native
proof into PASS or bypass the readback requirement. Other hosts/platforms remain
UNVERIFIED or UNSUPPORTED for these add-ons.

## Redistribution status

As checked on 2026-11-03, the locally supplied Adobe Premiere Pro 26.0 C++ SDK
contains Adobe copyright/confidentiality notices in the two Control Surface
wrapper `.cpp` files compiled into Native Visual. No standalone SDK license was
found in that local SDK tree. The project's license cannot relicense Adobe's
files. This is an **unverified redistribution basis**, not a determination that
Adobe forbids distributing every Premiere plug-in.

Adobe's [official Premiere developer page](https://developer.adobe.com/premiere-pro/)
provides the SDK download and describes account-dependent access. It does not
state the applicable redistribution grant. A developer's statement in an
[unanswered Adobe Community question](https://community.adobe.com/questions-729/is-commercial-sale-of-a-plugin-based-on-the-premiere-sdk-transmitter-sample-permitted-1645772)
is not a license for this release. Obtain the terms accepted with the exact SDK
download, or written Adobe clarification covering these wrapper sources in
compiled commercial/distributable plug-ins, before including binaries publicly.
Keep the required Adobe notices and any permitted-distribution conditions.

Until that evidence exists, the manifest remains
`redistribution.status: "unverified"` and the public packager/installer refuses
the payload. Maintainers must not change the status just to make a build green.
After review, record a precise evidence reference, `status: "verified"`,
`noticesFile: "ADOBE-NOTICES.txt"`, and the file's `noticesSha256` in the manifest.
The manifest checks integrity and the recorded review decision; it cannot prove
legal rights or publisher identity. Verify the release archive's trusted digest
separately. SDK headers/sample source and installation credentials stay excluded.

## Build once, configure on the destination PC

Windows x64 and Premiere 26.5 are the current bounded compatibility target. The
build machine needs a lawfully obtained Adobe Premiere Pro 26.0 Windows C++ SDK,
Visual Studio C++ x64 tools and a Windows SDK. A recipient of a future verified
prebuilt payload would need none of those build tools. Release builds use `/MT`,
so there is no separate dynamic MSVC runtime dependency.

Run from the checkout using PowerShell and an installed Node 24 executable:

```powershell
$candidate = Join-Path (Get-Location) 'artifacts/native-release/win-x64'
& './scripts/runtime/build-native-read-bridge.ps1' -SdkRoot '<SDK directory>' -OutputDirectory $candidate
& './scripts/runtime/build-native-visual-bridge.ps1' -SdkRoot '<SDK directory>' -OutputDirectory $candidate
node installer/native-addons.mjs --manifest --payload $candidate
```

The read build runs both `tests/native/native-read-request.cpp` and
`tests/native/native-runtime-config.cpp`, then compiles the SDK plug-in and fixed
C# trigger. The manifest generator requires matching portable build receipts.
Only the two exact named binaries, manifest, and required notices may enter a
verified distributable payload. `.obj`, `.lib`, `.exp`, test executables, SDK files,
build directories, and historical personalized binaries do not belong in it.

Both binaries are independent of the builder's token and checkout path. On the
destination PC, the installer creates or retains the installation token in
`artifacts/runtime/native-visual-config.json` and writes a fixed per-user binding
at `%LOCALAPPDATA%/PremiereUxpMcp/native-bridge-v1.txt`. The binding is strict UTF-8:

```text
PREMIERE_UXP_MCP_NATIVE_V1
<64 lowercase hex characters>
<absolute local checkout>\artifacts\runtime
```

Both settings files receive a private Windows DACL. Never share them. The loader
uses Windows Known Folders, validates the token/path and rejects linked or missing
paths; it derives only fixed native request/result/instance filenames. Network
checkout roots and reparse-point checkout/configuration paths are unsupported.
This restriction concerns installation data, not the separate media-source policy.
One host process retains one immutable binding. Moving/switching a checkout
requires updating the binding with the installer and normally restarting Premiere.
No request can supply a file path, arbitrary Adobe command, script, or shell input.

Native Visual's current plug-in ID is `ai.brahma.yantra.native-visual`; its local
pipe is `\\.\pipe\Brahma.Yantra.NativeVisual.v1.<Premiere PID>`. The native DLL,
MCP reader and payload manifest must use this exact pair. The installer accepts
only this ID. On reinstall it retains the existing token and unrelated settings
and privately backs up the prior configuration. It does not modify a running
installation. Candidate manifests/build receipts with a different namespace must
be rebuilt; editing only a manifest is insufficient.

## Installation and rollback

For a future verified payload, select it explicitly with Setup's
`--native-addons <absolute directory>` option. `prepareNativeAddons` in
`installer/native-addons.mjs` is read-only unless
`apply: true`. It checks the exact file set, PE x64 DLL format, hashes,
configuration protocol, Premiere version, plain filesystem paths and host state.

For an owner's locally built candidate, the existing native install scripts
support `-LocalBuild`. This checks local build receipts without representing
the candidate as redistributable. Both scripts prepare/install the matching pair:

```powershell
& './scripts/runtime/install-native-read-bridge.ps1' -LocalBuild -PayloadDirectory $candidate -PremiereRoot '<Premiere directory>' -NodeExe '<node.exe>'
# After reviewing the prepared destinations, normally quit Premiere and add -Apply.
```

Installation writes only the two fixed paths below the chosen Premiere directory:

- `PlugIns/Common/PremiereMcpNativeRead.prm`
- `PlugIns/ControlSurface/PremiereMcpNativeVisual.acsrf`

Administrator filesystem access may be needed. The installer never elevates,
closes Premiere, adds registry entries, changes signing/Application Control policy,
or registers a Control Surface automatically. After installation, start Premiere
and add **Premiere MCP Native Visual** in Preferences → Control Surface. A Windows
load block must be reported and resolved through the normal supported route.
The installer does not rewrite Premiere's stored Control Surface registrations
or other surfaces.

The installer retains backups and a receipt under `artifacts/native-install/`,
verifies copied hashes, and rolls back a failed transaction. For manual rollback,
close Premiere normally and use the receipt's exact file/backup pairs. Restore
both prior plug-ins and prior settings together; remove a new file only when the
receipt records no prior backup. Remove a newly registered Control Surface entry
when removing Native Visual. Never delete unrelated plug-ins or settings.

`installed: true` remains `hostVerified: false`. PASS requires a fresh MCP target,
visible Premiere panel/timeline, and correlated native/UXP readback. No other-PC
installation or live verification of these new portable candidates is claimed.

## Local preparation evidence

The portable C++ candidates compile on the maintainer workstation; request codec,
replay/expiry and 5,000-read tests, strict runtime configuration tests, and installer
payload integrity tests pass. These prove source/protocol/build behavior only.
Current native public redistribution is BLOCKED pending SDK license evidence;
destination installation and live host behavior remain UNVERIFIED.
