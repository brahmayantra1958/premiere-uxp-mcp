/* Adobe ExtendScript ES3. Only the two versioned targeting operations are exposed. */
var BrahmaYantraTrackTargeting = (function () {
    function normalized(value) { return String(value).replace(/\//g, "\\").replace(/^\\\\\?\\/, "").toLowerCase(); }
    function guid(value) { return String(value).replace(/[{}]/g, "").toLowerCase(); }
    // ExtendScript may have no JSON global. Serialize results without eval or a parser fallback.
    function json(value) {
        if (value === null) return "null";
        if (typeof value === "string") return '"' + value.replace(/["\\\x00-\x1f\u2028\u2029]/g, function (c) {
            var hex = c.charCodeAt(0).toString(16); return "\\u" + ("0000" + hex).slice(-4);
        }) + '"';
        if (typeof value === "boolean" || typeof value === "number") return String(value);
        var parts = [], key, i;
        if (value instanceof Array) { for (i = 0; i < value.length; i++) parts.push(json(value[i])); return "[" + parts.join(",") + "]"; }
        for (key in value) if (value.hasOwnProperty(key)) parts.push(json(key) + ":" + json(value[key]));
        return "{" + parts.join(",") + "}";
    }
    function context(request) {
        if (!request || request.version !== 1 || (request.operation !== "read_track_targeting" && request.operation !== "set_track_targeting")) throw Error("INVALID_OPERATION");
        if (new Date().getTime() > request.expiresAt) throw Error("EXPIRED_REQUEST");
        if(!/^[a-z]:\\.*\.prproj$/.test(normalized(request.projectPath)))throw Error("LOCAL_PROJECT_REQUIRED");
        var project = app.project, sequence = project && project.activeSequence;
        if (!project || normalized(project.path) !== normalized(request.projectPath)) throw Error("PROJECT_CHANGED");
        if (!sequence || guid(sequence.sequenceID) !== guid(request.sequenceId) || sequence.name !== request.sequenceName) throw Error("SEQUENCE_CHANGED");
        var tracks = [], groups = [sequence.videoTracks, sequence.audioTracks], types = ["video", "audio"], g, i, track;
        for (g = 0; g < groups.length; g++) {
            if (groups[g].numTracks > 64 || request.trackNames[types[g]].length !== groups[g].numTracks) throw Error("TRACK_COUNT_CHANGED");
            for (i = 0; i < groups[g].numTracks; i++) {
                track = groups[g][i];
                if (track.name !== request.trackNames[types[g]][i]) throw Error("TRACK_NAME_CHANGED");
                if (typeof track.isTargeted !== "function" || typeof track.setTargeted !== "function") throw Error("TARGETING_API_UNAVAILABLE");
                tracks.push({ raw: track, mediaType: types[g], trackIndex: i, name: track.name });
            }
        }
        return { sequence: sequence, tracks: tracks };
    }
    function snapshot(entries) {
        var result = [], i, entry;
        for (i = 0; i < entries.length; i++) { entry = entries[i]; result.push({ mediaType: entry.mediaType, trackIndex: entry.trackIndex, name: entry.name, targeted: !!entry.raw.isTargeted() }); }
        return result;
    }
    function write(entries, desired) {
        for (var i = 0; i < entries.length; i++) if (!!entries[i].raw.isTargeted() !== desired[i].targeted) entries[i].raw.setTargeted(desired[i].targeted, true);
    }
    return { execute: function (request) {
        var before = null, mutated = false, desired, current, after, i, j, found;
        try {
            current = context(request); before = snapshot(current.tracks);
            if (request.operation === "read_track_targeting") return json({ status: "pass", route: "cep_track_targeting", version: "0.1.2", after: before });
            desired = snapshot(current.tracks);
            for (i = 0; i < desired.length; i++) desired[i].targeted = false;
            for (i = 0; i < request.targets.length; i++) {
                found = false;
                for (j = 0; j < desired.length; j++) if (desired[j].mediaType === request.targets[i].mediaType && desired[j].trackIndex === request.targets[i].trackIndex) { desired[j].targeted = true; found = true; }
                if (!found) throw Error("TARGET_TRACK_NOT_FOUND");
            }
            mutated = true;
            write(current.tracks, desired);
            after = snapshot(context(request).tracks);
            if (json(after) !== json(desired)) throw Error("TARGETING_READBACK_MISMATCH");
            return json({ status: "pass", route: "cep_track_targeting", version: "0.1.2", before: before, after: after, uiBroadcast: true });
        } catch (error) {
            var restored = !mutated;
            if (mutated && before) try { current = context(request); write(current.tracks, before); restored = json(snapshot(current.tracks)) === json(before); } catch (ignored) { restored = false; }
            return json({ status: restored ? "fail" : "unverified", error: String(error), restored: restored });
        }
    } };
}());
