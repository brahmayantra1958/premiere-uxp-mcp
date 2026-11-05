/* global window, require */
(function captionHelperClient() {
  "use strict";

  var nodeRequire = typeof require === "function"
    ? require
    : window.cep_node && typeof window.cep_node.require === "function"
      ? window.cep_node.require
      : null;
  if (!nodeRequire || !window.__adobe_cep__) return;

  var fs = nodeRequire("fs");
  var path = nodeRequire("path");
  var processModule = nodeRequire("process");
  var repositoryRoot = "__PREMIERE_MCP_REPOSITORY_ROOT__";
  var helperVersion = "__PREMIERE_MCP_CEP_VERSION__";
  var runtimeRoot = path.join(repositoryRoot, "artifacts", "runtime");
  var scratchRoot = path.join(repositoryRoot, "artifacts", "scratch");
  var commandPath = path.join(runtimeRoot, "cep-caption-command.json");
  var resultPath = path.join(runtimeRoot, "cep-caption-result.json");
  var readyPath = path.join(runtimeRoot, "cep-caption-helper-ready.json");
  var extensionId = "ai.brahma.yantra.caption-helper";
  var lastProcessedId = "";

  function normalized(value) {
    var result = String(value || "").replace(/\//g, "\\");
    if (result.indexOf("\\\\?\\") === 0) result = result.slice(4);
    return result.toLowerCase();
  }

  function isBelow(candidate, root) {
    var child = normalized(candidate);
    var parent = normalized(root).replace(/\\+$/, "") + "\\";
    return child.indexOf(parent) === 0;
  }

  function writeJson(filePath, value) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    var temporaryPath = filePath + "." + processModule.pid + ".tmp";
    fs.writeFileSync(temporaryPath, JSON.stringify(value, null, 2), "utf8");
    try {
      fs.renameSync(temporaryPath, filePath);
    } catch {
      try { fs.unlinkSync(filePath); } catch { /* destination may not exist */ }
      fs.renameSync(temporaryPath, filePath);
    }
  }

  function readJson(filePath) {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  }

  function validate(command) {
    if (!command || command.version !== 1) throw new Error("UNSUPPORTED_COMMAND_VERSION");
    if (command.operation !== "create_caption_track_from_srt") throw new Error("UNSUPPORTED_OPERATION");
    if (typeof command.id !== "string" || !command.id) throw new Error("INVALID_COMMAND_ID");
    if (typeof command.projectPath !== "string" || !/^[a-z]:\\.*\.prproj$/.test(normalized(command.projectPath))) throw new Error("LOCAL_PROJECT_REQUIRED");
    if (typeof command.srtPath !== "string" || !isBelow(command.srtPath, scratchRoot)) throw new Error("SRT_PATH_OUTSIDE_LOCAL_SCRATCH");
    if (typeof command.sequenceName !== "string" || !command.sequenceName || typeof command.sequenceId !== "string" || !command.sequenceId) throw new Error("INVALID_SEQUENCE");
    if (typeof command.trackName !== "string" || !command.trackName || command.trackName.length > 100) throw new Error("INVALID_TRACK_NAME");
    if (!Number.isInteger(command.expectedCaptionTracksBefore)
      || command.expectedCaptionTracksBefore < 0
      || command.expectedCaptionTracksBefore >= 32) throw new Error("UNEXPECTED_CAPTION_TRACK_PRECONDITION");
    if (typeof command.muted !== "boolean") throw new Error("INVALID_MUTE_STATE");
  }

  function heartbeat() {
    writeJson(readyPath, {
      status: "ready",
      noAutomaticSave: true,
      extensionId: extensionId,
      version: helperVersion,
      host: "PPRO",
      pid: processModule.pid,
      updatedAt: new Date().toISOString()
    });
  }

  function finish(command, outcome) {
    writeJson(resultPath, {
      id: command.id,
      operation: command.operation,
      status: outcome.ok ? "pass" : "fail",
      outcome: outcome,
      completedAt: new Date().toISOString()
    });
  }

  function processCommand() {
    var command;
    try {
      if (!fs.existsSync(commandPath)) return;
      command = readJson(commandPath);
      if (!command || command.id === lastProcessedId) return;
      validate(command);
      lastProcessedId = command.id;
      writeJson(resultPath, {
        id: command.id,
        operation: command.operation,
        status: "started",
        startedAt: new Date().toISOString()
      });
      var encodedPayload = encodeURIComponent(JSON.stringify(command));
      var expression = "BrahmaYantraCaptionHelper.execute(decodeURIComponent(" + JSON.stringify(encodedPayload) + "))";
      window.__adobe_cep__.evalScript(expression, function onResult(rawResult) {
        try {
          var outcome = JSON.parse(String(rawResult || ""));
          finish(command, outcome);
        } catch (error) {
          finish(command, { ok: false, code: "INVALID_EXTENDSCRIPT_RESULT", message: String(error), rawResult: String(rawResult || "") });
        }
      });
    } catch (error) {
      if (command && command.id) {
        lastProcessedId = command.id;
        finish(command, { ok: false, code: "CEP_CLIENT_ERROR", message: String(error && error.message || error) });
      }
    }
  }

  try {
    if (fs.existsSync(resultPath)) {
      var priorResult = readJson(resultPath);
      lastProcessedId = typeof priorResult.id === "string" ? priorResult.id : "";
    }
  } catch {
    lastProcessedId = "";
  }

  heartbeat();
  processCommand();
  window.setInterval(heartbeat, 2000);
  window.setInterval(processCommand, 250);
}());
