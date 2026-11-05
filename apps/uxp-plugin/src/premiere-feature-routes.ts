export type AdobeUxpCommandRoute = {
  pluginId: string;
  pluginName: string;
  pluginVersion: string;
  enabled: boolean;
  ipcInvocationAvailable: boolean;
  commandId: string;
  label: string;
};

export type AdobeUxpPluginRoute = {
  pluginId: string;
  pluginName: string;
  pluginVersion: string;
  enabled: boolean;
  showPanelAvailable: boolean;
  invokeCommandAvailable: boolean;
  commandIds: string[];
  panelIds: string[];
};

export type PremierePublicRouteProbe = {
  feature: string;
  api: string;
  available: boolean;
};

export type PremiereHostNamespaceRouteProbe = {
  feature: string;
  api: string;
  available: boolean;
  access: "adobe_internal_host_namespace";
};

export type RuntimeSurfaceProbe = {
  available: boolean;
  valueType: string;
  enumerableProperties: string[];
  ownProperties: string[];
  ownMethods: string[];
  ownAccessors: string[];
  prototypeProperties: string[];
  prototypeMethods: string[];
  errors: string[];
};

export type PremiereModuleSurfaceProbe = {
  module: RuntimeSurfaceProbe;
  core: RuntimeSurfaceProbe;
  application: RuntimeSurfaceProbe;
};

type UxpPluginLike = {
  id?: unknown;
  name?: unknown;
  version?: unknown;
  enabled?: unknown;
  manifest?: unknown;
  showPanel?: (panelId: string) => unknown;
  invokeCommand?: (commandId: string, ...params: unknown[]) => unknown;
};

type ManifestCommand = { id: string; label: string };

export const ADOBE_TEXT_PLUGIN_ID = "com.adobe.dva.text";
export const ADOBE_TEXT_PLUGIN_VERSIONS = ["2.0.0"] as const;
export const ADOBE_TEXT_PANEL_ID = "mainPanel";
export const ADOBE_TEXT_TRANSCRIPTION_COMMAND_ID = "createTranscription";

export class PremiereFeatureRouteError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "PremiereFeatureRouteError";
  }
}

export const PREMIERE_NATIVE_COMMAND_CANDIDATES = [
  { feature: "object_selection", commandId: "cmd.tools.object.selection" },
  { feature: "object_selection_draw_mode", commandId: "cmd.tools.object.selection.change.drawmode" },
  { feature: "object_selection_add", commandId: "cmd.add.to.mask.or.selection" },
  { feature: "object_selection_subtract", commandId: "cmd.subtract.from.mask.or.selection" },
  { feature: "object_mask_track_bidirectional", commandId: "cmd.track.bidirectional" },
  { feature: "object_mask_invert", commandId: "cmd.invert.mask" },
  { feature: "selection_to_opacity_mask", commandId: "cmd.change.to.opacity.mask" },
  { feature: "opacity_mask_to_selection", commandId: "cmd.change.to.selection" },
  { feature: "mask_blend_add", commandId: "cmd.set.mask.blend.mode.to.add" },
  { feature: "mask_blend_subtract", commandId: "cmd.set.mask.blend.mode.to.subtract" },
  { feature: "mask_blend_intersect", commandId: "cmd.set.mask.blend.mode.to.intersect" },
  { feature: "caption_track_add", commandId: "cmd.caption.add.track" },
  { feature: "caption_item_add", commandId: "cmd.caption.add.trackitem" },
  { feature: "caption_item_edit", commandId: "cmd.caption.edit.trackitem" },
] as const;

