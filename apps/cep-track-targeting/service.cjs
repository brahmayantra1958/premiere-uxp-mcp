/* global require, module, Buffer, setTimeout, clearTimeout */
/* eslint-disable @typescript-eslint/no-require-imports -- CEP loads this CommonJS module with its bundled Node runtime. */
"use strict";
const http = require("http");
const crypto = require("crypto");

function validate(value) {
  const allowed = ["version", "id", "operation", "expiresAt", "projectPath", "sequenceId", "sequenceName", "trackNames", "targets"];
  if (!value || Object.keys(value).some(key => !allowed.includes(key)) || value.version !== 1) throw Error("INVALID_REQUEST");
  if (typeof value.id !== "string" || !/^[a-zA-Z0-9-]{8,80}$/.test(value.id) || !["read_track_targeting", "set_track_targeting"].includes(value.operation)) throw Error("INVALID_OPERATION");
  if (!Number.isFinite(value.expiresAt) || value.expiresAt < Date.now() || value.expiresAt > Date.now() + 30000) throw Error("EXPIRED_REQUEST");
  for (const field of ["projectPath", "sequenceId", "sequenceName"]) if (typeof value[field] !== "string" || !value[field] || value[field].length > 2048) throw Error("INVALID_IDENTITY");
  if (!value.trackNames || Object.keys(value.trackNames).sort().join(",") !== "audio,video") throw Error("INVALID_TRACKS");
  for (const type of ["video", "audio"]) if (!Array.isArray(value.trackNames[type]) || value.trackNames[type].length > 64 || value.trackNames[type].some(name => typeof name !== "string" || name.length > 512)) throw Error("INVALID_TRACKS");
  if (!Array.isArray(value.targets) || value.targets.length > 128) throw Error("INVALID_TARGETS");
  const keys = new Set();
  for (const target of value.targets) {
    if (!target || Object.keys(target).sort().join(",") !== "mediaType,trackIndex" || !["video", "audio"].includes(target.mediaType) || !Number.isInteger(target.trackIndex) || target.trackIndex < 0 || target.trackIndex >= value.trackNames[target.mediaType].length) throw Error("INVALID_TARGETS");
    const key = target.mediaType + ":" + target.trackIndex;
    if (keys.has(key)) throw Error("DUPLICATE_TARGET"); keys.add(key);
  }
  if (value.operation === "read_track_targeting" && value.targets.length) throw Error("READ_WITH_TARGETS");
  return value;
}

// JSON-only literal in a fixed function call: callers cannot supply executable JSX.
function expression(request) {
  return "BrahmaYantraTrackTargeting.execute(" + JSON.stringify(validate(request)).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029") + ")";
}

function createTargetingServer(config, evaluate, record) {
  let busy = false;
  let quarantined = false;
  let pendingHostCallbacks = 0;
  const completed = new Map();
  const expected = Buffer.from("Bearer " + config.token);
  const server = http.createServer((req, res) => {
    const send = (code, body) => { if (!res.destroyed) { res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(body)); } };
    const supplied = Buffer.from(req.headers.authorization || "");
    if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return send(401, { error: "UNAUTHORIZED" });
    if (!["127.0.0.1:" + config.port, "localhost:" + config.port].includes(req.headers.host)) return send(403, { error: "INVALID_HOST" });
    if (req.method !== "POST" || req.url !== "/targeting") return send(404, { error: "NOT_FOUND" });
    const chunks = []; let bytes = 0;
    req.on("data", chunk => { bytes += chunk.length; if (bytes > 32768) { send(413, { error: "BODY_TOO_LARGE" }); req.destroy(); } else chunks.push(chunk); });
    req.on("end", () => {
      if (res.writableEnded) return;
      let request, body;
      try { request = validate(JSON.parse(Buffer.concat(chunks).toString("utf8"))); body = JSON.stringify(request); }
      catch (error) { return send(400, { error: String(error) }); }
      const previous = completed.get(request.id);
      if (previous) return previous.body === body ? send(200, previous.result) : send(409, { error: "ID_REUSE" });
      if (busy || (quarantined && request.operation !== "read_track_targeting")) return send(409, { error: quarantined ? "UNVERIFIED_PRIOR_DISPATCH_RELOAD_REQUIRED" : "BUSY" });
      busy = true;
      let settled = false;
      const finish = result => {
        if (settled) { record({ id: request.id, late: true, result }); return; }
        settled = true; clearTimeout(timer); busy = false;
        completed.set(request.id, { body, result });
        while (completed.size > 100) completed.delete(completed.keys().next().value);
        record({ id: request.id, operation: request.operation, result }); send(200, result);
      };
      const timer = setTimeout(() => { quarantined = true; finish({ status: "unverified", error: "HOST_TIMEOUT_DO_NOT_REPLAY" }); }, 12000);
      let callbackCompleted = false;
      const completeCallback = () => { if (!callbackCompleted) { callbackCompleted = true; pendingHostCallbacks--; } };
      pendingHostCallbacks++;
      try { evaluate(expression(request), raw => {
        completeCallback();
        try { const result = JSON.parse(String(raw)); if (!["pass", "fail", "unverified"].includes(result.status)) throw Error("INVALID_HOST_RESULT"); if (result.status === "unverified") quarantined = true;
          // A fresh read can reconcile a completed uncertain dispatch. A late
          // callback or read while an older callback is outstanding cannot do
          // so: the old mutation may still execute after that observation.
          const expectedTracks = ["video", "audio"].flatMap(mediaType => request.trackNames[mediaType].map((name, trackIndex) => ({mediaType,trackIndex,name})));
          if (!settled && quarantined && pendingHostCallbacks === 0 && request.operation === "read_track_targeting" && result.status === "pass" && result.route === "cep_track_targeting" && result.version === "0.1.2"
            && Array.isArray(result.after) && result.after.length === expectedTracks.length && expectedTracks.every((t,i) => result.after[i] && typeof result.after[i].targeted === "boolean" && Object.keys(t).every(k => result.after[i][k] === t[k]))) {
            quarantined = false; record({id:request.id,reconciled:true,reason:"fresh_native_vector_after_all_callbacks_completed"});
          }
          finish(result); }
        catch (error) { quarantined = true; finish({ status: "unverified", error: String(error) }); }
      }); } catch (error) { completeCallback(); quarantined = true; finish({ status: "unverified", error: String(error) }); }
    });
    req.on("error", () => {});
  });
  server.headersTimeout = 5000; server.requestTimeout = 5000;
  return server;
}
module.exports = { validate, expression, createTargetingServer };
