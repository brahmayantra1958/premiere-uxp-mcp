import type { BridgeResponse } from "./wire.js";
import type { WorkTarget } from "./work-target.js";

export type TaskEvent =
  | { phase: "started"; id: string; command: string; startedAt: number }
  | { phase: "targeted"; id: string; target: WorkTarget }
  | { phase: "finished"; id: string; response: BridgeResponse };

export type TaskState = "running" | "completed" | "pass" | "partial" | "unverified" | "unsupported" | "failed" | "cancelled";
export type TaskActivity = { id: string; command: string; startedAt: number; state: TaskState; durationMs?: number; target?: WorkTarget };

/** Transport success alone is not proof of a successful Premiere operation. */
export function taskResultState(response: BridgeResponse): TaskState {
  if (!response.ok) return "failed";
  const status = response.result && typeof response.result === "object"
    ? String((response.result as { status?: unknown }).status ?? "").toLowerCase()
    : "";
  if (status === "fail" || status === "failed") return "failed";
  if (["pass", "partial", "unverified", "unsupported", "cancelled"].includes(status)) return status as TaskState;
  return "completed";
}

/** Bounded, newest-start-first history. Completion never reorders older work. */
export class TaskHistory {
  readonly items: TaskActivity[] = [];
  constructor(private readonly limit = 100) {}

  apply(event: TaskEvent): TaskActivity | undefined {
    if (event.phase === "started") {
      if (this.items.some((item) => item.id === event.id)) return undefined;
      const item: TaskActivity = { id: event.id, command: event.command, startedAt: event.startedAt, state: "running" };
      this.items.unshift(item);
      this.items.splice(this.limit);
      return item;
    }
    const item = this.items.find((candidate) => candidate.id === event.id);
    if (!item) return undefined;
    if (event.phase === "targeted") { item.target = event.target; return item; }
    item.state = taskResultState(event.response);
    item.durationMs = event.response.durationMs;
    return item;
  }

  clearCompleted(): void {
    for (let index = this.items.length - 1; index >= 0; index -= 1) {
      if (this.items[index]?.state !== "running") this.items.splice(index, 1);
    }
  }
}

const labels: Record<TaskState, string> = {
  running: "실행 중", completed: "응답 완료", pass: "검증 완료", partial: "일부 완료",
  unverified: "미검증", unsupported: "지원 안 됨", failed: "실패", cancelled: "취소됨",
};

/** Only the affected row changes; large command arguments/results never enter the DOM. */
export class TaskActivityView {
  private readonly rows = new Map<string, { row: HTMLElement; status: HTMLElement; meta: HTMLElement; location: HTMLElement }>();
  constructor(private readonly list: HTMLElement, private readonly empty: HTMLElement, private readonly count: HTMLElement) {}

  update(item: TaskActivity, history: readonly TaskActivity[]): void {
    let elements = this.rows.get(item.id);
    if (!elements) {
      const row = document.createElement("div");
      row.className = "task-row";
      row.setAttribute("role", "listitem");
      row.setAttribute("data-task-id", item.id);
      const heading = document.createElement("div");
      heading.className = "task-heading";
      const command = document.createElement("strong");
      command.className = "task-command";
      command.textContent = item.command;
      const status = document.createElement("span");
      heading.append(command, status);
      const meta = document.createElement("div");
      meta.className = "task-meta";
      const location = document.createElement("div");
      location.className = "task-location";
      row.append(heading, meta, location);
      this.list.insertBefore(row, this.list.firstChild);
      elements = { row, status, meta, location };
      this.rows.set(item.id, elements);
    }
    elements.status.className = `task-status task-status--${item.state}`;
    elements.status.textContent = labels[item.state];
    elements.row.setAttribute("data-state", item.state);
    const duration = item.durationMs === undefined ? "" : ` · ${Math.round(item.durationMs)} ms`;
    elements.meta.textContent = `${new Date(item.startedAt).toLocaleTimeString()}${duration}`;
    elements.location.hidden = !item.target;
    if (item.target) {
      const target = item.target;
      const tracks = target.tracks.map(track => `${track.mediaType === "video" ? "V" : track.mediaType === "audio" ? "A" : "C"}${track.trackIndex + 1}`).join(", ");
      const action = target.phase === "after_read" ? "조회 위치" : target.phase === "after_command" ? "작업 완료 위치" : "작업 시작 위치";
      const clips = target.clipSelection === "preserved" ? `조회 클립 ${target.itemIds.length}개 · 선택 유지` : `클립 ${target.itemIds.length}개 선택`;
      const targeting = target.trackTargeting === "pass" ? "작업 트랙만 대상 지정" : target.trackTargeting === "preserved" ? "트랙 대상 유지" : "트랙 대상 지정 미지원";
      elements.location.textContent = `${action}: ${target.sequenceName.slice(0, 120)} · ${tracks || "시퀀스"} · ${target.playhead.seconds.toFixed(3)}초 · ${clips} · ${targeting}`;
      elements.location.setAttribute("data-sequence-id", target.sequenceId);
    }
    this.reconcile(history);
  }

  reconcile(history: readonly TaskActivity[]): void {
    const retained = new Set(history.map((item) => item.id));
    for (const [id, elements] of this.rows) {
      if (!retained.has(id)) { elements.row.remove(); this.rows.delete(id); }
    }
    this.empty.hidden = history.length > 0;
    this.count.textContent = String(history.length);
  }
}
