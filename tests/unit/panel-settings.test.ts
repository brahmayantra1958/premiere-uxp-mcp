import { describe, expect, it } from "vitest";
import {
  DEFAULT_PANEL_SETTINGS,
  loadPanelSettings,
  PANEL_SETTINGS_KEY,
  savePanelSettings,
} from "../../apps/uxp-plugin/src/panel-settings.js";

describe("panel settings persistence", () => {
  it("returns independent defaults when storage is empty or malformed", () => {
    expect(loadPanelSettings({ getItem: () => null })).toEqual(DEFAULT_PANEL_SETTINGS);
    expect(loadPanelSettings({ getItem: () => "{" })).toEqual(DEFAULT_PANEL_SETTINGS);
  });

  it("normalizes saved strings while retaining an explicit context opt-out", () => {
    const settings = loadPanelSettings({
      getItem: () => JSON.stringify({
        modelBridgeUrl: "  http://localhost:4327  ",
        workingDirectory: "  C:\\work  ",
        includePremiereContext: false,
      }),
    });
    expect(settings.modelBridgeUrl).toBe("http://localhost:4327");
    expect(settings.workingDirectory).toBe("C:\\work");
    expect(settings.includePremiereContext).toBe(false);
  });

  it("writes the versioned settings record", () => {
    let record: { key?: string; value?: string } = {};
    savePanelSettings({
      setItem(key, value) { record = { key, value }; },
    }, DEFAULT_PANEL_SETTINGS);
    expect(record.key).toBe(PANEL_SETTINGS_KEY);
    expect(JSON.parse(record.value ?? "{}")).toEqual(DEFAULT_PANEL_SETTINGS);
  });
});
