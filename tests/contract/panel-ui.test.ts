import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("Premiere panel information architecture", () => {
  it("puts agent connection and tasks first while keeping deprecated chat out of the active page", async () => {
    const html = await readFile(path.resolve("apps/uxp-plugin/public/index.html"), "utf8");
    const settingsIndex = html.indexOf('id="settingsDialog"');
    expect(settingsIndex).toBeGreaterThan(0);
    expect(html).toContain('id="settingsButton"');
    for (const id of ["serverPort", "connectButton", "taskList"]) {
      expect(html.indexOf(`id="${id}"`)).toBeGreaterThan(0);
      expect(html.indexOf(`id="${id}"`)).toBeLessThan(settingsIndex);
    }
    for (const id of ["messages", "chatInput", "modelSelect", "modelBridgeUrl", "snapshotOutput"]) expect(html).not.toContain(`id="${id}"`);
    expect(html.indexOf('id="pairingToken"')).toBeGreaterThan(settingsIndex);
    expect(html.indexOf('id="activityLog"')).toBeGreaterThan(settingsIndex);
  });

  it("provides visible button labels and an accessible port field", async () => {
    const html = await readFile(path.resolve("apps/uxp-plugin/public/index.html"), "utf8");
    for (const id of ["settingsButton", "connectButton", "clearTasksButton", "closeSettingsButton"]) {
      expect(html).toMatch(new RegExp(`id="${id}"[^>]*>[^<]+</button>`));
    }
    expect(html).toContain('label for="serverPort"');
    expect(html).not.toContain("<svg");
  });

  it("uses Premiere-supported Flex layout and document.theme classes", async () => {
    const [styles, source] = await Promise.all([
      readFile(path.resolve("apps/uxp-plugin/public/styles.css"), "utf8"),
      readFile(path.resolve("apps/uxp-plugin/index.ts"), "utf8"),
    ]);
    expect(styles).not.toMatch(/display:\s*grid/);
    expect(styles).not.toContain("--uxp-host-");
    expect(styles).toContain("body.theme-light");
    expect(styles).toContain("body.theme-darkest");
    expect(source).toContain("theme?.getCurrent()");
    expect(source).toContain("theme?.onUpdated?.addListener(apply)");
  });

  it("uses a separate settings page while preserving the feature-specific mask overlay", async () => {
    const [html, source, index] = await Promise.all([
      readFile(path.resolve("apps/uxp-plugin/public/index.html"), "utf8"),
      readFile(path.resolve("apps/uxp-plugin/src/chat-controller.ts"), "utf8"),
      readFile(path.resolve("apps/uxp-plugin/index.ts"), "utf8"),
    ]);
    expect(html).not.toContain("<dialog");
    expect(html).toContain('class="modal-overlay"');
    expect(source).not.toContain("uxpShowModal");
    expect(index).not.toContain("uxpShowModal");
    expect(source).not.toContain("window.confirm");
    expect(source).not.toContain("window.alert");
    expect(html).toMatch(/id="settingsDialog" class="panel-shell settings-page"/);
    expect(index).not.toContain("new ChatController");
    expect(index).not.toContain("host.panelSnapshot()");
  });

  it("clears dynamic panel content with host-compatible child removal", async () => {
    const source = await readFile(path.resolve("apps/uxp-plugin/src/chat-controller.ts"), "utf8");
    expect(source).not.toContain("replaceChildren(");
    expect(source).toContain("while (target.firstChild) target.removeChild(target.firstChild)");
  });

  it("shows host-command start and completion in the visible activity log", async () => {
    const source = await readFile(path.resolve("apps/uxp-plugin/src/bridge-client.ts"), "utf8");
    expect(source).toContain("Running ${request.command}…");
    expect(source).toContain("${request.command}: ${resultStatus}");
  });

  it("does not overlap health checks or grow the activity log with identical offline errors", async () => {
    const source = await readFile(path.resolve("apps/uxp-plugin/src/chat-controller.ts"), "utf8");
    expect(source).not.toContain("setInterval(");
    expect(source).toContain("if (this.healthCheckInFlight) return this.healthCheckInFlight");
    expect(source).toContain("this.scheduleHealthPoll(this.healthPollState.delayMs)");
    expect(source).toContain("if (transition.logMessage) this.log(transition.logMessage)");
  });

  it("provides an in-panel image-pixel Object Mask prompt without global coordinate automation", async () => {
    const [html, source, host] = await Promise.all([
      readFile(path.resolve("apps/uxp-plugin/public/index.html"), "utf8"),
      readFile(path.resolve("apps/uxp-plugin/src/mask-prompt-controller.ts"), "utf8"),
      readFile(path.resolve("apps/uxp-plugin/src/premiere-host.ts"), "utf8"),
    ]);
    for (const id of ["maskPromptDialog", "maskPromptStage", "maskPromptPositive", "maskPromptNegative", "maskPromptBox", "maskPromptConfirm", "maskPromptCancel"]) {
      expect(html).toContain(`id="${id}"`);
    }
    expect(source).toContain('coordinateSpace: "image_pixels"');
    expect(source).toContain("containImageBounds");
    expect(host).toContain('case "collect_object_mask_prompt"');
    expect(source).not.toMatch(/robotjs|SendInput|SetCursorPos|mouse_event/);
  });
});
