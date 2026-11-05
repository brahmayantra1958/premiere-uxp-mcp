import { BridgeClient, type BridgeClose } from "./src/bridge-client.js";
import { TaskHistory, TaskActivityView, type TaskEvent } from "./src/task-activity.js";
import { normalizeLocalBridgeUrl } from "./src/bridge-url.js";
import { PANEL_ENTRYPOINT_ID, PANEL_VERSION } from "./src/plugin-contract.js";
import { destroyMaskPromptController, hideMaskPromptPanel, initializeMaskPromptController } from "./src/mask-prompt-controller.js";
import { loadPanelSettings, savePanelSettings } from "./src/panel-settings.js";
import { PremiereHost } from "./src/premiere-host.js";
import { ProjectCredentialStore, resolveSavedConnection } from "./src/project-credential.js";
import type { BridgeAuthResponse, BridgeRequest } from "./src/wire.js";
import { RuntimeBootstrap } from './src/runtime-bootstrap.js';

declare const require: (name: string) => any;
import { deployment } from './src/installation-config.js';

const uxp = require("uxp") as any;
const { entrypoints } = uxp as { entrypoints: { setup(config: unknown): void } };
const secureStorage = uxp.storage?.secureStorage ?? uxp.secureStorage;
if (!secureStorage) throw new Error("UXP secureStorage is unavailable");

const host: PremiereHost = new PremiereHost((id, target) => updateTask({ phase: "targeted", id, target }), updateTask,
  (id,panel,projectName,sequenceName)=>bridge.requestNativeVisibility(id,panel,projectName,sequenceName),id=>bridge.requestProgramFrameReady(id),
  (id,target)=>bridge.requestProjectSelection(id,target),id=>bridge.requestNativeVisual(id),
  (id,phase,work)=>bridge.requestEffectDisclosure(id,phase,work),
  (id,phase,step,work)=>bridge.requestMaskTracking(id,phase,step,work),
  (id,work)=>bridge.requestNativeMaskArchive(id,work),event=>bridge.publishJobProgress(event),
  (id,work)=>bridge.requestEffectChainProof(id,work),(id,work)=>bridge.requestEffectNativeSample(id,work));
const credentials = new ProjectCredentialStore(secureStorage);
const settings = loadPanelSettings(localStorage);
const bootstrap = new RuntimeBootstrap(uxp.shell,
  deployment.runtimeLauncher, log);
const retryDelaysMs = [1_000, 2_000, 5_000, 10_000];

let activeProjectId = "";
const CONNECTION_ID_KEY = "premiere-uxp-mcp.connection-identity";
let connectionProjectId = localStorage.getItem(CONNECTION_ID_KEY) || "";
let manualDisconnect = false;
let destroying = false;
let initialWireTimer: ReturnType<typeof setTimeout> | undefined;
let reconnectAttempt = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let wired = false;
let connectionStarted = false;
let currentStatus: "disconnected" | "connecting" | "connected" = "disconnected";
let currentConnectionMode = "프로젝트 확인 중";
let identityRefresh: Promise<Record<string, any>> | undefined;
let connectInFlight = false;
let themeWired = false;
const activityHistory: string[] = [];
const taskHistory = new TaskHistory();
let taskView: TaskActivityView | undefined;

function optionalElement<T extends HTMLElement>(id: string): T | undefined {
  return document.getElementById(id) as T | null ?? undefined;
}

function element<T extends HTMLElement>(id: string): T {
  const found = optionalElement<T>(id);
  if (!found) throw new Error(`Missing panel element: ${id}`);
  return found;
}

function log(message: string): void {
  if (destroying) return;
  const text = `${new Date().toLocaleTimeString()} · ${message}`;
  activityHistory.unshift(text);
  if (activityHistory.length > 10) activityHistory.length = 10;
  renderActivityLog();
}

function renderActivityLog(): void {
  if (optionalElement("settingsDialog")?.hidden !== false) return;
  const list = optionalElement("activityLog");
  if (list) list.textContent = activityHistory.join("\n");
}

function updateTask(event: TaskEvent): void {
  if (destroying) return;
  const item = taskHistory.apply(event);
  if (item) taskView?.update(item, taskHistory.items);
}

