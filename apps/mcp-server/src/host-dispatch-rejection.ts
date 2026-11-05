/** This exact runtime rejection originates only in callNative's socket checks,
 * before WebSocket.send. A lost connection AFTER send uses a different error.
 * Do not broaden this into a substring/timeout/network-failure heuristic. */
export function isHostNotConnectedBeforeDispatch(message:string):boolean{
 return message==='Premiere runtime POST /call failed: Premiere UXP panel is not connected';
}
