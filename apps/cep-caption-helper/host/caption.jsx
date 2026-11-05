var BrahmaYantraCaptionHelper = BrahmaYantraCaptionHelper || {};

BrahmaYantraCaptionHelper.execute = function executeCaptionCommand(payloadJson) {
    function parseJson(value) {
        if (typeof JSON !== "undefined" && JSON && typeof JSON.parse === "function") {
            return JSON.parse(value);
        }

        // ExtendScript hosts do not consistently expose the browser JSON global.
        // The CEP client validates this locally generated command before it reaches
        // the host, so an object-literal fallback keeps the legacy bridge usable.
        return eval("(" + value + ")");
    }

    function quoteJson(value) {
        return "\"" + String(value)
            .replace(/\\/g, "\\\\")
            .replace(/\"/g, "\\\"")
            .replace(/\r/g, "\\r")
            .replace(/\n/g, "\\n")
            .replace(/\t/g, "\\t") + "\"";
    }

    function stringifyFlatObject(value) {
        if (typeof JSON !== "undefined" && JSON && typeof JSON.stringify === "function") {
            return JSON.stringify(value);
        }

        var members = [];
        for (var key in value) {
            if (!value.hasOwnProperty(key) || typeof value[key] === "undefined") {
                continue;
            }
            var memberValue = value[key];
            if (memberValue === null) {
                memberValue = "null";
            } else if (typeof memberValue === "boolean" || typeof memberValue === "number") {
                memberValue = String(memberValue);
            } else {
                memberValue = quoteJson(memberValue);
            }
            members.push(quoteJson(key) + ":" + memberValue);
        }
        return "{" + members.join(",") + "}";
    }

    function normalized(value) {
        var result = String(value || "").replace(/\//g, "\\");
        if (result.indexOf("\\\\?\\") === 0) {
            result = result.substring(4);
        }
        return result.toLowerCase();
    }

    function isBelow(candidate, root) {
        var parent = normalized(root);
        if (parent.charAt(parent.length - 1) !== "\\") {
            parent += "\\";
        }
        return normalized(candidate).indexOf(parent) === 0;
    }

    function findProjectItem(item, targetPath) {
        if (!item) {
            return null;
        }

        try {
            if (typeof item.getMediaPath === "function" && normalized(item.getMediaPath()) === normalized(targetPath)) {
                return item;
            }
        } catch (ignoredMediaPath) {
        }

        try {
            if (item.children && typeof item.children.numItems === "number") {
                for (var index = 0; index < item.children.numItems; index += 1) {
                    var found = findProjectItem(item.children[index], targetPath);
                    if (found) {
                        return found;
                    }
                }
            }
        } catch (ignoredChildren) {
        }

        return null;
    }

    try {
        var payload = parseJson(payloadJson);
        var scratchRoot = "__PREMIERE_MCP_SCRATCH_ROOT__";
        if (!payload || payload.version !== 1 || payload.operation !== "create_caption_track_from_srt") {
            throw new Error("INVALID_COMMAND");
        }
        if (payload.saveProject !== false) throw new Error("EXPLICIT_NO_SAVE_REQUIRED");
        if (typeof payload.expectedCaptionTracksBefore !== "number"
            || payload.expectedCaptionTracksBefore !== Math.floor(payload.expectedCaptionTracksBefore)
            || payload.expectedCaptionTracksBefore < 0
            || payload.expectedCaptionTracksBefore >= 32) {
            throw new Error("INVALID_CAPTION_TRACK_PRECONDITION");
        }
        if (!/^[a-z]:\\.*\.prproj$/.test(normalized(payload.projectPath)) || !isBelow(payload.srtPath, scratchRoot)) {
            throw new Error("PATH_OUTSIDE_LOCAL_SCRATCH");
        }
        if (!app.project || normalized(app.project.path) !== normalized(payload.projectPath)) {
            throw new Error("ACTIVE_PROJECT_MISMATCH");
        }

        var sequence = app.project.activeSequence;
        if (!sequence || sequence.name !== payload.sequenceName || String(sequence.sequenceID).replace(/[{}]/g, "").toLowerCase() !== String(payload.sequenceId).replace(/[{}]/g, "").toLowerCase()) {
            throw new Error("ACTIVE_SEQUENCE_MISMATCH");
        }

        var srtFile = new File(payload.srtPath);
        if (!srtFile.exists) {
            throw new Error("SRT_FILE_NOT_FOUND");
        }

        var captionProjectItem = findProjectItem(app.project.rootItem, payload.srtPath);
        var imported = false;
        if (!captionProjectItem) {
            imported = app.project.importFiles([payload.srtPath], true, app.project.rootItem, false);
            captionProjectItem = findProjectItem(app.project.rootItem, payload.srtPath);
        }
        if (!captionProjectItem) {
            throw new Error("SRT_PROJECT_ITEM_NOT_FOUND");
        }

        var created = sequence.createCaptionTrack(captionProjectItem, 0, Sequence.CAPTION_FORMAT_SUBTITLE);
        if (!created) {
            throw new Error("CREATE_CAPTION_TRACK_RETURNED_FALSE");
        }

        var saved = false;
        return stringifyFlatObject({
            ok: true,
            code: "CAPTION_TRACK_CREATED",
            projectPath: app.project.path,
            sequenceName: sequence.name,
            srtPath: payload.srtPath,
            projectItemName: captionProjectItem.name,
            imported: imported,
            saved: saved
        });
    } catch (error) {
        return stringifyFlatObject({
            ok: false,
            code: "EXTENDSCRIPT_ERROR",
            message: error && error.toString ? error.toString() : String(error)
        });
    }
};
