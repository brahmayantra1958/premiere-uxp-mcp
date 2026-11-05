import { describe, expect, it } from "vitest";
import { normalizeLocalBridgeUrl } from "../../apps/uxp-plugin/src/bridge-url.js";

describe("Premiere panel bridge URL authority", () => {
  it("accepts only the fixed loopback WebSocket endpoint", () => {
    expect(normalizeLocalBridgeUrl("ws://127.0.0.1:8099")).toBe("ws://127.0.0.1:8099/");
    expect(normalizeLocalBridgeUrl("ws://127.0.0.1:8099/")).toBe("ws://127.0.0.1:8099/");
    expect(normalizeLocalBridgeUrl("ws://localhost:8099/")).toBe("ws://localhost:8099/");
  });

  it.each([
    "ws://127.0.0.1:8100/",
    "ws://127.0.0.1:8099/uxp",
    "ws://127.0.0.1:8099/?token=secret",
    "wss://127.0.0.1:8099/",
    "ws://example.com:8099/",
  ])("rejects every broader endpoint: %s", (candidate) => {
    expect(() => normalizeLocalBridgeUrl(candidate)).toThrow(/fixed loopback endpoint/);
  });
});
