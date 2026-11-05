# Effect disclosure helper

Repository-local implementation; deployment requires the exact helper installation.
The user approved installation on 2026-09-15. Signed version 0.2.0 is installed at
`%APPDATA%/Adobe/CEP/extensions/ai.brahma.yantra.effect-disclosure` and starts
on Premiere activation, listening on loopback 8096. After a new install, Premiere
may require a normal restart to discover the extension. The installer neither
changes PlayerDebugMode nor requires administrator privileges.

This helper can read/write only `ECP.Filter.Expanded` for a uniquely verified native
component on the designated clip. It also permits the exact native
`BE.TimeRemapping` header for a video clip with exactly one Motion and Opacity
intrinsic. Installed-endpoint false→true→false has native readback proof. This
does not expose its Speed parameter graph or values. It exposes no script, preference-key, file, QE,
input or native command endpoint.

The host command queue must own the complete operation: resolve the current clip
and effect, clear selection and allow Effect Controls to process that change,
set the disclosure preference, reselect the same clip and independently observe
the native disclosure state. A successful helper response proves the preference,
**not** the visible UI. Never coalesce clear/reselect into one host turn.

The preference is shared by effect match name; it is not a per-clip content edit.
Duplicate instances require their observed componentIndex, and this route reports
group scope. Installed effect instances normally use public UXP Properties
instead, which can address duplicate instances independently. Generated native
owners (including audio Volume) still require this preference helper. No effect
parameter, timing or media is changed by this endpoint.
Timeout after dispatch is UNVERIFIED and quarantines further helper writes.

Historical 0.1.1 proof: `tests/live-premiere/verify-installed-effect-disclosure.mjs`
(Motion by default, or `opacity`) first collapses through the installed endpoint,
then executes an ordinary MCP property call. Native readback and screenshots prove
automatic expansion and, for Opacity, actual scroll; original clip and native mask
states remain identical. See `docs/native-visual-control-20260914.md` for evidence.
Current generalized protocol, lifecycle drivers and evidence are in
`docs/general-effects-20260915.md`; old standalone proof constructors predate
causal native bindings and must not be used to claim current-version verification.

`verify-time-remapping-header-cycle.mjs` checks the new intrinsic header through
this authenticated endpoint and leaves it collapsed. The fixed S03 operation
`collapse-current-effect-tree.mjs` combines this helper with UI-only archive
metadata and public parameter Properties, using a normal same-project reopen.
All 53 native disclosure arrows, including hidden descendants, were collapsed;
the original clip/effect values and all 35 native mask parameter contents match.
This is a repository-local operation, not a newly registered MCP cycle endpoint.

Updating files does not reload an existing CEP engine. After 0.1.1 installation,
only this helper's identified window was normally closed and reopened; Premiere
stayed running. Readiness now requires the configured version and a live PID.
Do not assume CEP clients have isolated ExtendScript globals. A diagnostic
attempt to clear this helper's global through the caption client broke its host
calls. Recover through this exact extension's normal lifecycle, then verify the
authenticated endpoint, actual listener owner and independent native state.
Never use another extension to overwrite or clear the running helper namespace.
