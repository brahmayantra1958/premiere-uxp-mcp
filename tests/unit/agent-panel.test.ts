import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const host = vi.hoisted(() => ({
  identity: vi.fn(async () => ({ error: "No project open" })),
  fullSnapshot: vi.fn(),
  dispatch: vi.fn(async () => ({ premiereVersion: "26.5.0", uxpVersion: "9.3" })),
}));

class ElementStub {
  hidden = false;
  textContent = "";
  value = "";
  disabled = false;
  className = "";
  children: ElementStub[] = [];
  parent: ElementStub | undefined;
  attributes = new Map<string, string>();
  events = new Map<string, (event: any) => void>();
  classList = { add: vi.fn(), remove: vi.fn() };
  addEventListener(name: string, callback: (event: any) => void): void { this.events.set(name, callback); }
  click(): void { this.events.get("click")?.({ target: this, currentTarget: this }); }
  focus(): void {}
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); if (name === "hidden") this.hidden = true; }
  removeAttribute(name: string): void { this.attributes.delete(name); if (name === "hidden") this.hidden = false; }
  hasAttribute(name: string): boolean { return name === "hidden" ? this.hidden : this.attributes.has(name); }
  append(...items: ElementStub[]): void { for (const item of items) { item.parent = this; this.children.push(item); } }
  get firstChild(): ElementStub | null { return this.children[0] ?? null; }
  insertBefore(item: ElementStub): void { item.parent = this; this.children.unshift(item); }
  remove(): void { if (this.parent) this.parent.children = this.parent.children.filter((item) => item !== this); }
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); vi.resetModules(); });

describe("active agent panel", () => {
  it("opens settings repeatedly without host scans, model requests, new timers, or rebuilding task rows", async () => {
    vi.useFakeTimers();
    const elements = new Map<string, ElementStub>();
    const element = (id: string): ElementStub => {
      if (!elements.has(id)) elements.set(id, new ElementStub());
      return elements.get(id)!;
    };
    element("settingsDialog").hidden = true;
    vi.stubGlobal("document", { getElementById: element, createElement: () => new ElementStub(), addEventListener: vi.fn(), body: new ElementStub() });
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() });
    const uxp = { storage: { secureStorage: {} }, entrypoints: { setup: vi.fn() } };
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    // Execute the real entry and its CJS graph with the host boundary substituted.
    // Node's lexical require cannot be stubbed with a global browser-style require.
    const modules = new Map<string, any>();
    const load = (path: string): any => {
      if (modules.has(path)) return modules.get(path);
      const exports = {};
      modules.set(path, exports);
      const code = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
      runInNewContext(code, {
        exports, document, localStorage, fetch, setTimeout, clearTimeout, URL, performance,
        require: (name: string) => {
          if (name === "uxp") return uxp;
          if (name === "@premiere-uxp/contracts/read-purpose") return load(resolve("packages/contracts/src/read-purpose.ts"));
          if (name.endsWith("premiere-host.js")) return { PremiereHost: class { connectionSnapshot = host.identity; panelSnapshot = host.fullSnapshot; dispatch = host.dispatch; } };
          return load(resolve(dirname(path), name.replace(/\.js$/, ".ts")));
        },
      }, { filename: path });
      return exports;
    };
    load(resolve("apps/uxp-plugin/index.ts"));
    await vi.runOnlyPendingTimersAsync();
    const reads = host.identity.mock.calls.length;
    const dispatches = host.dispatch.mock.calls.length;
    const timers = vi.getTimerCount();
    const { TaskActivityView, TaskHistory } = await import("../../apps/uxp-plugin/src/task-activity.js");
    const history = new TaskHistory();
    const view = new TaskActivityView(element("taskList") as unknown as HTMLElement, element("taskEmpty") as unknown as HTMLElement, element("taskCount") as unknown as HTMLElement);
    const item = history.apply({ phase: "started", id: "long", command: "inspect_project", startedAt: 1 })!;
    view.update(item, history.items);
    const row = element("taskList").firstChild;
    for (let i = 0; i < 50; i += 1) {
      element("settingsButton").click();
      expect(element("panel").hidden).toBe(true);
      expect(element("settingsDialog").hidden).toBe(false);
      element("closeSettingsButton").click();
    }
    expect(element("panel").hidden).toBe(false);
    expect(host.identity).toHaveBeenCalledTimes(reads);
    expect(host.dispatch).toHaveBeenCalledTimes(dispatches);
    expect(host.fullSnapshot).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect([...modules.keys()].some((path) => /chat-controller|model-bridge/.test(path))).toBe(false);
    expect(vi.getTimerCount()).toBe(timers);
    expect(element("taskList").firstChild).toBe(row);
    history.apply({ phase: "finished", id: "long", response: { version: 1, id: "long", ok: true, result: { status: "pass" }, durationMs: 5 } });
    view.update(item, history.items);
    expect(element("taskList").firstChild).toBe(row);
    expect(row?.attributes.get("data-state")).toBe("pass");
  });
});
