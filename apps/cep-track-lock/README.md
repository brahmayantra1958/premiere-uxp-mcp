# Track lock helper 0.1.0

This separate helper implements only `read_track_locks` and `set_track_locks` on
Premiere's ordinary ExtendScript video/audio Track objects. It uses `isLocked()`
and `setLocked(0|1)`. There is no QE, caller-supplied JSX, shell command, native
input, registry change, project save or automatic unlock around other edits.

The authenticated endpoint is `POST http://localhost:8095/locks`, bound to IPv4
loopback. Setup creates a random 256-bit credential per installation. The request
contains exact active project path, sequence ID/name, full V/A track ID/name
vectors and a bounded list of edits. Every edit is checked before the first
setter; only changed requested tracks are written. The returned native lock
vector proves both requested changes and preservation of untouched locks. Mute
is also preserved when exposed. Locking may natively remove track targeting;
the before/after states report this rather than retargeting automatically.

The host queue and existing durable MCP receipt lease serialize changes. IDs are
deduplicated, arbitrary fields rejected, and timeout/partial changes remain
UNVERIFIED. No rollback or replay occurs. The helper accepts a fresh read after
uncertainty, but its write latch clears only after all earlier callbacks finish
and an identity-checked full native read succeeds. The original receipt remains
immutable; the caller uses the normal inactive-operation archive workflow if
the main MCP lease remains quarantined.

Windows and macOS paths come from the current user profile and repository. Use
`node installer/track-lock-helper.mjs --prepare-only` to sign and verify privately
inside artifacts. `--apply` installs only while Premiere is closed, backs up an
existing helper, writes its connection file and updates the local UXP deployment
sidecar. This new external installation requires the repository's user approval.
Signed ZIP contents are bounded and path-checked. Preparation does not install.

On macOS Apple Silicon Adobe's 4.1.3 signer requires Rosetta; the installer does
not install Rosetta or bypass Gatekeeper. Signer downloads are SHA-256 pinned.
Neither signing keys nor personalized helper packages belong in public releases.

Load UXP 0.15.1 and start Premiere normally after helper installation. UDT reload
alone does not start a newly installed CEP helper. Caption track locks are not
exposed by this implementation. See [usage](../../skills/USER-video-edit-premiere/references/timeline.md)
and [current evidence and installation status](../../docs/release-status.md).
