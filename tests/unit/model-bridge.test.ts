import { describe, expect, it } from "vitest";
import { cliModels, ModelBridgeClient, normalizeModelBridgeUrl } from "../../apps/uxp-plugin/src/model-bridge.js";

describe("model bridge loopback authority", () => {
  it.each([
    ["http://127.0.0.1:4327", "http://127.0.0.1:4327"],
    ["http://localhost:4327/", "http://localhost:4327"],
    ["http://localhost", "http://localhost"],
  ])("accepts local HTTP endpoints: %s", (candidate, expected) => {
    expect(normalizeModelBridgeUrl(candidate)).toBe(expected);
  });

  it.each([
    "https://127.0.0.1:4327/",
    "http://example.com:4327/",
    "http://localhost:4327/api",
    "http://user:secret@localhost:4327/",
    "http://localhost:4327/?token=secret",
  ])("rejects broader model endpoints: %s", (candidate) => {
    expect(() => normalizeModelBridgeUrl(candidate)).toThrow(/로컬 HTTP/);
  });
});

describe("model catalog", () => {
  it("exposes only CLI-capable models with their vendor", () => {
    expect(cliModels({
      vendors: ["openai", "anthropic"],
      models: {
        openai: [
          { id: "codex", transports: ["cli"] },
          { id: "api-only", transports: ["api"] },
        ],
        anthropic: [{ id: "claude", transports: ["cli", "api"] }],
      },
    })).toEqual([
      { vendor: "openai", id: "codex", transports: ["cli"] },
      { vendor: "anthropic", id: "claude", transports: ["cli", "api"] },
    ]);
  });
});

describe("model bridge HTTP contract", () => {
  it("sends CLI model requests with resume and attachment directory context", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    const client = new ModelBridgeClient(async (url, init) => {
      capturedUrl = url;
      capturedInit = init;
      return new Response(JSON.stringify({ ok: true, responseText: "done", sessionId: "session-2" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    await expect(client.ask("http://127.0.0.1:4327", {
      vendor: "openai",
      model: "gpt-5.5",
      thinking: "xhigh",
      prompt: "review",
      resumeSessionId: "session-1",
      cwd: "C:\\work",
      addDirs: ["C:\\assets"],
    })).resolves.toEqual({ responseText: "done", sessionId: "session-2" });

    expect(capturedUrl).toBe("http://127.0.0.1:4327/api/model/request");
    expect(capturedInit?.method).toBe("POST");
    expect(JSON.parse(String(capturedInit?.body))).toMatchObject({
      transport: "cli",
      resumeSessionId: "session-1",
      cwd: "C:\\work",
      addDirs: ["C:\\assets"],
    });
  });

  it("surfaces the bridge error text", async () => {
    const client = new ModelBridgeClient(async () => new Response(JSON.stringify({
      ok: false,
      errorText: "provider unavailable",
    }), { status: 424, headers: { "content-type": "application/json" } }));

    await expect(client.ask("http://localhost:4327", {
      vendor: "openai",
      model: "codex-default",
      thinking: "none",
      prompt: "hello",
    })).rejects.toThrow("provider unavailable");
  });
});
