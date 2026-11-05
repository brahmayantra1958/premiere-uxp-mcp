import {
  attachmentDirectories,
  buildModelPrompt,
  classifyAttachment,
  renderMarkdown,
  type AttachmentKind,
  type ChatAttachment,
  type PremiereChatContext,
} from "./chat-content.js";
import {
  cliModels,
  ModelBridgeClient,
  normalizeModelBridgeUrl,
  type ModelCatalog,
  type ModelCatalogEntry,
  type ModelRequest,
} from "./model-bridge.js";
import {
  HEALTH_POLL_BASE_DELAY_MS,
  healthPollFailed,
  healthPollSucceeded,
  initialHealthPollState,
  type HealthPollState,
} from "./health-poll-policy.js";
import { savePanelSettings, type PanelSettings } from "./panel-settings.js";

const CHAT_STORAGE_KEY = "premiere-uxp-mcp-chat-v1";
const MAX_ATTACHMENTS = 8;
const MAX_TEXT_CHARACTERS_PER_FILE = 60_000;
const MAX_TEXT_CHARACTERS_TOTAL = 180_000;
const MAX_PERSISTED_MESSAGES = 60;
const MAX_PERSISTED_MESSAGE_CHARACTERS = 50_000;

type FileEntryLike = {
  name?: string;
  nativePath?: string;
  read(): Promise<unknown>;
};

type LocalFileSystemLike = {
  getFileForOpening(options: { allowMultiple: boolean; types?: string[] }): Promise<FileEntryLike | FileEntryLike[] | null>;
  getNativePath?(entry: FileEntryLike): string;
};

type MessageAttachment = Pick<ChatAttachment, "name" | "kind">;

type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  attachments?: MessageAttachment[];
  meta?: string;
  pending?: boolean;
  error?: boolean;
};

type StoredChat = {
  messages?: ChatMessage[];
  sessionId?: string | null;
  vendor?: string;
  model?: string;
};

export type ChatControllerOptions = {
  settings: PanelSettings;
  storage: Storage;
  localFileSystem: LocalFileSystemLike;
  fileTypes: { all?: string[] };
  getPremiereContext: () => Promise<PremiereChatContext>;
  log: (message: string) => void;
};

export class ChatController {
  private readonly settings: PanelSettings;
  private readonly storage: Storage;
  private readonly localFileSystem: LocalFileSystemLike;
  private readonly fileTypes: { all?: string[] };
  private readonly getPremiereContext: () => Promise<PremiereChatContext>;
  private readonly log: (message: string) => void;
  private readonly client = new ModelBridgeClient();
  private messages: ChatMessage[] = [];
  private attachments: ChatAttachment[] = [];
  private sessionId: string | null = null;
  private catalog: ModelCatalog | undefined;
  private busy = false;
  private initialized = false;
  private sequence = 0;
  private statusTimer: ReturnType<typeof setTimeout> | undefined;
  private healthPollingActive = false;
  private healthCheckInFlight: Promise<void> | undefined;
  private healthPollState: HealthPollState = initialHealthPollState();

  constructor(options: ChatControllerOptions) {
    this.settings = options.settings;
    this.storage = options.storage;
    this.localFileSystem = options.localFileSystem;
    this.fileTypes = options.fileTypes;
    this.getPremiereContext = options.getPremiereContext;
    this.log = options.log;
  }

  initialize(): void {
    if (this.initialized) return;
    this.initialized = true;
    this.restoreChat();
    this.hydrateSettings();
    this.bindEvents();
    this.renderMessages();
    this.renderAttachments();
    this.syncComposer();
    void this.reloadModelOptions();
    this.healthPollingActive = true;
    this.scheduleHealthPoll(HEALTH_POLL_BASE_DELAY_MS);
    this.input().focus();
  }

  destroy(): void {
    this.healthPollingActive = false;
    if (this.statusTimer !== undefined) clearTimeout(this.statusTimer);
    this.statusTimer = undefined;
  }

  async refreshHealth(): Promise<void> {
    if (this.healthCheckInFlight) return this.healthCheckInFlight;
    const check = this.performHealthCheck();
    this.healthCheckInFlight = check;
    try {
      await check;
    } finally {
      if (this.healthCheckInFlight === check) this.healthCheckInFlight = undefined;
    }
  }