function setStatus(state: "disconnected" | "connecting" | "connected"): void {
  if (destroying) return;
  currentStatus = state;
  setText("statusBadge", state === "connected" ? "연결됨" : state === "connecting" ? "연결 중" : "연결 끊김");
  const button = optionalElement<HTMLButtonElement>("connectButton");
  if (button) { button.textContent = state === "connected" ? "연결 해제" : "연결"; button.disabled = state === "connecting"; }
  const dot = optionalElement<HTMLElement>("premiereStatusDot");
  if (!dot) return;
  const visualState = state === "connected" ? "online" : state === "connecting" ? "pending" : "offline";
  const label = state === "connected" ? "연결됨" : state === "connecting" ? "연결 중" : "연결 끊김";
  dot.className = `status-dot status-dot--${visualState}`;
  dot.title = `Premiere MCP · ${label}`;
}

function setConnectionMode(value: string): void {
  if (destroying) return;
  currentConnectionMode = value;
  const mode = optionalElement<HTMLElement>("connectionMode");
  if (mode) mode.textContent = value;
}

function setText(id: string, value: unknown): void {
  if (destroying) return;
  const target = optionalElement<HTMLElement>(id);
  if (target) target.textContent = value == null || value === "" ? "—" : String(value);
}

function cancelReconnect(): void {
  if (reconnectTimer !== undefined) clearTimeout(reconnectTimer);
  reconnectTimer = undefined;
}

function applySnapshot(snapshot: Record<string, any>): void {
  setText("projectName", snapshot.projectName);
  setText("sequenceName", snapshot.activeSequence?.name);
  activeProjectId = typeof snapshot.projectId === "string" ? snapshot.projectId : activeProjectId;
  const project = typeof snapshot.projectName === "string" && snapshot.projectName ? snapshot.projectName : "열린 프로젝트 없음";
  const sequence = typeof snapshot.activeSequence?.name === "string" && snapshot.activeSequence.name
    ? ` · ${snapshot.activeSequence.name}`
    : "";
  const context = optionalElement<HTMLElement>("premiereContextText");
  if (context) context.textContent = snapshot.error ? `Premiere 상태 확인 실패 · ${String(snapshot.error)}` : `${project}${sequence}`;
}

async function pingHost(): Promise<void> {
  if (destroying) return;
  setText("panelVersion", PANEL_VERSION);
  const ping = await host.dispatch({
    version: 1,
    id: `panel-ping-${Date.now()}`,
    command: "premiere_ping",
    args: {},
    timeoutMs: 5_000,
  } satisfies BridgeRequest) as Record<string, unknown>;
  setText("premiereVersion", ping.premiereVersion);
  setText("uxpVersion", ping.uxpVersion);
}

// Identity reads are small and coalesced. Opening settings never scans the timeline.
async function refreshConnectionIdentity(): Promise<Record<string, any>> {
  if (destroying) return {error: 'Plugin is being destroyed'};
  if (identityRefresh) return identityRefresh;
  identityRefresh = (async () => {
    const snapshot = await host.connectionSnapshot();
    if (destroying) return snapshot;
    applySnapshot(snapshot);
    await pingHost();
    return snapshot;
  })();
  try { return await identityRefresh; }
  finally { identityRefresh = undefined; }
}

async function savedCredential() {
  return resolveSavedConnection(credentials, connectionProjectId, activeProjectId);
}

async function connectForCurrentProject(preferEnteredToken: boolean): Promise<boolean> {
  if (destroying) return false;
  if (!activeProjectId) await refreshConnectionIdentity();
  if (destroying) return false;
  if (!activeProjectId && !connectionProjectId) {
    setConnectionMode("Premiere 프로젝트를 먼저 여세요");
    log("A project must be open before pairing can be saved.");
    return false;
  }

  const url = normalizeLocalBridgeUrl(settings.premiereBridgeUrl);
  const token = String(optionalElement<HTMLInputElement>("pairingToken")?.value ?? "").trim();
  const saved = await savedCredential();
  if (manualDisconnect) return false;
  connectionProjectId = (preferEnteredToken && token) ? (activeProjectId || connectionProjectId) : (saved?.projectId || activeProjectId || connectionProjectId);
  settings.premiereBridgeUrl = url;
  savePanelSettings(localStorage, settings);
  if (preferEnteredToken && token) {
    bridge.connect(url, { method: "pairing_token", projectId: connectionProjectId, token });
    setConnectionMode("로컬 연결 설정 중…");
    return true;
  }
  if (saved) {
    bridge.connect(url, { method: "project_credential", projectId: connectionProjectId, credential: saved.credential });
    setConnectionMode("저장된 연결 사용 중…");
    return true;
  }
  if (token) {
    bridge.connect(url, { method: "pairing_token", projectId: connectionProjectId, token });
    setConnectionMode("로컬 연결 설정 중…");
    return true;
  }

  bridge.connect(url, { method: "local_approval", projectId: connectionProjectId });
  setConnectionMode("일회용 명령 승인 대기 중…");
  return true;
}

