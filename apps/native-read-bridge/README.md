# Native evaluated effect read adapter

This separate Adobe Export Controller adapter obtains a
legitimate `PrTimelineID` for the SDK Video Segment suite. The existing Control
Surface API does not provide that ID. It performs no export and no content edit.
The only requested work is inspecting one segment at one time and one parameter
of a named effect. Results must be correlated with the exact UXP target before
becoming MCP evidence. Installation and host proof are per workstation; see the
[portable native add-on contract](../../docs/native-addons.md). Production `get_effect_values` uses
it for Color between keys on a verified constant-rate retimed/reversed, media-backed video clip.
The runtime correlates clip bounds, source path/in-out, full effect multiset and
SDK time with UXP. Duplicate matches use exact-key references and same-process
runtime instance IDs, never assumed operator ordering. Unresolved ambiguity is
reported as unverified. Retimed/reversed constant-rate work obtains a command-local SDK time proof before
sampling or key edits. Non-linear mappings remain unverified.

The request has a fixed token-authenticated six-line format, expiry, nonce,
sequence ticks, effect match name and parameter index. File paths, native node
IDs, executable text and command IDs cannot be supplied. Request/result files
are fixed filenames under the installation runtime directory loaded once from
the versioned per-user binding. Binaries contain no installation token or local
checkout path. No background worker or idle polling.
Traversal and time are bounded. SDK objects are released inside the callback.
Replay protection retains at most 1,024 still-valid nonces, prunes expiry on
each request, and rejects expired requests independently. It does not impose a
1,024-read application-lifetime limit. The request codec and a 5,000-read replay
window test pass; live host throughput is a separate claim.

Installation artifact: `PremiereMcpNativeRead.prm`; the fixed destination below
the selected Premiere installation is `PlugIns/Common/`. Distribution and
installation use the current portable contract, not historical approvals.
Fixed `NativeReadTrigger.cs` requires API
timeline focus, refreshes File→Export routing and invokes only this entry. It
uses semantic menu commands, with no mouse or keyboard events. The authenticated
`native_effect_sample` callback belongs to a pending, exact `get_effect_values`
command. Its separate `time_mapping` purpose also supports set/edit-effect-key
parents, only for their exact requested times (up to 64), start and midpoint.
The host advertises `effectNativeTimeProtocol: 1`; older runtimes fail promptly.
It accepts at most 16 parameter requests and eight in-clip key references
per parameter. Every request is serialized, nonce-correlated and bounded. The
normal effect disclosure/focus protocol follows the read. No new SDK pipe or
standalone general native command endpoint is enabled. Build/install receipts
and bounded callback lifecycle records live under ignored `artifacts/`.
