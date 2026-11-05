/* Adobe ExtendScript ES3. Fixed track-lock operations only; no QE or script input. */
var BrahmaYantraTrackLocks = (function () {
    function normalized(value) {
        var p = String(value);
        if (p.charAt(0) === "/" && p.charAt(1) !== "/") return p;
        return p.replace(/\//g, "\\").replace(/^\\\\\?\\UNC\\/i, "\\\\").replace(/^\\\\\?\\/, "").toLowerCase();
    }
    function localProject(value) {
        var p = normalized(value);
        return (/^[a-z]:\\/.test(p) || (p.charAt(0) === "/" && p.charAt(1) !== "/" && !/^\/(Volumes|Network|net)(\/|$)/i.test(p))) && /\.prproj$/i.test(p) && !/(^|[\\/])\.\.([\\/]|$)/.test(p);
    }
    function guid(value) { return String(value).replace(/[{}]/g, "").toLowerCase(); }
    function json(value) {
        if (value === null) return "null";
        if (typeof value === "string") return '"' + value.replace(/["\\\x00-\x1f\u2028\u2029]/g, function (c) { var h = c.charCodeAt(0).toString(16); return "\\u" + ("0000" + h).slice(-4); }) + '"';
        if (typeof value === "boolean" || typeof value === "number") return String(value);
        var out = [], k, i;
        if (value instanceof Array) { for (i = 0; i < value.length; i++) out.push(json(value[i])); return "[" + out.join(",") + "]"; }
        for (k in value) if (value.hasOwnProperty(k)) out.push(json(k) + ":" + json(value[k]));
        return "{" + out.join(",") + "}";
    }
    function booleanState(value) {
        if (value === true || value === 1) return true;
        if (value === false || value === 0) return false;
        throw Error("LOCK_STATE_UNREADABLE");
    }
    function context(request) {
        if (!request || request.version !== 1 || (request.operation !== "read_track_locks" && request.operation !== "set_track_locks")) throw Error("INVALID_OPERATION");
        if (new Date().getTime() > request.expiresAt) throw Error("EXPIRED_REQUEST");
        if (!localProject(request.projectPath)) throw Error("LOCAL_PROJECT_REQUIRED");
        var project = app.project, sequence = project && project.activeSequence;
        if (!project || normalized(project.path) !== normalized(request.projectPath)) throw Error("PROJECT_CHANGED");
        if (!sequence || guid(sequence.sequenceID) !== guid(request.sequenceId) || sequence.name !== request.sequenceName) throw Error("SEQUENCE_CHANGED");
        var entries = [], groups = [sequence.videoTracks, sequence.audioTracks], types = ["video", "audio"], g, i, track, wanted;
        for (g = 0; g < groups.length; g++) {
            if (groups[g].numTracks > 64 || request.tracks[types[g]].length !== groups[g].numTracks) throw Error("TRACK_COUNT_CHANGED");
            for (i = 0; i < groups[g].numTracks; i++) {
                track = groups[g][i]; wanted = request.tracks[types[g]][i];
                if (track.id === undefined || String(track.id) !== wanted.id || track.name !== wanted.name) throw Error("TRACK_IDENTITY_CHANGED");
                if (typeof track.isLocked !== "function" || (request.operation === "set_track_locks" && typeof track.setLocked !== "function")) throw Error("TRACK_LOCK_API_UNAVAILABLE");
                entries.push({ raw: track, mediaType: types[g], trackIndex: i, trackId: String(track.id), name: track.name });
            }
        }
        return entries;
    }
    function snapshot(entries) {
        var out = [], i, t, row;
        for (i = 0; i < entries.length; i++) {
            t = entries[i]; row = { mediaType: t.mediaType, trackIndex: t.trackIndex, trackId: t.trackId, name: t.name, locked: booleanState(t.raw.isLocked()) };
            if (typeof t.raw.isTargeted === "function") row.targeted = booleanState(t.raw.isTargeted());
            if (typeof t.raw.isMuted === "function") row.muted = booleanState(t.raw.isMuted());
            out.push(row);
        }
        return out;
    }
    function find(entries, edit) {
        for (var i = 0; i < entries.length; i++) if (entries[i].mediaType === edit.mediaType && entries[i].trackIndex === edit.trackIndex) {
            if (entries[i].trackId !== edit.expectedTrackId || entries[i].name !== edit.expectedTrackName) throw Error("TRACK_IDENTITY_CHANGED");
            return i;
        }
        throw Error("TRACK_NOT_FOUND");
    }
    return { execute: function (request) {
        var before = null, after = null, dispatched = false, changed = [], current, desired, i, index, edit;
        try {
            current = context(request); before = snapshot(current);
            if (request.operation === "set_track_locks") {
                desired = [];
                for (i = 0; i < before.length; i++) desired.push(before[i].locked);
                // Validate the entire batch before its first setter.
                for (i = 0; i < request.edits.length; i++) {
                    edit = request.edits[i]; index = find(current, edit);
                    if (typeof edit.locked !== "boolean") throw Error("INVALID_LOCK_STATE");
                    if (edit.expectedLocked !== undefined && edit.expectedLocked !== before[index].locked) throw Error("LOCK_PRECONDITION_FAILED");
                    desired[index] = edit.locked;
                }
                for (i = 0; i < request.edits.length; i++) {
                    edit = request.edits[i]; current = context(request); index = find(current, edit);
                    if (booleanState(current[index].raw.isLocked()) !== before[index].locked) throw Error("LOCK_CHANGED_BEFORE_SET");
                    if (before[index].locked !== edit.locked) {
                        dispatched = true;
                        current[index].raw.setLocked(edit.locked ? 1 : 0);
                        changed.push({ mediaType: edit.mediaType, trackIndex: edit.trackIndex, trackId: edit.expectedTrackId });
                    }
                }
                after = snapshot(context(request));
                for (i = 0; i < after.length; i++) if (after[i].locked !== desired[i] || after[i].muted !== before[i].muted) throw Error("TRACK_LOCK_READBACK_MISMATCH");
            } else after = before;
            return json({ status: "pass", route: "cep_track_lock", version: "0.1.0", requestId: request.id, projectPath: request.projectPath, sequenceId: request.sequenceId, sequenceName: request.sequenceName, before: before, after: after, changed: changed, contentDispatched: dispatched });
        } catch (error) {
            // No replay/rollback: a later context may be the user's different sequence.
            return json({ status: dispatched ? "unverified" : "fail", route: "cep_track_lock", version: "0.1.0", requestId: request && request.id, error: String(error), before: before, after: after, changed: changed, contentDispatched: dispatched });
        }
    } };
}());
