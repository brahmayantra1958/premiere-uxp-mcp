# Fixed caption import helper 0.2.3

This helper exposes only `create_caption_track_from_srt`. It creates a new track
with `Sequence.createCaptionTrack`; it does not edit existing caption text/style.
Only the exact active local project path/sequence ID/name and a repository
scratch SRT are accepted. There is no general QE/script/command interface.

0.2.3 requires `saveProject:false` and never calls `app.project.save`.
The heartbeat advertises `noAutomaticSave:true`; the server rejects older helpers
before dispatch. Saving is a separate explicit MCP operation.

The Node tool copies a user-supplied SRT into a SHA-256-addressed scratch file,
records original path/hash, validates number/timing, and verifies creation through
UXP. Panel 0.14.11 finalizes only the exact newly observed track ID/name/count/mute
on its held sequence. The public receipt contains compact proof, not repeated
project/effect snapshots that exceed the MCP SDK's 10 MiB stdio limit.

`tests/live-premiere/install-cep-caption-helper.ps1 -PrepareOnly` prepares and
verifies a signed package within this repository. Preparing is not installation
or loading. Inspect the current helper manifest and live heartbeat before use;
the source version does not prove which helper the current host loaded.
Development smoke tests use a disposable target to preserve production content.

After deployment, test on a disposable target: exact target guard → one import →
compact receipt → native new-track/count/timing proof → existing AV/track
preservation → explicit save only if requested. A timeout after dispatch is
UNVERIFIED; inspect the operation receipt and host state, never create another
track by retrying under a new ID. Inactive operations may be archived with the
official `archive_inactive_operation`, preserving their original receipts.

Ordinary user-authorized edits can use the existing saved local project and
sequence. See [caption tools and unsupported routes](../../skills/USER-video-edit-premiere/references/captions-graphics.md)
and [current dependency checks](../../docs/release-status.md).
