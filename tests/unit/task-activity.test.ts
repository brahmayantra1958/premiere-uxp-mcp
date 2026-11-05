import { describe, expect, it } from "vitest";
import { TaskHistory, taskResultState } from "../../apps/uxp-plugin/src/task-activity.js";
import type { BridgeResponse } from "../../apps/uxp-plugin/src/wire.js";

const response = (id: string, result?: unknown): BridgeResponse => ({ version: 1, id, ok: true, result, durationMs: 12 });

describe("agent task history", () => {
  it("keeps start order when overlapping tasks complete in reverse order", () => {
    const history = new TaskHistory();
    history.apply({ phase: "started", id: "first", command: "inspect_project", startedAt: 1 });
    history.apply({ phase: "started", id: "second", command: "premiere_ping", startedAt: 2 });
    history.apply({ phase: "finished", id: "second", response: response("second", { status: "pass" }) });
    history.apply({ phase: "finished", id: "first", response: response("first") });
    expect(history.items.map((item) => [item.id, item.state])).toEqual([["second", "pass"], ["first", "completed"]]);
  });

  it("bounds retention, ignores duplicate starts and never recreates evicted work on completion", () => {
    const history = new TaskHistory(2);
    for (const id of ["a", "b", "b", "c"]) history.apply({ phase: "started", id, command: "inspect_project", startedAt: 1 });
    history.apply({ phase: "finished", id: "a", response: response("a") });
    expect(history.items.map((item) => item.id)).toEqual(["c", "b"]);
  });

  it("clears finished tasks while preserving work that is still running", () => {
    const history = new TaskHistory();
    for (const id of ["a", "b"]) history.apply({ phase: "started", id, command: "inspect_project", startedAt: 1 });
    history.apply({ phase: "finished", id: "b", response: response("b") });
    history.clearCompleted();
    expect(history.items.map((item) => item.id)).toEqual(["a"]);
    history.apply({ phase: "finished", id: "a", response: response("a", { status: "partial" }) });
    expect(history.items[0]?.state).toBe("partial");
  });

  it("preserves host evidence states instead of treating transport success as PASS", () => {
    for (const state of ["pass", "partial", "unverified", "unsupported", "cancelled"] as const) {
      expect(taskResultState(response("a", { status: state.toUpperCase() }))).toBe(state);
    }
    expect(taskResultState(response("a", true))).toBe("completed");
    expect(taskResultState(response("a", { status: "fail" }))).toBe("failed");
    expect(taskResultState({ ...response("a"), ok: false })).toBe("failed");
  });
});
