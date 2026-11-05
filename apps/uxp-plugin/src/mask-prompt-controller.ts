export type MaskPromptPoint = {
  x: number;
  y: number;
  label: "positive" | "negative";
};

export type MaskPromptBox = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

export type MaskPromptCollectionArgs = {
  objectId: string;
  seedSha256: string;
  dataUrl: string;
  width: number;
  height: number;
  timelineTimeSeconds: number;
  timeoutMs: number;
  initialPrompt?: {
    coordinateSpace: "image_pixels";
    points: MaskPromptPoint[];
    box?: MaskPromptBox;
  };
};

export type MaskPromptCollectionResult =
  | {
    status: "pass";
    seedSha256: string;
    prompt: { coordinateSpace: "image_pixels"; points: MaskPromptPoint[]; box?: MaskPromptBox };
    collectedAt: string;
  }
  | {
    status: "cancelled";
    seedSha256: string;
    reason: "user_cancelled" | "timeout" | "panel_hidden" | "plugin_destroyed";
  };

type PromptAction =
  | { type: "point"; point: MaskPromptPoint }
  | { type: "box"; box: MaskPromptBox };

type PendingPrompt = {
  args: MaskPromptCollectionArgs;
  resolve: (result: MaskPromptCollectionResult) => void;
  timer: ReturnType<typeof setTimeout>;
};

type PromptMode = "positive" | "negative" | "box";

export type PromptBounds = { left: number; top: number; width: number; height: number };

export function mapClientPointToImage(
  bounds: PromptBounds,
  clientX: number,
  clientY: number,
  imageWidth: number,
  imageHeight: number,
): { x: number; y: number } | undefined {
  if (bounds.width <= 0 || bounds.height <= 0 || imageWidth <= 0 || imageHeight <= 0) return undefined;
  if (clientX < bounds.left || clientX > bounds.left + bounds.width || clientY < bounds.top || clientY > bounds.top + bounds.height) return undefined;
  const edgeInset = 1e-6;
  return {
    x: Math.min(imageWidth - edgeInset, Math.max(0, (clientX - bounds.left) / bounds.width * imageWidth)),
    y: Math.min(imageHeight - edgeInset, Math.max(0, (clientY - bounds.top) / bounds.height * imageHeight)),
  };
}

export function containImageBounds(stage: PromptBounds, imageWidth: number, imageHeight: number): PromptBounds {
  if (stage.width <= 0 || stage.height <= 0 || imageWidth <= 0 || imageHeight <= 0) {
    return { left: stage.left, top: stage.top, width: 0, height: 0 };
  }
  const imageRatio = imageWidth / imageHeight;
  const stageRatio = stage.width / stage.height;
  if (stageRatio > imageRatio) {
    const width = stage.height * imageRatio;
    return { left: stage.left + (stage.width - width) / 2, top: stage.top, width, height: stage.height };
  }
  const height = stage.width / imageRatio;
  return { left: stage.left, top: stage.top + (stage.height - height) / 2, width: stage.width, height };
}

let controller: MaskPromptController | undefined;

export function initializeMaskPromptController(log: (message: string) => void): void {
  controller ??= new MaskPromptController(log);
}

export function collectObjectMaskPrompt(args: Record<string, unknown>): Promise<MaskPromptCollectionResult> {
  if (!controller) throw new Error("MASK_PROMPT_PANEL_NOT_INITIALIZED");
  return controller.collect(parseCollectionArgs(args));
}

export function hideMaskPromptPanel(): void {
  controller?.cancel("panel_hidden");
}

export function destroyMaskPromptController(): void {
  controller?.cancel("plugin_destroyed");
  controller = undefined;
}

class MaskPromptController {
  private pending: PendingPrompt | undefined;
  private actions: PromptAction[] = [];
  private mode: PromptMode = "positive";
  private boxAnchor: { x: number; y: number } | undefined;

  constructor(private readonly log: (message: string) => void) {
    this.bindEvents();
  }