  private scheduleHealthPoll(delayMs: number): void {
    if (!this.healthPollingActive) return;
    if (this.statusTimer !== undefined) clearTimeout(this.statusTimer);
    this.statusTimer = setTimeout(() => {
      this.statusTimer = undefined;
      void this.runScheduledHealthPoll();
    }, delayMs);
  }

  private async runScheduledHealthPoll(): Promise<void> {
    await this.refreshHealth();
    this.scheduleHealthPoll(this.healthPollState.delayMs);
  }

  private async performHealthCheck(): Promise<void> {
    this.setModelStatus("pending", "확인 중");
    try {
      await this.client.health(this.settings.modelBridgeUrl);
      this.setModelStatus("online", "연결됨");
      const transition = healthPollSucceeded(this.healthPollState);
      this.healthPollState = transition.state;
      if (transition.logMessage) this.log(transition.logMessage);
    } catch (error) {
      this.setModelStatus("offline", "오프라인");
      const transition = healthPollFailed(this.healthPollState, messageOf(error));
      this.healthPollState = transition.state;
      if (transition.logMessage) this.log(transition.logMessage);
    }
  }

  private bindEvents(): void {
    element<HTMLButtonElement>("sendButton").addEventListener("click", () => void this.send());
    element<HTMLButtonElement>("attachButton").addEventListener("click", () => void this.chooseAttachments());
    element<HTMLButtonElement>("newChatButton").addEventListener("click", () => this.requestNewChat());
    element<HTMLButtonElement>("cancelNewChatButton").addEventListener("click", () => this.closeNewChatDialog());
    element<HTMLButtonElement>("confirmNewChatButton").addEventListener("click", () => {
      this.clearChat();
      this.closeNewChatDialog();
    });
    element<HTMLElement>("newChatDialog").addEventListener("click", (event) => {
      if (event.target === event.currentTarget) this.closeNewChatDialog();
    });
    element<HTMLButtonElement>("testModelBridgeButton").addEventListener("click", () => void this.reloadModelOptions());

    this.input().addEventListener("input", () => {
      this.resizeInput();
      this.syncComposer();
    });
    this.input().addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.shiftKey) return;
      event.preventDefault();
      void this.send();
    });
    element<HTMLSelectElement>("modelSelect").addEventListener("change", () => this.changeModel());
    element<HTMLSelectElement>("thinkingSelect").addEventListener("change", () => this.changeThinking());
    element<HTMLInputElement>("modelBridgeUrl").addEventListener("change", () => void this.changeBridgeUrl());
    element<HTMLInputElement>("workingDirectory").addEventListener("change", () => {
      this.settings.workingDirectory = controlValue(element<HTMLInputElement>("workingDirectory")).trim();
      this.persistSettings();
    });
    element<HTMLInputElement>("includePremiereContext").addEventListener("change", () => {
      this.settings.includePremiereContext = element<HTMLInputElement>("includePremiereContext").checked;
      this.persistSettings();
    });
  }

  private hydrateSettings(): void {
    element<HTMLInputElement>("modelBridgeUrl").value = this.settings.modelBridgeUrl;
    element<HTMLInputElement>("workingDirectory").value = this.settings.workingDirectory;
    element<HTMLInputElement>("includePremiereContext").checked = this.settings.includePremiereContext;
  }

  private async reloadModelOptions(): Promise<void> {
    const modelSelect = element<HTMLSelectElement>("modelSelect");
    modelSelect.disabled = true;
    this.setModelStatus("pending", "모델 확인 중");
    try {
      this.catalog = await this.client.options(this.settings.modelBridgeUrl);
      const models = cliModels(this.catalog);
      if (!models.length) throw new Error("사용 가능한 CLI 모델이 없습니다");
      this.ensureSelectedModel(models);
      this.renderModelOptions(models);
      this.renderThinkingOptions();
      this.persistSettings();
      this.setModelStatus("online", `${models.length}개 모델`);
      this.log(`Model bridge ready with ${models.length} CLI models.`);
    } catch (error) {
      this.catalog = undefined;
      clearElement(modelSelect);
      modelSelect.append(option("", "모델 브리지 오프라인"));
      this.setModelStatus("offline", "연결 실패");
      this.setChatError(messageOf(error));
      this.log(`Model catalog failed: ${messageOf(error)}`);
    } finally {
      modelSelect.disabled = false;
      this.syncComposer();
    }
  }

  private ensureSelectedModel(models: Array<ModelCatalogEntry & { vendor: string }>): void {
    if (models.some((entry) => entry.vendor === this.settings.vendor && entry.id === this.settings.model)) return;
    const preferred = models.find((entry) => entry.vendor === "openai") ?? models[0];
    if (!preferred) return;
    this.settings.vendor = preferred.vendor;
    this.settings.model = preferred.id;
    this.sessionId = null;
  }

  private renderModelOptions(models: Array<ModelCatalogEntry & { vendor: string }>): void {
    const select = element<HTMLSelectElement>("modelSelect");
    clearElement(select);
    const groups = new Map<string, HTMLOptGroupElement>();
    for (const model of models) {
      let group = groups.get(model.vendor);
      if (!group) {
        group = document.createElement("optgroup");
        group.label = model.vendor === "openai" ? "OpenAI / Codex" : model.vendor === "anthropic" ? "Anthropic / Claude" : model.vendor;
        groups.set(model.vendor, group);
        select.append(group);
      }
      const entry = option(`${model.vendor}::${model.id}`, model.label || model.id);
      entry.selected = model.vendor === this.settings.vendor && model.id === this.settings.model;
      group.append(entry);
    }
  }

  private renderThinkingOptions(): void {
    const select = element<HTMLSelectElement>("thinkingSelect");
    const entry = this.currentModel();
    const levels = entry?.thinking?.length ? entry.thinking : this.catalog?.thinkingLevels ?? ["none"];
    if (!levels.includes(this.settings.thinking)) this.settings.thinking = levels.at(-1) ?? "none";
    clearElement(select);
    select.append(...levels.map((level) => option(level, level)));
    select.value = this.settings.thinking;
  }

  private currentModel(): (ModelCatalogEntry & { vendor: string }) | undefined {
    if (!this.catalog) return undefined;
    return cliModels(this.catalog).find((entry) => entry.vendor === this.settings.vendor && entry.id === this.settings.model);
  }

  private changeModel(): void {
    const [vendor, ...modelParts] = controlValue(element<HTMLSelectElement>("modelSelect")).split("::");
    const model = modelParts.join("::");
    if (!vendor || !model) return;
    this.settings.vendor = vendor;
    this.settings.model = model;
    this.renderThinkingOptions();
    this.resetSession(`모델을 ${model}(으)로 변경해 새 세션을 시작했습니다.`);
    this.persistSettings();
  }

  private changeThinking(): void {
    const thinking = controlValue(element<HTMLSelectElement>("thinkingSelect"));
    if (!thinking || thinking === this.settings.thinking) return;
    this.settings.thinking = thinking;
    this.resetSession(`Thinking을 ${thinking}(으)로 변경해 새 세션을 시작했습니다.`);
    this.persistSettings();
  }

  private async changeBridgeUrl(): Promise<void> {
    const input = element<HTMLInputElement>("modelBridgeUrl");
    try {
      const next = normalizeModelBridgeUrl(controlValue(input));
      if (next !== this.settings.modelBridgeUrl) {
        this.settings.modelBridgeUrl = next;
        this.healthPollState = initialHealthPollState();
        this.resetSession("모델 브리지가 변경되어 새 세션을 시작했습니다.");
      }
      input.value = next;
      this.persistSettings();
      await this.reloadModelOptions();
    } catch (error) {
      input.value = this.settings.modelBridgeUrl;
      this.setChatError(messageOf(error));
    }
  }

  private async chooseAttachments(): Promise<void> {
    this.setChatError("");
    try {
      const selected = await this.localFileSystem.getFileForOpening({
        allowMultiple: true,
        ...(this.fileTypes.all ? { types: this.fileTypes.all } : {}),
      });
      const files = Array.isArray(selected) ? selected : selected ? [selected] : [];
      if (!files.length) return;
      const available = Math.max(0, MAX_ATTACHMENTS - this.attachments.length);
      for (const file of files.slice(0, available)) await this.addAttachment(file);
      if (files.length > available) this.setChatError(`첨부는 한 번에 ${MAX_ATTACHMENTS}개까지 가능합니다.`);
      this.renderAttachments();
      this.syncComposer();
    } catch (error) {
      this.setChatError(`첨부 실패: ${messageOf(error)}`);
      this.log(`Attachment picker failed: ${messageOf(error)}`);
    }
  }

  private async addAttachment(file: FileEntryLike): Promise<void> {
    const nativePath = typeof file.nativePath === "string"
      ? file.nativePath
      : this.localFileSystem.getNativePath?.(file) ?? "";
    if (!nativePath || this.attachments.some((attachment) => attachment.nativePath === nativePath)) return;
    const name = typeof file.name === "string" && file.name ? file.name : nativePath.split(/[\\/]/).at(-1) || "첨부 파일";
    const kind = classifyAttachment(name);
    const attachment: ChatAttachment = {
      id: this.nextId("attachment"),
      name,
      nativePath,
      kind,
    };
    if (kind === "text") await this.readTextAttachment(file, attachment);
    this.attachments.push(attachment);
  }

  private async readTextAttachment(file: FileEntryLike, attachment: ChatAttachment): Promise<void> {
    const used = this.attachments.reduce((sum, item) => sum + (item.text?.length ?? 0), 0);
    const remaining = Math.max(0, MAX_TEXT_CHARACTERS_TOTAL - used);
    if (!remaining) {
      attachment.truncated = true;
      attachment.text = "";
      return;
    }
    try {
      const content = await file.read();
      if (typeof content !== "string") return;
      const limit = Math.min(MAX_TEXT_CHARACTERS_PER_FILE, remaining);
      attachment.text = content.slice(0, limit);
      if (content.length > limit) attachment.truncated = true;
    } catch (error) {
      this.log(`Text attachment read failed for ${attachment.name}: ${messageOf(error)}`);
    }
  }

  private renderAttachments(): void {
    const list = element<HTMLDivElement>("attachmentList");
    clearElement(list);
    for (const attachment of this.attachments) {
      const chip = document.createElement("span");
      chip.className = "attachment-chip";
      chip.title = attachment.nativePath;
      const label = document.createElement("span");
      label.className = "attachment-chip__name";
      label.textContent = `${kindLabel(attachment.kind)} · ${attachment.name}`;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "×";
      remove.setAttribute("aria-label", `${attachment.name} 첨부 제거`);
      remove.addEventListener("click", () => {
        this.attachments = this.attachments.filter((item) => item.id !== attachment.id);
        this.renderAttachments();
        this.syncComposer();
      });
      chip.append(label, remove);
      list.append(chip);
    }
  }

  private async send(): Promise<void> {
    const rawMessage = controlValue(this.input()).trim();
    if (this.busy || (!rawMessage && !this.attachments.length)) return;
    if (!this.currentModel()) {
      this.setChatError("먼저 모델 브리지 연결을 확인하세요.");
      return;
    }

    const selectedAttachments = [...this.attachments];
    const displayMessage = rawMessage || "첨부 파일을 분석해 주세요.";
    const userMessage: ChatMessage = {
      id: this.nextId("message"),
      role: "user",
      content: displayMessage,
      ...(selectedAttachments.length ? { attachments: selectedAttachments.map(({ name, kind }) => ({ name, kind })) } : {}),
    };
    const pending: ChatMessage = { id: this.nextId("message"), role: "assistant", content: "", pending: true };
    this.messages.push(userMessage, pending);
    this.attachments = [];
    this.input().value = "";
    this.busy = true;
    this.setChatError("");
    this.renderAttachments();
    this.resizeInput();
    this.renderMessages();
    this.syncComposer();
    this.persistChat();

    try {
      let context: PremiereChatContext | undefined;
      if (this.settings.includePremiereContext) {
        try {
          context = await this.getPremiereContext();
        } catch (error) {
          this.log(`Premiere context omitted: ${messageOf(error)}`);
        }
      }
      const prompt = buildModelPrompt(rawMessage, selectedAttachments, context);
      const request: ModelRequest = {
        vendor: this.settings.vendor,
        model: this.settings.model,
        thinking: this.settings.thinking,
        prompt,
      };
      if (this.sessionId) request.resumeSessionId = this.sessionId;
      if (this.settings.workingDirectory) request.cwd = this.settings.workingDirectory;
      const addDirs = attachmentDirectories(selectedAttachments);
      if (addDirs.length) request.addDirs = addDirs;
      const response = await this.client.ask(this.settings.modelBridgeUrl, request);
      if (response.sessionId) this.sessionId = response.sessionId;
      this.replacePending(pending.id, {
        id: pending.id,
        role: "assistant",
        content: response.responseText || "(빈 응답)",
        meta: `${this.settings.model} · thinking ${this.settings.thinking}`,
      });
      this.log(`Model response received from ${this.settings.model}.`);
    } catch (error) {
      const message = messageOf(error);
      this.replacePending(pending.id, { id: pending.id, role: "assistant", content: message, error: true });
      this.setChatError(message);
      this.log(`Model request failed: ${message}`);
    } finally {
      this.busy = false;
      this.persistChat();
      this.renderMessages();
      this.syncComposer();
      this.input().focus();
    }
  }

  private renderMessages(): void {
    const container = element<HTMLElement>("messages");
    // Premiere's UXP DOM can leave stale nodes behind after bulk child replacement,
    // which made completed typing indicators and cleared chat rows reappear.
    clearElement(container);
    container.setAttribute("aria-busy", String(this.busy));
    if (!this.messages.length) {
      container.append(emptyState());
      return;
    }
    for (const message of this.messages) container.append(renderMessage(message));
    container.scrollTop = container.scrollHeight;
  }

  private replacePending(id: string, next: ChatMessage): void {
    const index = this.messages.findIndex((message) => message.id === id);
    if (index >= 0) this.messages[index] = next;
  }

  private resetSession(note: string): void {
    this.sessionId = null;
    this.messages.push({ id: this.nextId("message"), role: "system", content: note });
    this.persistChat();
    this.renderMessages();
  }

  private requestNewChat(): void {
    if (!this.messages.length) {
      this.clearChat();
      return;
    }
    element<HTMLElement>("newChatDialog").removeAttribute("hidden");
    element<HTMLButtonElement>("cancelNewChatButton").focus();
  }

  private closeNewChatDialog(): void {
    element<HTMLElement>("newChatDialog").setAttribute("hidden", "");
    element<HTMLButtonElement>("newChatButton").focus();
  }

  private clearChat(): void {
    this.messages = [];
    this.attachments = [];
    this.sessionId = null;
    this.persistChat();
    this.renderAttachments();
    this.renderMessages();
    this.syncComposer();
    this.input().focus();
  }

  private restoreChat(): void {
    try {
      const stored = JSON.parse(this.storage.getItem(CHAT_STORAGE_KEY) ?? "{}") as StoredChat;
      this.messages = Array.isArray(stored.messages) ? stored.messages.filter(validMessage) : [];
      if (stored.vendor === this.settings.vendor && stored.model === this.settings.model && typeof stored.sessionId === "string") {
        this.sessionId = stored.sessionId;
      }
    } catch {
      this.messages = [];
      this.sessionId = null;
    }
  }

  private persistChat(): void {
    const messages = this.messages
      .filter((message) => !message.pending)
      .slice(-MAX_PERSISTED_MESSAGES)
      .map((message) => ({ ...message, content: message.content.slice(0, MAX_PERSISTED_MESSAGE_CHARACTERS) }));
    try {
      this.storage.setItem(CHAT_STORAGE_KEY, JSON.stringify({
        messages,
        sessionId: this.sessionId,
        vendor: this.settings.vendor,
        model: this.settings.model,
      }));
    } catch {
      // Long model answers can exceed localStorage quota; the live chat remains intact.
    }
  }

  private persistSettings(): void {
    savePanelSettings(this.storage, this.settings);
  }

  private setModelStatus(state: "online" | "pending" | "offline", text: string): void {
    const dot = element<HTMLElement>("modelStatusDot");
    dot.className = `status-dot status-dot--${state}`;
    dot.setAttribute("aria-label", `모델 브리지 ${text}`);
    dot.title = `모델 브리지 · ${text}`;
    element<HTMLElement>("modelBridgeStatusText").textContent = text;
  }

  private setChatError(message: string): void {
    element<HTMLElement>("chatError").textContent = message;
  }

  private syncComposer(): void {
    element<HTMLButtonElement>("sendButton").disabled = this.busy
      || (!controlValue(this.input()).trim() && !this.attachments.length)
      || !this.currentModel();
    element<HTMLButtonElement>("attachButton").disabled = this.busy || this.attachments.length >= MAX_ATTACHMENTS;
  }

  private resizeInput(): void {
    const input = this.input();
    input.style.height = "auto";
    const maximumHeight = 150;
    const contentHeight = input.scrollHeight;
    input.style.height = `${Math.min(contentHeight, maximumHeight)}px`;
    input.style.overflowY = contentHeight > maximumHeight ? "auto" : "hidden";
  }

  private input(): HTMLTextAreaElement {
    return element<HTMLTextAreaElement>("chatInput");
  }

  private nextId(prefix: string): string {
    this.sequence += 1;
    return `${prefix}-${Date.now()}-${this.sequence}`;
  }
}