function text(value: unknown): string {
  return value == null ? "" : String(value);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

/**
 * Read only JavaScript property metadata. Descriptor values are classified, but
 * accessors and functions are never invoked. This keeps live host discovery
 * separate from command execution.
 */
export function collectRuntimeSurface(value: unknown): RuntimeSurfaceProbe {
  const available = value != null;
  const result: RuntimeSurfaceProbe = {
    available,
    valueType: typeof value,
    enumerableProperties: [],
    ownProperties: [],
    ownMethods: [],
    ownAccessors: [],
    prototypeProperties: [],
    prototypeMethods: [],
    errors: [],
  };
  if (!available || (typeof value !== "object" && typeof value !== "function")) return result;

  try {
    result.enumerableProperties = sortedUnique(Object.keys(value));
  } catch (error) {
    result.errors.push(`enumerableProperties: ${errorText(error)}`);
  }
  try {
    result.ownProperties = sortedUnique(Object.getOwnPropertyNames(value));
    for (const name of result.ownProperties) {
      try {
        const descriptor = Object.getOwnPropertyDescriptor(value, name);
        if (!descriptor) continue;
        if (typeof descriptor.value === "function") result.ownMethods.push(name);
        if (typeof descriptor.get === "function" || typeof descriptor.set === "function") result.ownAccessors.push(name);
      } catch (error) {
        result.errors.push(`ownProperty:${name}: ${errorText(error)}`);
      }
    }
    result.ownMethods = sortedUnique(result.ownMethods);
    result.ownAccessors = sortedUnique(result.ownAccessors);
  } catch (error) {
    result.errors.push(`ownProperties: ${errorText(error)}`);
  }
  try {
    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype && (typeof prototype === "object" || typeof prototype === "function")) {
      result.prototypeProperties = sortedUnique(Object.getOwnPropertyNames(prototype));
      for (const name of result.prototypeProperties) {
        try {
          const descriptor = Object.getOwnPropertyDescriptor(prototype, name);
          if (typeof descriptor?.value === "function") result.prototypeMethods.push(name);
        } catch (error) {
          result.errors.push(`prototypeProperty:${name}: ${errorText(error)}`);
        }
      }
      result.prototypeMethods = sortedUnique(result.prototypeMethods);
    }
  } catch (error) {
    result.errors.push(`prototypeProperties: ${errorText(error)}`);
  }
  return result;
}

function readNamedSurface(moduleValue: unknown, propertyName: "core" | "Application"): RuntimeSurfaceProbe {
  if (!moduleValue || (typeof moduleValue !== "object" && typeof moduleValue !== "function")) {
    return collectRuntimeSurface(undefined);
  }
  try {
    return collectRuntimeSurface((moduleValue as Record<string, unknown>)[propertyName]);
  } catch (error) {
    const result = collectRuntimeSurface(undefined);
    result.errors.push(`${propertyName}: ${errorText(error)}`);
    return result;
  }
}

export function collectPremiereModuleSurface(premiereModule: unknown): PremiereModuleSurfaceProbe {
  return {
    module: collectRuntimeSurface(premiereModule),
    core: readNamedSurface(premiereModule, "core"),
    application: readNamedSurface(premiereModule, "Application"),
  };
}

function localizedLabel(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const label = value as Record<string, unknown>;
  return text(label.default ?? label.en_US ?? Object.values(label)[0]);
}

function manifestCommands(manifest: unknown): ManifestCommand[] {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return [];
  const value = manifest as Record<string, unknown>;
  const commands = new Map<string, ManifestCommand>();
  const add = (candidate: unknown): void => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return;
    const entry = candidate as Record<string, unknown>;
    const id = text(entry.id);
    if (!id) return;
    commands.set(id, { id, label: localizedLabel(entry.label) });
  };

  if (Array.isArray(value.entrypoints)) {
    for (const entry of value.entrypoints) {
      if (entry && typeof entry === "object" && !Array.isArray(entry)
        && text((entry as Record<string, unknown>).type) === "command") add(entry);
    }
  }
  if (Array.isArray(value.commands)) for (const command of value.commands) add(command);
  else if (value.commands && typeof value.commands === "object") {
    for (const [id, command] of Object.entries(value.commands as Record<string, unknown>)) {
      add(command && typeof command === "object" ? { id, ...(command as Record<string, unknown>) } : { id, label: command });
    }
  }
  return [...commands.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function manifestPanelIds(manifest: unknown): string[] {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return [];
  const entrypoints = (manifest as Record<string, unknown>).entrypoints;
  if (!Array.isArray(entrypoints)) return [];
  return entrypoints
    .filter((entry) => entry != null
      && typeof entry === "object"
      && !Array.isArray(entry)
      && text((entry as Record<string, unknown>).type) === "panel")
    .map((entry) => text((entry as Record<string, unknown>).id))
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));
}

function pluginArray(plugins: unknown): UxpPluginLike[] {
  if (Array.isArray(plugins)) return plugins as UxpPluginLike[];
  if (!plugins || typeof plugins !== "object") return [];
  try { return Array.from(plugins as Iterable<UxpPluginLike>); }
  catch { /* some UXP collections are array-like rather than iterable */ }
  const length = Number((plugins as { length?: unknown }).length);
  if (!Number.isInteger(length) || length < 0) return [];
  const values: UxpPluginLike[] = [];
  for (let index = 0; index < length; index += 1) {
    const value = (plugins as Record<number, UxpPluginLike>)[index];
    if (value) values.push(value);
  }
  return values;
}

function manifestHasEntrypoint(manifest: unknown, type: "command" | "panel", id: string): boolean {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return false;
  const entrypoints = (manifest as Record<string, unknown>).entrypoints;
  if (!Array.isArray(entrypoints)) return false;
  return entrypoints.some((entry) => entry != null
    && typeof entry === "object"
    && !Array.isArray(entry)
    && text((entry as Record<string, unknown>).type) === type
    && text((entry as Record<string, unknown>).id) === id);
}

