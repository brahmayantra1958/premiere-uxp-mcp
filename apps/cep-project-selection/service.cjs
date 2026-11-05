/* global require, module, Buffer, setTimeout, clearTimeout */
/* eslint-disable @typescript-eslint/no-require-imports -- CEP loads this CommonJS module with its bundled Node runtime. */
"use strict";
const http = require("http");
const crypto = require("crypto");

function validate(value) {
  const allowed = ["version", "id", "operation", "expiresAt", "projectPath", "sequenceId", "sequenceName", "target"];
  if (!value || Object.keys(value).some(key => !allowed.includes(key)) || value.version !== 1) throw Error("INVALID_REQUEST");
  if (typeof value.id !== "string" || !/^[a-zA-Z0-9-]{8,80}$/.test(value.id) || !["read_project_selection", "set_project_selection"].includes(value.operation)) throw Error("INVALID_OPERATION");
  if (!Number.isFinite(value.expiresAt) || value.expiresAt < Date.now() || value.expiresAt > Date.now() + 30000) throw Error("EXPIRED_REQUEST");
  for (const field of ["projectPath", "sequenceId", "sequenceName"]) if (typeof value[field] !== "string" || !value[field] || value[field].length > 2048) throw Error("INVALID_IDENTITY");
  if(value.operation==="read_project_selection"){if(value.target!==undefined)throw Error("READ_WITH_TARGET");return value;}
  const t=value.target;
  if(!t||Object.keys(t).some(k=>!["pathSegments","kind","mediaPath","sequenceId"].includes(k)))throw Error("INVALID_TARGET");
  if(!["clip","sequence","folder"].includes(t.kind)||!Array.isArray(t.pathSegments)||!t.pathSegments.length||t.pathSegments.length>32||t.pathSegments.some(n=>typeof n!=="string"||!n||n.length>512))throw Error("INVALID_TARGET");
  if(t.kind==="clip"&&(typeof t.mediaPath!=="string"||!t.mediaPath||t.mediaPath.length>4096))throw Error("INVALID_MEDIA_PATH");
  if(t.kind==="sequence"&&(typeof t.sequenceId!=="string"||!t.sequenceId||t.sequenceId.length>100))throw Error("INVALID_SEQUENCE_ID");
  return value;
}

// JSON-only literal in a fixed function call: callers cannot supply executable JSX.
function expression(request) {
  return "BrahmaYantraProjectSelection.execute(" + JSON.stringify(validate(request)).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029") + ")";
}

function createProjectSelectionServer(config, evaluate, record) {
  let busy = false;
  let quarantined = false;
  const completed = new Map();
  const expected = Buffer.from("Bearer " + config.token);
  const server = http.createServer((req, res) => {
    const send = (code, body) => { if (!res.destroyed) { res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(body)); } };
    const supplied = Buffer.from(req.headers.authorization || "");
    if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return send(401, { error: "UNAUTHORIZED" });
    if (!["127.0.0.1:" + config.port, "localhost:" + config.port].includes(req.headers.host)) return send(403, { error: "INVALID_HOST" });
    if (req.method !== "POST" || req.url !== "/selection") return send(404, { error: "NOT_FOUND" });
    const chunks = []; let bytes = 0;
    req.on("data", chunk => { bytes += chunk.length; if (bytes > 32768) { send(413, { error: "BODY_TOO_LARGE" }); req.destroy(); } else chunks.push(chunk); });
    req.on("end", () => {
      if (res.writableEnded) return;
      let request, body;
      try { request = validate(JSON.parse(Buffer.concat(chunks).toString("utf8"))); body = JSON.stringify(request); }
      catch (error) { return send(400, { error: String(error) }); }
      const previous = completed.get(request.id);
      if (previous) return previous.body === body ? send(200, previous.result) : send(409, { error: "ID_REUSE" });
      if (busy || (quarantined && request.operation !== "read_project_selection")) return send(409, { error: quarantined ? "UNVERIFIED_PRIOR_DISPATCH_RELOAD_REQUIRED" : "BUSY" });
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
      try { evaluate(expression(request), raw => {
        try { const result = JSON.parse(String(raw)); if (!["pass", "fail", "unverified"].includes(result.status)) throw Error("INVALID_HOST_RESULT"); if (result.status === "unverified") quarantined = true; finish(result); }
        catch (error) { quarantined = true; finish({ status: "unverified", error: String(error) }); }
      }); } catch (error) { quarantined = true; finish({ status: "unverified", error: String(error) }); }
    });
    req.on("error", () => {});
  });
  server.headersTimeout = 5000; server.requestTimeout = 5000;
  return server;
}
module.exports = { validate, expression, createProjectSelectionServer };