  collect(args: MaskPromptCollectionArgs): Promise<MaskPromptCollectionResult> {
    if (this.pending) throw new Error("MASK_PROMPT_ALREADY_ACTIVE");
    this.actions = [];
    for (const point of args.initialPrompt?.points ?? []) this.actions.push({ type: "point", point });
    if (args.initialPrompt?.box) this.actions.push({ type: "box", box: args.initialPrompt.box });
    this.mode = "positive";
    this.boxAnchor = undefined;
    return new Promise<MaskPromptCollectionResult>((resolve) => {
      const timer = setTimeout(() => this.cancel("timeout"), args.timeoutMs);
      this.pending = { args, resolve, timer };
      this.image().src = args.dataUrl;
      element<HTMLElement>("maskPromptMeta").textContent = `${args.objectId} · ${args.width}×${args.height} · ${args.timelineTimeSeconds.toFixed(3)}s`;
      this.overlay().removeAttribute("hidden");
      document.getElementById("composerWrap")?.setAttribute("hidden", "");
      this.render();
      this.log(`Object mask prompt opened for ${args.objectId}.`);
    });
  }

  cancel(reason: "user_cancelled" | "timeout" | "panel_hidden" | "plugin_destroyed"): void {
    const pending = this.pending;
    if (!pending) return;
    this.finish({ status: "cancelled", seedSha256: pending.args.seedSha256, reason });
  }

  private bindEvents(): void {
    element<HTMLButtonElement>("maskPromptPositive").addEventListener("click", () => this.setMode("positive"));
    element<HTMLButtonElement>("maskPromptNegative").addEventListener("click", () => this.setMode("negative"));
    element<HTMLButtonElement>("maskPromptBox").addEventListener("click", () => this.setMode("box"));
    element<HTMLButtonElement>("maskPromptUndo").addEventListener("click", () => {
      if (this.boxAnchor) this.boxAnchor = undefined;
      else this.actions.pop();
      this.render();
    });
    element<HTMLButtonElement>("maskPromptClear").addEventListener("click", () => {
      this.actions = [];
      this.boxAnchor = undefined;
      this.render();
    });
    element<HTMLButtonElement>("maskPromptCancel").addEventListener("click", () => this.cancel("user_cancelled"));
    element<HTMLButtonElement>("maskPromptClose").addEventListener("click", () => this.cancel("user_cancelled"));
    element<HTMLButtonElement>("maskPromptConfirm").addEventListener("click", () => this.confirm());
    element<HTMLElement>("maskPromptStage").addEventListener("click", (event) => this.addAt(event));
    this.overlay().addEventListener("keydown", (event) => {
      if (event.key === "Escape") this.cancel("user_cancelled");
    });
  }

  private setMode(mode: PromptMode): void {
    this.mode = mode;
    this.boxAnchor = undefined;
    this.render();
  }

  private addAt(event: MouseEvent): void {
    const pending = this.pending;
    if (!pending) return;
    const bounds = this.imageContentBounds();
    const mapped = mapClientPointToImage(bounds, event.clientX, event.clientY, pending.args.width, pending.args.height);
    if (!mapped) return;
    const { x, y } = mapped;
    if (this.mode === "box") {
      if (!this.boxAnchor) this.boxAnchor = { x, y };
      else {
        const box = {
          left: Math.min(this.boxAnchor.x, x),
          top: Math.min(this.boxAnchor.y, y),
          right: Math.max(this.boxAnchor.x, x),
          bottom: Math.max(this.boxAnchor.y, y),
        };
        this.boxAnchor = undefined;
        if (box.right - box.left >= 1 && box.bottom - box.top >= 1) {
          this.actions = this.actions.filter((action) => action.type !== "box");
          this.actions.push({ type: "box", box });
        }
      }
    } else {
      if (this.actions.filter((action) => action.type === "point").length >= 64) {
        this.render();
        element<HTMLElement>("maskPromptError").textContent = "포인트는 최대 64개까지 지정할 수 있습니다.";
        return;
      }
      this.actions.push({ type: "point", point: { x, y, label: this.mode } });
    }
    this.render();
  }

  private confirm(): void {
    const pending = this.pending;
    if (!pending) return;
    const points = this.actions.filter((action): action is Extract<PromptAction, { type: "point" }> => action.type === "point").map((action) => action.point);
    const box = [...this.actions].reverse().find((action): action is Extract<PromptAction, { type: "box" }> => action.type === "box")?.box;
    if (!box && !points.some((point) => point.label === "positive")) {
      element<HTMLElement>("maskPromptError").textContent = "최소 한 개의 + 포인트 또는 박스가 필요합니다.";
      return;
    }
    this.finish({
      status: "pass",
      seedSha256: pending.args.seedSha256,
      prompt: { coordinateSpace: "image_pixels", points, ...(box ? { box } : {}) },
      collectedAt: new Date().toISOString(),
    });
  }

