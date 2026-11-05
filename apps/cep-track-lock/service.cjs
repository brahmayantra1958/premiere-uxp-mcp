/* global require, module, Buffer, setTimeout, clearTimeout */
/* eslint-disable @typescript-eslint/no-require-imports -- CEP's bundled Node loads CommonJS. */
"use strict";
const http = require("http"), crypto = require("crypto");
const operations = ["read_track_locks", "set_track_locks"];
function validate(value) {
  const allowed = ["version", "id", "operation", "expiresAt", "projectPath", "sequenceId", "sequenceName", "tracks", "edits"];
  if (!value || Object.keys(value).some(k => !allowed.includes(k)) || value.version !== 1) throw Error("INVALID_REQUEST");
  if (typeof value.id !== "string" || !/^[a-zA-Z0-9-]{8,80}$/.test(value.id) || !operations.includes(value.operation)) throw Error("INVALID_OPERATION");
  if (!Number.isFinite(value.expiresAt) || value.expiresAt < Date.now() || value.expiresAt > Date.now() + 30000) throw Error("EXPIRED_REQUEST");
  for (const field of ["projectPath", "sequenceId", "sequenceName"]) if (typeof value[field] !== "string" || !value[field] || value[field].length > 2048) throw Error("INVALID_IDENTITY");
  if (!value.tracks || Object.keys(value.tracks).sort().join(",") !== "audio,video") throw Error("INVALID_TRACKS");
  for (const type of ["video", "audio"]) {
    const tracks = value.tracks[type];
    if (!Array.isArray(tracks) || tracks.length > 64 || tracks.some(t => !t || Object.keys(t).sort().join(",") !== "id,name" || typeof t.id !== "string" || !/^\d+$/.test(t.id) || typeof t.name !== "string" || t.name.length > 512) || new Set(tracks.map(t => t.id)).size !== tracks.length) throw Error("INVALID_TRACKS");
  }
  if (!Array.isArray(value.edits) || value.edits.length > 128 || (value.operation === "read_track_locks" ? value.edits.length !== 0 : value.edits.length === 0)) throw Error("INVALID_EDITS");
  const keys = new Set();
  for (const edit of value.edits) {
    const fields = ["mediaType", "trackIndex", "expectedTrackId", "expectedTrackName", "locked", "expectedLocked"];
    if (!edit || Object.keys(edit).some(k => !fields.includes(k)) || !["video", "audio"].includes(edit.mediaType) || !Number.isInteger(edit.trackIndex) || edit.trackIndex < 0 || typeof edit.locked !== "boolean" || (edit.expectedLocked !== undefined && typeof edit.expectedLocked !== "boolean")) throw Error("INVALID_EDIT");
    const track = value.tracks[edit.mediaType][edit.trackIndex];
    if (!track || edit.expectedTrackId !== track.id || edit.expectedTrackName !== track.name) throw Error("TRACK_IDENTITY_CHANGED");
    const key = edit.mediaType + ":" + edit.trackIndex;
    if (keys.has(key)) throw Error("DUPLICATE_TRACK"); keys.add(key);
  }
  return value;
}
function expression(request) {
  return "BrahmaYantraTrackLocks.execute(" + JSON.stringify(validate(request)).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029") + ")";
}
function validRead(result, request) {
  const tracks = ["video", "audio"].flatMap(mediaType => request.tracks[mediaType].map((t, trackIndex) => ({mediaType, trackIndex, trackId:t.id, name:t.name})));
  return result.status === "pass" && result.route === "cep_track_lock" && result.version === "0.1.0" && result.requestId === request.id && result.projectPath === request.projectPath && result.sequenceId === request.sequenceId && result.sequenceName === request.sequenceName && Array.isArray(result.after) && result.after.length === tracks.length && tracks.every((t,i) => result.after[i] && typeof result.after[i].locked === "boolean" && Object.keys(t).every(k => result.after[i][k] === t[k]));
}
function createLockServer(config, evaluate, record) {
  let busy = false, quarantined = false, pendingCallbacks = 0;
  const completed = new Map(), expected = Buffer.from("Bearer " + config.token);
  const server = http.createServer((req,res) => {
    const send = (code,body) => { if (!res.destroyed && !res.writableEnded) { res.writeHead(code,{"content-type":"application/json","cache-control":"no-store"});res.end(JSON.stringify(body)); } };
    const supplied = Buffer.from(req.headers.authorization || "");
    if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return send(401,{error:"UNAUTHORIZED",contentDispatched:false});
    if (!["127.0.0.1:"+config.port,"localhost:"+config.port].includes(req.headers.host)) return send(403,{error:"INVALID_HOST",contentDispatched:false});
    if (req.method !== "POST" || req.url !== "/locks") return send(404,{error:"NOT_FOUND",contentDispatched:false});
    const chunks=[];let bytes=0;
    req.on("data",chunk=>{bytes+=chunk.length;if(bytes>131072){send(413,{error:"BODY_TOO_LARGE",contentDispatched:false});req.destroy();}else chunks.push(chunk);});
    req.on("end",()=>{
      if(res.writableEnded || res.destroyed)return;
      let request, body;
      try{request=validate(JSON.parse(Buffer.concat(chunks).toString("utf8")));body=JSON.stringify(request);}catch(error){return send(400,{error:String(error),contentDispatched:false});}
      const previous=completed.get(request.id);
      if(previous)return previous.body===body?send(200,previous.result):send(409,{error:"ID_REUSE",contentDispatched:false});
      if(busy || (quarantined && request.operation !== "read_track_locks"))return send(409,{error:quarantined?"UNVERIFIED_PRIOR_DISPATCH_READ_REQUIRED":"BUSY",contentDispatched:false});
      busy=true;let settled=false;
      const finish=result=>{if(settled){record({id:request.id,late:true,result});return;}settled=true;clearTimeout(timer);busy=false;completed.set(request.id,{body,result});while(completed.size>100)completed.delete(completed.keys().next().value);record({id:request.id,operation:request.operation,result});send(200,result);};
      const timer=setTimeout(()=>{quarantined=true;finish({status:"unverified",error:"HOST_TIMEOUT_DO_NOT_REPLAY"});},12000);
      let callbackCompleted=false;
      const done=()=>{if(!callbackCompleted){callbackCompleted=true;pendingCallbacks--;}};
      pendingCallbacks++;
      try{evaluate(expression(request),raw=>{
        done();
        try{
          const result=JSON.parse(String(raw));
          if(!["pass","fail","unverified"].includes(result.status) || (result.status === "pass" && !validRead(result,request)))throw Error("INVALID_HOST_RESULT");
          if(result.status === "unverified")quarantined=true;
          if(!settled && quarantined && pendingCallbacks===0 && request.operation === "read_track_locks" && validRead(result,request)){quarantined=false;record({id:request.id,reconciled:true});}
          finish(result);
        }catch(error){quarantined=true;finish({status:"unverified",error:String(error)});}
      });}catch(error){done();quarantined=true;finish({status:"unverified",error:String(error)});}
    });
    req.on("error",()=>{});
  });
  server.headersTimeout=5000;server.requestTimeout=5000;
  return server;
}
module.exports={validate,expression,validRead,createLockServer};