function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing panel element: ${id}`);
  return found as T;
}

function option(value: string, label: string): HTMLOptionElement {
  const entry = document.createElement("option");
  entry.value = value;
  entry.textContent = label;
  return entry;
}

// Premiere UXP can expose an empty form control value as null at runtime even
// though the browser DOM typings declare it as string.
function controlValue(control: { value: unknown }): string {
  return typeof control.value === "string" ? control.value : "";
}

function emptyState(): HTMLElement {
  const state = document.createElement("div");
  state.className = "empty-state";
  const mark = document.createElement("div");
  mark.className = "empty-state__mark";
  mark.textContent = "✦";
  mark.setAttribute("aria-hidden", "true");
  const title = document.createElement("h2");
  title.textContent = "무엇을 편집할까요?";
  const description = document.createElement("p");
  description.textContent = "Premiere 작업을 설명하거나 텍스트·이미지 파일을 첨부해 로컬 모델과 이어서 대화할 수 있습니다.";
  state.append(mark, title, description);
  return state;
}

function renderMessage(message: ChatMessage): HTMLElement {
  const row = document.createElement("article");
  row.className = `message message--${message.role}${message.error ? " message--error" : ""}`;
  if (message.role === "system") {
    row.textContent = message.content;
    return row;
  }
  const bubble = document.createElement("div");
  bubble.className = "message__bubble";
  if (message.pending) {
    bubble.innerHTML = '<span class="typing" aria-label="모델 응답 대기 중"><i></i><i></i><i></i></span>';
  } else if (message.role === "assistant" && !message.error) {
    bubble.innerHTML = renderMarkdown(message.content);
  } else {
    const content = document.createElement("div");
    content.textContent = message.content;
    bubble.append(content);
  }
  if (message.attachments?.length) bubble.append(renderMessageAttachments(message.attachments));
  if (message.meta) {
    const meta = document.createElement("div");
    meta.className = "message__meta";
    meta.textContent = message.meta;
    bubble.append(meta);
  }
  row.append(bubble);
  return row;
}

function clearElement(target: Element): void {
  while (target.firstChild) target.removeChild(target.firstChild);
}

function renderMessageAttachments(attachments: MessageAttachment[]): HTMLElement {
  const list = document.createElement("div");
  list.className = "message-attachments";
  for (const attachment of attachments) {
    const item = document.createElement("span");
    item.textContent = `${kindLabel(attachment.kind)} · ${attachment.name}`;
    list.append(item);
  }
  return list;
}

function validMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ChatMessage>;
  return ["user", "assistant", "system"].includes(candidate.role ?? "")
    && typeof candidate.id === "string"
    && typeof candidate.content === "string"
    && !candidate.pending;
}

function kindLabel(kind: AttachmentKind): string {
  if (kind === "image") return "이미지";
  if (kind === "text") return "텍스트";
  return "파일";
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