  private finish(result: MaskPromptCollectionResult): void {
    const pending = this.pending;
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending = undefined;
    this.overlay().setAttribute("hidden", "");
    this.image().removeAttribute("src");
    this.actions = [];
    this.boxAnchor = undefined;
    if (element<HTMLElement>("settingsDialog").hasAttribute("hidden") && document.getElementById("newChatDialog")?.hasAttribute("hidden") !== false) {
      document.getElementById("composerWrap")?.removeAttribute("hidden");
    }
    this.log(result.status === "pass" ? "Object mask prompt confirmed." : `Object mask prompt cancelled: ${result.reason}.`);
    pending.resolve(result);
  }

  private render(): void {
    for (const [mode, id] of [["positive", "maskPromptPositive"], ["negative", "maskPromptNegative"], ["box", "maskPromptBox"]] as const) {
      const button = element<HTMLButtonElement>(id);
      button.setAttribute("aria-pressed", String(this.mode === mode));
      button.classList.toggle("button--selected", this.mode === mode);
    }
    const layer = element<HTMLElement>("maskPromptMarks");
    while (layer.firstChild) layer.removeChild(layer.firstChild);
    const pending = this.pending;
    const width = pending?.args.width ?? 1;
    const height = pending?.args.height ?? 1;
    const stageBounds = element<HTMLElement>("maskPromptStage").getBoundingClientRect();
    const imageBounds = this.imageContentBounds();
    layer.style.left = `${imageBounds.left - stageBounds.left}px`;
    layer.style.top = `${imageBounds.top - stageBounds.top}px`;
    layer.style.right = "auto";
    layer.style.bottom = "auto";
    layer.style.width = `${imageBounds.width}px`;
    layer.style.height = `${imageBounds.height}px`;
    for (const action of this.actions) {
      if (action.type === "point") layer.append(renderPoint(action.point, width, height));
      else layer.append(renderBox(action.box, width, height));
    }
    if (this.boxAnchor) layer.append(renderPoint({ ...this.boxAnchor, label: "positive" }, width, height, true));
    element<HTMLElement>("maskPromptError").textContent = "";
    const count = this.actions.filter((action) => action.type === "point").length;
    const hasBox = this.actions.some((action) => action.type === "box");
    element<HTMLElement>("maskPromptCount").textContent = `포인트 ${count}개${hasBox ? " · 박스 1개" : ""}`;
  }

  private overlay(): HTMLElement {
    return element<HTMLElement>("maskPromptDialog");
  }

  private image(): HTMLImageElement {
    return element<HTMLImageElement>("maskPromptImage");
  }

  private imageContentBounds(): { left: number; top: number; width: number; height: number } {
    const stage = element<HTMLElement>("maskPromptStage").getBoundingClientRect();
    const pending = this.pending;
    return pending
      ? containImageBounds(stage, pending.args.width, pending.args.height)
      : { left: stage.left, top: stage.top, width: 0, height: 0 };
  }
}

function renderPoint(point: MaskPromptPoint, width: number, height: number, anchor = false): HTMLElement {
  const mark = document.createElement("span");
  mark.className = `mask-prompt-point mask-prompt-point--${anchor ? "anchor" : point.label}`;
  mark.textContent = anchor ? "□" : point.label === "positive" ? "+" : "−";
  mark.style.left = `${point.x / width * 100}%`;
  mark.style.top = `${point.y / height * 100}%`;
  return mark;
}

function renderBox(box: MaskPromptBox, width: number, height: number): HTMLElement {
  const mark = document.createElement("span");
  mark.className = "mask-prompt-box";
  mark.style.left = `${box.left / width * 100}%`;
  mark.style.top = `${box.top / height * 100}%`;
  mark.style.width = `${(box.right - box.left) / width * 100}%`;
  mark.style.height = `${(box.bottom - box.top) / height * 100}%`;
  return mark;
}