export type AdobeTextTranscriptionWorkflowInput = {
  projectGuid: string;
  sequenceGuid: string;
};

export type AdobeTextTranscriptionWorkflowDispatch = {
  pluginId: typeof ADOBE_TEXT_PLUGIN_ID;
  pluginVersion: string;
  panelId: typeof ADOBE_TEXT_PANEL_ID;
  commandId: typeof ADOBE_TEXT_TRANSCRIPTION_COMMAND_ID;
  payload: { projectGuid: string; assetGuid: string };
  panelRequestAccepted: true;
  invocationAccepted: true;
  workflowState: "ipc_dispatch_accepted_unverified";
};

export async function openAdobeTextTranscriptionWorkflow(
  pluginManager: unknown,
  input: AdobeTextTranscriptionWorkflowInput,
): Promise<AdobeTextTranscriptionWorkflowDispatch> {
  if (!input.projectGuid || !input.sequenceGuid) {
    throw new PremiereFeatureRouteError("INVALID_TRANSCRIPTION_TARGET", "Adobe Text transcription requires non-empty project and sequence GUIDs");
  }
  if (!pluginManager || typeof pluginManager !== "object") {
    throw new PremiereFeatureRouteError("ADOBE_TEXT_PLUGIN_UNAVAILABLE", "UXP pluginManager is unavailable");
  }
  const plugin = pluginArray((pluginManager as { plugins?: unknown }).plugins)
    .find((candidate) => text(candidate.id) === ADOBE_TEXT_PLUGIN_ID);
  if (!plugin) {
    throw new PremiereFeatureRouteError("ADOBE_TEXT_PLUGIN_UNAVAILABLE", `Installed UXP plugin ${ADOBE_TEXT_PLUGIN_ID} was not found`);
  }
  if (plugin.enabled !== true) {
    throw new PremiereFeatureRouteError("ADOBE_TEXT_PLUGIN_DISABLED", `Installed UXP plugin ${ADOBE_TEXT_PLUGIN_ID} is not enabled`);
  }
  const pluginVersion = text(plugin.version);
  if (!(ADOBE_TEXT_PLUGIN_VERSIONS as readonly string[]).includes(pluginVersion)) {
    throw new PremiereFeatureRouteError("ADOBE_TEXT_CONTRACT_VERSION_MISMATCH", `Adobe Text ${pluginVersion || "unknown"} is outside the verified IPC contract (${ADOBE_TEXT_PLUGIN_VERSIONS.join(", ")})`);
  }
  if (!manifestHasEntrypoint(plugin.manifest, "panel", ADOBE_TEXT_PANEL_ID)) {
    throw new PremiereFeatureRouteError("ADOBE_TEXT_PANEL_UNAVAILABLE", `Adobe Text does not declare panel ${ADOBE_TEXT_PANEL_ID}`);
  }
  if (!manifestHasEntrypoint(plugin.manifest, "command", ADOBE_TEXT_TRANSCRIPTION_COMMAND_ID)) {
    throw new PremiereFeatureRouteError("ADOBE_TEXT_TRANSCRIPTION_UNAVAILABLE", `Adobe Text does not declare ${ADOBE_TEXT_TRANSCRIPTION_COMMAND_ID}`);
  }
  if (typeof plugin.showPanel !== "function" || typeof plugin.invokeCommand !== "function") {
    throw new PremiereFeatureRouteError("ADOBE_TEXT_IPC_UNAVAILABLE", "Adobe Text does not expose the required showPanel and invokeCommand IPC methods");
  }

  const payload = { projectGuid: input.projectGuid, assetGuid: input.sequenceGuid };
  let panelResult: unknown;
  try {
    panelResult = await Promise.resolve(plugin.showPanel(ADOBE_TEXT_PANEL_ID));
  } catch (error) {
    throw new PremiereFeatureRouteError("ADOBE_TEXT_PANEL_REQUEST_FAILED", `Adobe Text panel request failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (typeof panelResult === "string" && panelResult.trim()) {
    throw new PremiereFeatureRouteError("ADOBE_TEXT_PANEL_REQUEST_REJECTED", `Adobe Text panel request was rejected: ${panelResult}`);
  }
  try {
    const invocationResult = await Promise.resolve(plugin.invokeCommand(ADOBE_TEXT_TRANSCRIPTION_COMMAND_ID, JSON.stringify(payload)));
    if (typeof invocationResult === "string" && invocationResult.trim()) {
      throw new PremiereFeatureRouteError("ADOBE_TEXT_IPC_REJECTED", `Adobe Text transcription request was rejected: ${invocationResult}`);
    }
  } catch (error) {
    if (error instanceof PremiereFeatureRouteError) throw error;
    throw new PremiereFeatureRouteError("ADOBE_TEXT_IPC_FAILED", `Adobe Text transcription request failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  return {
    pluginId: ADOBE_TEXT_PLUGIN_ID,
    pluginVersion,
    panelId: ADOBE_TEXT_PANEL_ID,
    commandId: ADOBE_TEXT_TRANSCRIPTION_COMMAND_ID,
    payload,
    panelRequestAccepted: true,
    invocationAccepted: true,
    workflowState: "ipc_dispatch_accepted_unverified",
  };
}

export function collectAdobeUxpCommandRoutes(pluginManager: unknown): AdobeUxpCommandRoute[] {
  if (!pluginManager || typeof pluginManager !== "object") return [];
  const plugins = pluginArray((pluginManager as { plugins?: unknown }).plugins);
  const routes: AdobeUxpCommandRoute[] = [];
  for (const plugin of plugins) {
    const pluginId = text(plugin.id);
    if (!pluginId.startsWith("com.adobe.")) continue;
    for (const command of manifestCommands(plugin.manifest)) {
      routes.push({
        pluginId,
        pluginName: localizedLabel(plugin.name),
        pluginVersion: text(plugin.version),
        enabled: plugin.enabled !== false,
        ipcInvocationAvailable: typeof plugin.invokeCommand === "function",
        commandId: command.id,
        label: command.label,
      });
    }
  }
  return routes.sort((a, b) => `${a.pluginId}:${a.commandId}`.localeCompare(`${b.pluginId}:${b.commandId}`));
}

export function collectAdobeUxpPluginRoutes(pluginManager: unknown): AdobeUxpPluginRoute[] {
  if (!pluginManager || typeof pluginManager !== "object") return [];
  return pluginArray((pluginManager as { plugins?: unknown }).plugins)
    .filter((plugin) => text(plugin.id).startsWith("com.adobe."))
    .map((plugin) => ({
      pluginId: text(plugin.id),
      pluginName: localizedLabel(plugin.name),
      pluginVersion: text(plugin.version),
      enabled: plugin.enabled !== false,
      showPanelAvailable: typeof plugin.showPanel === "function",
      invokeCommandAvailable: typeof plugin.invokeCommand === "function",
      commandIds: manifestCommands(plugin.manifest).map((command) => command.id),
      panelIds: manifestPanelIds(plugin.manifest),
    }))
    .sort((a, b) => a.pluginId.localeCompare(b.pluginId));
}

export function inspectPremiereFeatureRoutes(input: {
  visualWorkSurface?: unknown;
  trackTargetingSurface?: unknown;
  pluginManager: unknown;
  premiereModule: unknown;
  premiereVersion: string;
  publicRoutes: PremierePublicRouteProbe[];
  hostNamespaceRoutes: PremiereHostNamespaceRouteProbe[];
}): Record<string, unknown> {
  const adobeUxpCommands = collectAdobeUxpCommandRoutes(input.pluginManager);
  const adobeUxpPlugins = collectAdobeUxpPluginRoutes(input.pluginManager);
  return {
    status: "pass",
    policy: "premiere_existing_feature_first",
    premiereVersion: input.premiereVersion,
    publicUxpRoutes: input.publicRoutes,
    premiereModuleSurface: collectPremiereModuleSurface(input.premiereModule),
    ...(input.visualWorkSurface ? {visualWorkSurface:input.visualWorkSurface}:{}),
    ...(input.trackTargetingSurface ? { trackTargetingSurface: input.trackTargetingSurface } : {}),
    adobeHostNamespaceRoutes: input.hostNamespaceRoutes,
    adobeUxpPlugins,
    adobeUxpCommands,
    nativeCommandCandidates: PREMIERE_NATIVE_COMMAND_CANDIDATES.map((candidate) => ({
      ...candidate,
      discovery: "Premiere 26.3 Windows host command registry and EVE menu definitions",
      publicUxpInvocable: false,
      status: "bridge_required",
      requiredBridge: "bounded_host_command_dispatcher",
    })),
    notes: [
      "Adobe UXP commands are live manifest discoveries; invocation still requires the exact plugin command contract and IPC permission.",
      "Adobe internal host namespaces are reported separately from public UXP. Availability is a reachability probe, not proof that an undocumented mutation contract is safe.",
      "Premiere module surfaces contain property metadata only. No discovered accessor, method, or command is invoked by this inspection.",
      "Native command candidates identify existing Premiere features, not replacement implementations. They are not reported as executable until a bounded dispatcher and before/after readback pass live acceptance.",
    ],
  };
}
