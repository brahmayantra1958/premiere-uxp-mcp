export const PANEL_SETTINGS_KEY = "premiere-uxp-mcp-panel-settings-v1";

export type PanelSettings = {
  modelBridgeUrl: string;
  premiereBridgeUrl: string;
  vendor: string;
  model: string;
  thinking: string;
  workingDirectory: string;
  includePremiereContext: boolean;
};

type StorageReader = Pick<Storage, "getItem">;
type StorageWriter = Pick<Storage, "setItem">;

export const DEFAULT_PANEL_SETTINGS: PanelSettings = {
  modelBridgeUrl: "http://localhost:4327",
  premiereBridgeUrl: "ws://localhost:8099/",
  vendor: "openai",
  model: "gpt-5.5",
  thinking: "xhigh",
  workingDirectory: "",
  includePremiereContext: true,
};

export function loadPanelSettings(storage: StorageReader): PanelSettings {
  try {
    const parsed = JSON.parse(storage.getItem(PANEL_SETTINGS_KEY) ?? "{}") as Partial<PanelSettings>;
    return {
      modelBridgeUrl: nonEmptyString(parsed.modelBridgeUrl) ?? DEFAULT_PANEL_SETTINGS.modelBridgeUrl,
      premiereBridgeUrl: nonEmptyString(parsed.premiereBridgeUrl) ?? DEFAULT_PANEL_SETTINGS.premiereBridgeUrl,
      vendor: nonEmptyString(parsed.vendor) ?? DEFAULT_PANEL_SETTINGS.vendor,
      model: nonEmptyString(parsed.model) ?? DEFAULT_PANEL_SETTINGS.model,
      thinking: nonEmptyString(parsed.thinking) ?? DEFAULT_PANEL_SETTINGS.thinking,
      workingDirectory: typeof parsed.workingDirectory === "string" ? parsed.workingDirectory.trim() : "",
      includePremiereContext: parsed.includePremiereContext !== false,
    };
  } catch {
    return { ...DEFAULT_PANEL_SETTINGS };
  }
}

export function savePanelSettings(storage: StorageWriter, settings: PanelSettings): void {
  try {
    storage.setItem(PANEL_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    // Chat remains usable when the UXP storage quota is unavailable or full.
  }
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}