function parseCollectionArgs(value: Record<string, unknown>): MaskPromptCollectionArgs {
  const objectId = stringValue(value.objectId, "MASK_PROMPT_OBJECT_ID_REQUIRED");
  const seedSha256 = stringValue(value.seedSha256, "MASK_PROMPT_SEED_SHA_REQUIRED");
  const dataUrl = stringValue(value.dataUrl, "MASK_PROMPT_IMAGE_REQUIRED");
  const width = positiveInteger(value.width, "MASK_PROMPT_WIDTH_INVALID");
  const height = positiveInteger(value.height, "MASK_PROMPT_HEIGHT_INVALID");
  const timelineTimeSeconds = finiteNonNegative(value.timelineTimeSeconds, "MASK_PROMPT_TIME_INVALID");
  const timeoutMs = positiveInteger(value.timeoutMs, "MASK_PROMPT_TIMEOUT_INVALID");
  if (!/^[a-f0-9]{64}$/.test(seedSha256)) throw new Error("MASK_PROMPT_SEED_SHA_INVALID");
  if (!dataUrl.startsWith("data:image/png;base64,") || dataUrl.length > 7 * 1024 * 1024) throw new Error("MASK_PROMPT_IMAGE_DATA_INVALID");
  if (timeoutMs < 30_000 || timeoutMs > 10 * 60_000) throw new Error("MASK_PROMPT_TIMEOUT_OUT_OF_RANGE");
  const initialPrompt = parseInitialPrompt(value.initialPrompt, width, height);
  return { objectId, seedSha256, dataUrl, width, height, timelineTimeSeconds, timeoutMs, ...(initialPrompt ? { initialPrompt } : {}) };
}

function parseInitialPrompt(value: unknown, width: number, height: number): MaskPromptCollectionArgs["initialPrompt"] {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object") throw new Error("MASK_PROMPT_INITIAL_INVALID");
  const candidate = value as { coordinateSpace?: unknown; points?: unknown; box?: unknown };
  if (candidate.coordinateSpace !== "image_pixels" || !Array.isArray(candidate.points) || candidate.points.length > 64) throw new Error("MASK_PROMPT_INITIAL_INVALID");
  const points = candidate.points.map((entry): MaskPromptPoint => {
    if (!entry || typeof entry !== "object") throw new Error("MASK_PROMPT_INITIAL_POINT_INVALID");
    const point = entry as { x?: unknown; y?: unknown; label?: unknown };
    const x = finiteNonNegative(point.x, "MASK_PROMPT_INITIAL_POINT_INVALID");
    const y = finiteNonNegative(point.y, "MASK_PROMPT_INITIAL_POINT_INVALID");
    const label = point.label;
    if (x >= width || y >= height || (label !== "positive" && label !== "negative")) throw new Error("MASK_PROMPT_INITIAL_POINT_INVALID");
    return { x, y, label };
  });
  let box: MaskPromptBox | undefined;
  if (candidate.box !== undefined) {
    if (!candidate.box || typeof candidate.box !== "object") throw new Error("MASK_PROMPT_INITIAL_BOX_INVALID");
    const raw = candidate.box as Record<string, unknown>;
    box = {
      left: finiteNonNegative(raw.left, "MASK_PROMPT_INITIAL_BOX_INVALID"),
      top: finiteNonNegative(raw.top, "MASK_PROMPT_INITIAL_BOX_INVALID"),
      right: finiteNonNegative(raw.right, "MASK_PROMPT_INITIAL_BOX_INVALID"),
      bottom: finiteNonNegative(raw.bottom, "MASK_PROMPT_INITIAL_BOX_INVALID"),
    };
    if (box.right <= box.left || box.bottom <= box.top || box.right > width || box.bottom > height) throw new Error("MASK_PROMPT_INITIAL_BOX_INVALID");
  }
  return { coordinateSpace: "image_pixels", points, ...(box ? { box } : {}) };
}

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing mask prompt element: ${id}`);
  return found as T;
}

function stringValue(value: unknown, code: string): string {
  if (typeof value !== "string" || !value) throw new Error(code);
  return value;
}

function positiveInteger(value: unknown, code: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) throw new Error(code);
  return value;
}

function finiteNonNegative(value: unknown, code: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(code);
  return value;
}
