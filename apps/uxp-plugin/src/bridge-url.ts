const LOCAL_BRIDGE_PROTOCOL = "ws:";
const LOCAL_BRIDGE_HOSTS = new Set(["127.0.0.1", "localhost"]);
const LOCAL_BRIDGE_PORT = "8099";

/**
 * Premiere UXP may reject numeric loopback WebSocket domains even when they
 * are allow-listed, so localhost is accepted as the equivalent local-only
 * authority. No path, query, credentials, alternate port, or remote host is
 * permitted.
 */
export function normalizeLocalBridgeUrl(input: string): string {
  const target = new URL(input);
  const isAuthorized = target.protocol === LOCAL_BRIDGE_PROTOCOL
    && LOCAL_BRIDGE_HOSTS.has(target.hostname)
    && target.port === LOCAL_BRIDGE_PORT
    && target.username === ""
    && target.password === ""
    && target.pathname === "/"
    && target.search === ""
    && target.hash === "";
  if (!isAuthorized) throw new Error("Local bridge must be the fixed loopback endpoint on port 8099");
  return `ws://${target.hostname}:${LOCAL_BRIDGE_PORT}/`;
}
