import { describe, expect, it } from "vitest";
import {
  collectAdobeUxpCommandRoutes,
  collectAdobeUxpPluginRoutes,
  collectPremiereModuleSurface,
  inspectPremiereFeatureRoutes,
  openAdobeTextTranscriptionWorkflow,
} from "../../apps/uxp-plugin/src/premiere-feature-routes.js";

describe("Premiere existing-feature route discovery", () => {
  it("enumerates Adobe command entrypoints without treating third-party plugins as host routes", () => {
    const pluginManager = {
      plugins: [
        {
          id: "com.adobe.dva.text",
          name: "Text",
          version: "2.0.0",
          enabled: true,
          invokeCommand: () => undefined,
          manifest: {
            entrypoints: [
              { type: "command", id: "createCaptionStream", label: "Create caption stream" },
              { type: "panel", id: "mainPanel", label: "Text" },
            ],
          },
        },
        {
          id: "com.example.plugin",
          name: "Not Adobe",
          version: "1.0.0",
          enabled: true,
          manifest: { entrypoints: [{ type: "command", id: "unsafe", label: "Unsafe" }] },
        },
      ],
    };
    const routes = collectAdobeUxpCommandRoutes(pluginManager);

    expect(routes).toEqual([{
      pluginId: "com.adobe.dva.text",
      pluginName: "Text",
      pluginVersion: "2.0.0",
      enabled: true,
      ipcInvocationAvailable: true,
      commandId: "createCaptionStream",
      label: "Create caption stream",
    }]);
    expect(collectAdobeUxpPluginRoutes(pluginManager)).toEqual([{
      pluginId: "com.adobe.dva.text",
      pluginName: "Text",
      pluginVersion: "2.0.0",
      enabled: true,
      showPanelAvailable: false,
      invokeCommandAvailable: true,
      commandIds: ["createCaptionStream"],
      panelIds: ["mainPanel"],
    }]);
  });

  it("keeps discovered native commands fail-closed until a bounded dispatcher is live-verified", () => {
    const result = inspectPremiereFeatureRoutes({
      pluginManager: { plugins: [] },
      premiereModule: {},
      premiereVersion: "26.3.0",
      publicRoutes: [],
      hostNamespaceRoutes: [{
        feature: "speech_to_text_sequence",
        api: "mediaCoreSpeechToText.SpeechToTextAPI.transcribeSequence",
        available: false,
        access: "adobe_internal_host_namespace",
      }],
    });
    const candidates = result.nativeCommandCandidates as Array<Record<string, unknown>>;

    expect(result.policy).toBe("premiere_existing_feature_first");
    expect(result.adobeHostNamespaceRoutes).toEqual([expect.objectContaining({
      feature: "speech_to_text_sequence",
      available: false,
      access: "adobe_internal_host_namespace",
    })]);
    expect(candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({ commandId: "cmd.tools.object.selection", status: "bridge_required", publicUxpInvocable: false }),
      expect.objectContaining({ commandId: "cmd.track.bidirectional", status: "bridge_required", publicUxpInvocable: false }),
      expect.objectContaining({ commandId: "cmd.change.to.opacity.mask", status: "bridge_required", publicUxpInvocable: false }),
    ]));
  });

  it("reports Premiere module metadata without invoking accessors or methods", () => {
    let calls = 0;
    const corePrototype = { executeCommand() { calls += 1; } };
    const core = Object.create(corePrototype) as Record<string, unknown>;
    Object.defineProperty(core, "menuState", {
      enumerable: true,
      get() { calls += 1; return "ready"; },
    });
    core.runMenuItem = () => { calls += 1; };
    class ApplicationMock {
      static getActiveProject() { calls += 1; }
    }

    const result = collectPremiereModuleSurface({ core, Application: ApplicationMock });

    expect(calls).toBe(0);
    expect(result.module.ownProperties).toEqual(expect.arrayContaining(["Application", "core"]));
    expect(result.core).toMatchObject({
      available: true,
      ownMethods: ["runMenuItem"],
      ownAccessors: ["menuState"],
      prototypeMethods: ["executeCommand"],
    });
    expect(result.application.ownMethods).toContain("getActiveProject");
  });

  it("opens Adobe Text and dispatches the exact sequence transcription payload", async () => {
    const calls: Array<{ method: string; args: unknown[] }> = [];
    const result = await openAdobeTextTranscriptionWorkflow({
      plugins: [{
        id: "com.adobe.dva.text",
        name: "Text",
        version: "2.0.0",
        enabled: true,
        manifest: {
          entrypoints: [
            { type: "command", id: "createTranscription", label: "Create transcription" },
            { type: "panel", id: "mainPanel", label: "Text" },
          ],
        },
        showPanel: async (...args: unknown[]) => { calls.push({ method: "showPanel", args }); },
        invokeCommand: async (...args: unknown[]) => { calls.push({ method: "invokeCommand", args }); },
      }],
    }, { projectGuid: "project-guid", sequenceGuid: "sequence-guid" });

    expect(calls).toEqual([
      { method: "showPanel", args: ["mainPanel"] },
      { method: "invokeCommand", args: ["createTranscription", JSON.stringify({ projectGuid: "project-guid", assetGuid: "sequence-guid" })] },
    ]);
    expect(result).toMatchObject({
      pluginId: "com.adobe.dva.text",
      pluginVersion: "2.0.0",
      panelRequestAccepted: true,
      invocationAccepted: true,
      workflowState: "ipc_dispatch_accepted_unverified",
    });
  });

  it("fails closed when the installed Adobe Text contract version is unknown", async () => {
    await expect(openAdobeTextTranscriptionWorkflow({
      plugins: [{
        id: "com.adobe.dva.text",
        version: "3.0.0",
        enabled: true,
        manifest: {
          entrypoints: [
            { type: "command", id: "createTranscription" },
            { type: "panel", id: "mainPanel" },
          ],
        },
        showPanel: () => undefined,
        invokeCommand: () => undefined,
      }],
    }, { projectGuid: "project-guid", sequenceGuid: "sequence-guid" }))
      .rejects.toMatchObject({ code: "ADOBE_TEXT_CONTRACT_VERSION_MISMATCH" });
  });

  it("does not report a string rejection from showPanel as an accepted workflow", async () => {
    await expect(openAdobeTextTranscriptionWorkflow({
      plugins: [{
        id: "com.adobe.dva.text",
        version: "2.0.0",
        enabled: true,
        manifest: {
          entrypoints: [
            { type: "command", id: "createTranscription" },
            { type: "panel", id: "mainPanel" },
          ],
        },
        showPanel: () => "Host disallowed panel request",
        invokeCommand: () => undefined,
      }],
    }, { projectGuid: "project-guid", sequenceGuid: "sequence-guid" }))
      .rejects.toMatchObject({ code: "ADOBE_TEXT_PANEL_REQUEST_REJECTED" });
  });
});