function scheduleReconnect(): void {
  if (manualDisconnect || reconnectTimer !== undefined) return;
  const delay = retryDelaysMs[Math.min(reconnectAttempt, retryDelaysMs.length - 1)] ?? 10_000;
  reconnectAttempt += 1;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = undefined;
    void connectForCurrentProject(false)
      .then((started) => { if (!started) scheduleReconnect(); })
      .catch((error) => {
        log(`Reconnect failed: ${messageOf(error)}`);
        scheduleReconnect();
      });
  }, delay);
  setConnectionMode(`로컬 서버 대기 중 · ${Math.round(delay / 1000)}초 후 재시도`);
}

async function handleAuthenticated(response: BridgeAuthResponse): Promise<void> {
  if (destroying) return;
  if (response.projectId !== connectionProjectId) {
    manualDisconnect = true;
    bridge.disconnect("connection identity changed during authentication");
    throw new Error("The authenticated identity does not match the requested connection");
  }
  if (response.credential) await credentials.set(response.projectId, response.credential);
  if (destroying) return;
  localStorage.setItem(CONNECTION_ID_KEY, response.projectId);
  cancelReconnect();
  reconnectAttempt = 0;
  const tokenInput = optionalElement<HTMLInputElement>("pairingToken");
  if (tokenInput) tokenInput.value = "";
  const forgetButton = optionalElement<HTMLButtonElement>("forgetButton");
  if (forgetButton) forgetButton.disabled = false;
  setConnectionMode(response.credentialIssued ? "로컬 연결 저장됨" : "자동 연결됨");
}

async function handleClosed(close: BridgeClose): Promise<void> {
  if (destroying) return;
  if (close.code === 1008 && close.reason === "invalid project credential" && connectionProjectId) {
    await credentials.remove(connectionProjectId);
    if (destroying) return;
    localStorage.removeItem(CONNECTION_ID_KEY);
    connectionProjectId = "";
    manualDisconnect = true;
    setConnectionMode("저장 연결 만료 · 일회 승인 필요");
    log("The saved project connection expired and was cleared.");
    return;
  }
  if (close.code === 1008 && close.reason === "local approval not active") {
    setConnectionMode("로컬 서버를 일회 승인 모드로 시작하세요");
  }
  if (!manualDisconnect) {
    if ([1000, 1005, 1006, 1011].includes(close.code)) void bootstrap.start();
    scheduleReconnect();
  }
}

const bridge = new BridgeClient(
  (request) => host.dispatch(request),
  setStatus,
  log,
  handleAuthenticated,
  handleClosed,
  updateTask,
);

async function initializeConnection(): Promise<void> {
  await refreshConnectionIdentity();
  if (destroying) return;
  const saved = await savedCredential();
  if (destroying) return;
  const forgetButton = optionalElement<HTMLButtonElement>("forgetButton");
  if (forgetButton) forgetButton.disabled = !saved;
  if (!await connectForCurrentProject(false)) scheduleReconnect();
}

function startConnection(): void {
  if (destroying || connectionStarted) return;
  connectionStarted = true;
  void initializeConnection().catch((error) => {
    if (destroying) return;
    setStatus("disconnected");
    setConnectionMode("Premiere 준비 대기 중");
    log(`Host initialization failed: ${messageOf(error)}`);
    scheduleReconnect();
  });
}

function requestConnect(): void {
  if (destroying || connectInFlight) return;
  if (currentStatus === "connected") {
    manualDisconnect = true;
    cancelReconnect();
    bridge.disconnect();
    setConnectionMode("일시정지됨 · 저장 연결 유지");
    return;
  }
  manualDisconnect = false;
  reconnectAttempt = 0;
  cancelReconnect();
  connectInFlight = true;
  void refreshConnectionIdentity().then(() => connectForCurrentProject(true)).catch((error) => {
    setStatus("disconnected");
    setConnectionMode("연결 설정 확인 필요");
    log(`Connection failed: ${messageOf(error)}`);
    scheduleReconnect();
  }).finally(() => { connectInFlight = false; });
}

function showSettings(): void {
  // A separate page avoids native-input/overlay repaint conflicts in UXP.
  // No host inspection, model networking, timers, or full-history render here.
  element("panel").hidden = true;
  element("settingsDialog").hidden = false;
  renderActivityLog();
  element<HTMLButtonElement>("closeSettingsButton").focus();
}

