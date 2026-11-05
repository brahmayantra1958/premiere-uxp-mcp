import { HostCommandError } from "./bridge-client.js";
import type { WorkTrack } from "./work-target.js";

import { deployment } from './installation-config.js';
const connection = deployment.trackTargeting;
let serial = 0;
export const trackTargetingConfigured = Boolean(connection);

/** Dedicated authenticated loopback helper. No arbitrary script or command field. */
export async function requestTrackTargeting(project: any, sequence: any, tracks: WorkTrack[]) {
  const started = performance.now();
  if (!connection) return { status: "unsupported" as const, reason: "Track targeting CEP helper is not configured" };
  if (tracks.some(track => track.mediaType === "caption")) return { status: "unsupported" as const, reason: "Caption tracks have no V/A targeting button" };
  const trackNames: { video: string[]; audio: string[] } = { video: [], audio: [] };
  for (const type of ["video", "audio"] as const) {
    const count = Number(await sequence[type === "video" ? "getVideoTrackCount" : "getAudioTrackCount"]());
    if (!Number.isInteger(count) || count < 0 || count > 64) throw new HostCommandError("TRACK_TARGETING_LIMIT", "Track count exceeds the helper bound");
    for (let i = 0; i < count; i++) trackNames[type].push(String((await sequence[type === "video" ? "getVideoTrack" : "getAudioTrack"](i)).name));
  }
  if (tracks.some(track => track.trackIndex >= trackNames[track.mediaType as "video" | "audio"].length)) return { status: "unsupported" as const, reason: "Requested destination track does not exist yet" };
  const requested = performance.now();
  const configured=connection;
  async function dispatch(targets:WorkTrack[]){
    const request={version:1,id:`uxp-${Date.now()}-${++serial}`,operation:targets.length?'set_track_targeting':'read_track_targeting',expiresAt:Date.now()+15000,projectPath:String(project.path),sequenceId:String(sequence.guid),sequenceName:String(sequence.name),trackNames,targets};
    let timer:ReturnType<typeof setTimeout>|undefined;
    try{return await Promise.race([
      fetch(`http://localhost:${configured.port}/targeting`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${configured.token}` }, body: JSON.stringify(request) }).then(async response => {
        const result=await response.json() as Record<string,any>;
        if(!response.ok){
          // This exact 409 is issued before native dispatch. No unknown setter
          // is repeated: reconcile using a new read, then submit a new intent.
          if(response.status===409&&result.error==='UNVERIFIED_PRIOR_DISPATCH_RELOAD_REQUIRED')return {rejectedBeforeDispatch:true};
          throw Error(`Targeting helper HTTP ${response.status}`);
        }
        return result;
      }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(Error("Targeting dispatch timed out; inspect before retry")), 14000); }),
    ]);}finally{if(timer!==undefined)clearTimeout(timer);}
  }
  function verify(result:Record<string,any>,targets:WorkTrack[]){
    if (result.status !== "pass" || result.route !== "cep_track_targeting" || result.version !== configured.version) throw Error(`Targeting readback failed: ${String(result.error ?? result.status)}`);
    const expected = (["video", "audio"] as const).flatMap(mediaType => trackNames[mediaType].map((name, trackIndex) => ({ mediaType, trackIndex, name,
      ...(targets.length ? { targeted: targets.some(track => track.mediaType === mediaType && track.trackIndex === trackIndex) } : {}) })));
    if (!Array.isArray(result.after) || result.after.length !== expected.length || expected.some((track, i) => {
      const actual = result.after[i];
      return !actual || typeof actual.targeted !== "boolean" || Object.entries(track).some(([key, value]) => actual[key] !== value);
    })) throw Error("Complete native targeting vector differs from requested tracks");
  }
  try {
    let result=await dispatch(tracks),reconciliation:Record<string,any>|undefined;
    if(result.rejectedBeforeDispatch===true&&tracks.length){
      reconciliation=await dispatch([]);verify(reconciliation,[]);
      result=await dispatch(tracks);
    }
    verify(result,tracks);
    return { ...result, timingsMs: { trackIdentity: requested - started, transportAndHost: performance.now() - requested }, status: tracks.length ? "pass" as const : "preserved" as const,
      ...(reconciliation?{reconciliation:{status:'pass',nativeVector:reconciliation.after,previousIntentDispatched:false}}:{}),
      reason: "Premiere ExtendScript isTargeted/setTargeted with UI broadcast; full native targeting vector verified" };
  } catch (error) {
    // Name the loopback helper: on 2026-11-04 the bare "Network request failed"
    // reason did not say which request had failed.
    throw new HostCommandError("TRACK_TARGETING_UNVERIFIED", `Track targeting helper request failed: ${String(error)}; dependent content command was not dispatched`);
  }
}