function closeSettings(): void {
  element("settingsDialog").hidden = true;
  element("panel").hidden = false;
  element<HTMLButtonElement>("settingsButton").focus();
}

function hydratePanel(): void {
  initializeTheme();
  setStatus(currentStatus);
  setConnectionMode(currentConnectionMode);
  element<HTMLInputElement>("serverPort").value = "8099";
  taskView = new TaskActivityView(element("taskList"), element("taskEmpty"), element("taskCount"));
  for (const item of [...taskHistory.items].reverse()) taskView.update(item, taskHistory.items);
}

function initializeTheme(): void {
  if (themeWired) return;
  themeWired = true;
  const theme = (document as unknown as {
    theme?: { getCurrent(): string; onUpdated?: { addListener(listener: (value: string) => void): void } };
  }).theme;
  const apply = (value: string): void => {
    if (destroying) return;
    document.body.classList.remove("theme-light", "theme-dark", "theme-darkest");
    const normalized = String(value || "dark").toLowerCase();
    document.body.classList.add(normalized.includes("light") ? "theme-light" : normalized.includes("darkest") ? "theme-darkest" : "theme-dark");
  };
  apply(theme?.getCurrent() ?? "dark");
  theme?.onUpdated?.addListener(apply);
}

function wirePanel(): void {
  if (destroying || wired) return;
  wired = true;
  element<HTMLButtonElement>("settingsButton").addEventListener("click", showSettings);
  element<HTMLButtonElement>("closeSettingsButton").addEventListener("click", closeSettings);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !element("settingsDialog").hidden) closeSettings();
  });
  element<HTMLButtonElement>("connectButton").addEventListener("click", requestConnect);
  element<HTMLInputElement>("pairingToken").addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    requestConnect();
  });
  element<HTMLButtonElement>("forgetButton").addEventListener("click", () => {
    manualDisconnect = true;
    cancelReconnect();
    void credentials.remove(connectionProjectId).then(() => {
      if (destroying) return;
      localStorage.removeItem(CONNECTION_ID_KEY);
      connectionProjectId = "";
      bridge.disconnect("project connection forgotten");
      element<HTMLButtonElement>("forgetButton").disabled = true;
      setConnectionMode("페어링되지 않음");
      log("Saved local connection removed.");
    });
  });
  element<HTMLButtonElement>("refreshContextButton").addEventListener("click", () => {
    void refreshConnectionIdentity().catch((error) => log(messageOf(error)));
  });
  element<HTMLButtonElement>("clearTasksButton").addEventListener("click", () => {
    taskHistory.clearCompleted();
    taskView?.reconcile(taskHistory.items);
  });
  element<HTMLButtonElement>("pairButton").addEventListener("click", () => {
    if (currentStatus === "connected") { closeSettings(); return; }
    requestConnect();
  });
  hydratePanel();
  initializeMaskPromptController(log);
  startConnection();
}

entrypoints.setup({
  plugin: {
    create(): void { startConnection(); },
    destroy(): void {
      if (destroying) return;
      destroying = true;
      try { console.info('[plugin-teardown]', JSON.stringify({phase: 'destroy-enter'})); }
      catch { /* Observation only. */ }
      manualDisconnect = true;
      cancelReconnect();
      if (initialWireTimer !== undefined) clearTimeout(initialWireTimer);
      const released = bridge.dispose();
      let maskPromptCleanup: 'pass' | 'unverified' = 'pass';
      try { destroyMaskPromptController(); }
      catch { maskPromptCleanup = 'unverified'; }
      // Unload must not introduce new callbacks into the context being removed.
      // This reports synchronous cleanup, never transport or host completion.
      try {
        const status = maskPromptCleanup === 'pass' ? released.status : 'unverified';
        const message = JSON.stringify({...released, phase: status === 'pass' ? 'destroy-callbacks-released' : 'destroy-unverified', status, maskPromptCleanup});
        if (status === 'pass') console.info('[plugin-teardown]', message);
        else console.warn('[plugin-teardown]', message);
      } catch { /* Observation only. */ }
    },
  },
  panels: {
    [PANEL_ENTRYPOINT_ID]: {
      show(): void {
        wirePanel();
      },
      hide(): void {
        hideMaskPromptPanel();
        /* Keep the agent MCP transport alive while the panel is hidden. */
      },
      destroy(): void { /* Plugin lifecycle owns connection cleanup. */ },
    },
  },
});

// UDT can reload a visible panel without replaying Premiere's panel show hook.
if (!destroying) initialWireTimer = setTimeout(wirePanel, 0);

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
