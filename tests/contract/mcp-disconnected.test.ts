import { createServer } from "node:net";
import path from "node:path";
import { readFileSync } from "node:fs";
import { cp, mkdir, readFile } from 'node:fs/promises';
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "vitest";
import { freshTestDirectory } from '../helpers/workspace.js';

/** config resolves artifacts relative to the executable, not cwd. Copy the
 * executable and its declared guidance into a fixture so embedded startup can
 * never publish tokens/audit/receipts in the running production runtime. */
async function isolatedServer(profile: string) {
  const root = await freshTestDirectory(`mcp-disconnected-${profile}`);
  const sourceEntry = path.resolve(process.env.PREMIERE_TEST_SERVER_ENTRY ?? 'apps/mcp-server/dist/index.js');
  const dist = path.join(root, 'apps/mcp-server/dist');
  await cp(path.dirname(sourceEntry), dist, { recursive: true });
  const bundle = JSON.parse(await readFile('skills/bundle.json', 'utf8')) as { resources: { path: string }[] };
  const files = new Set(['package.json', 'apps/mcp-server/package.json', 'skills/bundle.json', 'docs/agent-instructions.md', ...bundle.resources.map(resource => resource.path)]);
  for (const file of files) {
    const destination = path.resolve(root, file);
    if (!destination.startsWith(root + path.sep)) throw Error('Test resource escaped fixture');
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(path.resolve(file), destination);
  }
  return { root, entry: path.join(dist, path.basename(sourceEntry)) };
}

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not allocate a local test port");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

describe("MCP inspect profile", () => {
  it("exposes only the default inspect tools and reports a disconnected Premiere host honestly", async () => {
    const port = await freePort();
    const fixture = await isolatedServer('inspect');
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [fixture.entry],
      cwd: fixture.root,
      env: { ...getDefaultEnvironment(), PREMIERE_UXP_PORT: String(port), PREMIERE_MCP_PROFILE: "inspect", PREMIERE_UXP_RUNTIME_MODE: "embedded" },
      stderr: "pipe",
    });
    const client = new Client({ name: "contract-test", version: "0.1.0" });
    try {
      await client.connect(transport);
      expect((await readFile(path.join(fixture.root, 'artifacts/runtime/bridge-token.txt'), 'utf8')).trim()).toMatch(/^[a-f0-9]{64}$/);
      expect(client.getInstructions()).toBe(readFileSync('docs/agent-instructions.md', 'utf8'));
      const guidance = await client.readResource({uri:'premiere://guide/contract'});
      expect(guidance.contents[0].text).toContain('](premiere://guide/operate)');
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name).sort()).toEqual([
        "apply_srt_to_caption_track", "capture_mask_seed_frame", "capture_program_frame", "collect_object_mask_prompt", "edit_caption_items", "export_review_frames", "get_agent_context", "get_capabilities", "get_effect_command_sequence_status", "get_effect_values", "get_mutation_recovery", "get_track_command_sequence_status", "inspect_caption_helper", "inspect_caption_track", "inspect_clip_speech_text", "inspect_delivery_state", "inspect_effect_catalog", "inspect_effects",
        "inspect_markers", "inspect_media", "inspect_native_visual_commands", "inspect_object_mask_state", "inspect_premiere_feature_routes", "inspect_project", "inspect_proxies", "inspect_ripple_capabilities", "inspect_segmentation_engine", "inspect_selected_caption_font", "inspect_sequence", "inspect_timeline_selection", "premiere_ping", "prepare_clip_edit", "prepare_timeline_ripple", "prepare_track_wave", "query_media", "query_timeline", "read_track_locks", "segment_object_frame", "wait_runtime_events",
      ]);
      const response = await client.callTool({ name: "premiere_ping", arguments: {} });
      const textBlock = response.content.find((block) => block.type === "text");
      if (!textBlock || textBlock.type !== "text") throw new Error("premiere_ping did not return text content");
      const payload = JSON.parse(textBlock.text) as Record<string, unknown>;
      expect(payload).toMatchObject({ status: "partial", premiere: null });
      expect(payload.bridge).toMatchObject({tokenPath: path.join(fixture.root, 'artifacts/runtime/bridge-token.txt')});
      expect(["premiere_not_running", "uxp_panel_not_connected", "host_state_unknown"]).toContain(payload.connectionState);
      expect(JSON.stringify(payload)).not.toContain("pairingToken");
      for (const name of ["get_track_command_sequence_status","get_effect_command_sequence_status","wait_runtime_events"]) {
        expect(listed.tools.find(tool => tool.name === name)?.annotations?.readOnlyHint).toBe(true);
      }
      for (const name of ["capture_program_frame", "get_agent_context", "query_timeline", "prepare_clip_edit"]) {
        expect(listed.tools.find(tool => tool.name === name)?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
      }
      const context = await client.callTool({ name: "get_agent_context", arguments: {} });
      expect(context.isError).toBe(true);
      const invalidQuery = await client.callTool({ name: "query_timeline", arguments: { expectedProjectId: 'project', expectedSequenceId: 'sequence', includeEffects: true, limit: 100 } });
      expect(invalidQuery.isError).toBe(true);
      expect(JSON.stringify(invalidQuery.content)).toContain("at most 20");
      const engineResponse = await client.callTool({ name: "inspect_segmentation_engine", arguments: {} });
      const engineText = engineResponse.content.find((block) => block.type === "text");
      if (!engineText || engineText.type !== "text") throw new Error("inspect_segmentation_engine did not return text content");
      expect(JSON.parse(engineText.text)).toMatchObject({ status: "offline", service: "premiere-object-segmentation", protocolVersion: "1" });
    } finally {
      await client.close();
    }
  });

  it("exposes the bounded edit and delivery workflow without an arbitrary execution tool", async () => {
    const port = await freePort();
    const fixture = await isolatedServer('all-profiles');
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [fixture.entry],
      cwd: fixture.root,
      env: { ...getDefaultEnvironment(), PREMIERE_UXP_PORT: String(port), PREMIERE_MCP_PROFILE: "inspect,edit,delivery", PREMIERE_UXP_RUNTIME_MODE: "embedded" },
      stderr: "pipe",
    });
    const client = new Client({ name: "full-profile-contract-test", version: "0.1.0" });
    try {
      await client.connect(transport);
      expect((await readFile(path.join(fixture.root, 'artifacts/runtime/bridge-token.txt'), 'utf8')).trim()).toMatch(/^[a-f0-9]{64}$/);
      const names = (await client.listTools()).tools.map((tool) => tool.name);
      expect(names).toHaveLength(115);
      expect(names).toEqual(expect.arrayContaining(['read_track_locks','set_track_locks']));
      expect(names).toEqual(expect.arrayContaining(['get_mutation_recovery','reconcile_mutation']));
      expect(names).toEqual(expect.arrayContaining(['get_speed_graph_disclosure','set_speed_graph_disclosure']));
      expect(names).toEqual(expect.arrayContaining(['get_lumetri_hue_saturation_curve','set_lumetri_hue_saturation_curve']));
      expect(names).toEqual(expect.arrayContaining(['get_lumetri_rgb_curve','set_lumetri_rgb_curve']));
      const curve=(await client.listTools()).tools.find(tool=>tool.name==='set_lumetri_hue_saturation_curve');
      expect(curve?.inputSchema.required).toEqual(expect.arrayContaining(['expectedProjectId','expectedSequenceId','componentIndex','paramIndex','expectedDisplayName','expectedCurveSha256','points']));
      expect(curve?.inputSchema.properties).not.toHaveProperty('script');expect(curve?.inputSchema.properties).not.toHaveProperty('projectPath');
      expect(names).toEqual(expect.arrayContaining(["get_effect_values","set_effect_disclosure","inspect_native_visual_commands","inspect_native_masks","track_object_mask_frames","activate_native_tool"]));
      expect(names).toEqual(expect.arrayContaining(["prepare_track_wave", "submit_track_command_sequence", "get_track_command_sequence_status", "cancel_track_command_sequence"]));
      const sequenceTool = (await client.listTools()).tools.find(tool => tool.name === "submit_track_command_sequence");
      expect(sequenceTool?.inputSchema.required).toEqual(expect.arrayContaining(["protocolVersion", "operationId", "expectedProjectId", "expectedSequenceId", "expectedSequenceName", "clips", "steps"]));
      expect(sequenceTool?.inputSchema.properties?.steps).toMatchObject({ maxItems: 256 });
      expect(names).toContain("move_clip_to_track");
      const focus = (await client.listTools()).tools.find(tool => tool.name === "focus_timeline");
      expect(focus?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
      expect(focus?.inputSchema.required).toEqual(expect.arrayContaining(["expectedProjectId", "sequenceId"]));
      expect(names).toEqual(expect.arrayContaining(["capture_mask_seed_frame", "collect_object_mask_prompt", "inspect_object_mask_state", "inspect_premiere_feature_routes", "inspect_timeline_selection", "inspect_segmentation_engine", "segment_object_frame", "create_working_copy", "activate_sequence", "open_native_speech_to_text_workflow", "inspect_clip_speech_text", "import_clip_speech_text", "inspect_sequence_structure", "edit_existing_sequence_structure", "duplicate_working_sequence", "create_proxy", "attach_proxy", "create_subclip", "create_editable_text_mogrt", "create_editable_rectangle_mogrt", "insert_mogrt_caption", "insert_editable_graphic", "import_caption_track", "set_timeline_selection", "split_clips", "trim_clip_exact", "set_effect_keyframes", "edit_effect_keyframes", "detect_scene_cuts", "scale_clip_to_fill", "place_voiceover", "export_sequence", "verify_delivery", "close_working_project", "open_working_project"]));
      const graphicTool = (await client.listTools()).tools.find((tool) => tool.name === "insert_editable_graphic");
      expect(graphicTool?.inputSchema).toMatchObject({
        required: expect.arrayContaining(["expectedProjectId", "expectedSequenceId", "expectedSequenceName", "expectedVideoTrackCount", "expectedAudioTrackCount", "expectedCaptionTrackCount", "expectedTimelineItemCount", "videoTrackIndex", "expectedVideoTrackId", "expectedVideoTrackName", "expectedVideoTrackItemCount", "audioTrackIndex", "timeSeconds", "mogrtPath", "expectedMogrtSha256"]),
        properties: { expectedVideoTrackItemCount: { const: 0 } },
      });
      const declarativeSequenceTools = ["submit_track_command_sequence", "get_track_command_sequence_status", "cancel_track_command_sequence", "submit_effect_command_sequence", "get_effect_command_sequence_status", "cancel_effect_command_sequence", "inspect_native_visual_commands"];
      expect(names.filter(name => !declarativeSequenceTools.includes(name)).some((name) => /shell|script|extend|qe|registry|command/i.test(name))).toBe(false);
      const stepSchema = (sequenceTool?.inputSchema.properties?.steps as { items: { properties: Record<string, unknown>; additionalProperties: boolean } }).items;
      expect(Object.keys(stepSchema.properties).sort()).toEqual(["clipRef", "destinationTrackIndex"]);
      expect(stepSchema.additionalProperties).toBe(false);
      const splitTool = (await client.listTools()).tools.find((tool) => tool.name === "split_clips");
      expect(splitTool?.inputSchema).toMatchObject({
        required: expect.arrayContaining(["expectedProjectId", "expectedSequenceId", "split"]),
        properties: {
          split: {
            required: expect.arrayContaining(["trackItemId", "expectedProjectItemId", "expectedMediaType", "expectedTrackIndex", "expectedStartSeconds", "expectedEndSeconds", "atSeconds"]),
          },
        },
      });
      const selectionTool = (await client.listTools()).tools.find((tool) => tool.name === "set_timeline_selection");
      expect(selectionTool?.inputSchema).toMatchObject({
        required: expect.arrayContaining(["expectedProjectId", "expectedSequenceId", "expectedSequenceName", "trackItemIds"]),
      });
      const removalTool = (await client.listTools()).tools.find((tool) => tool.name === "remove_clips");
      expect(removalTool?.inputSchema).toMatchObject({
        required: expect.arrayContaining(["expectedProjectId", "expectedSequenceId", "expectedSequenceName", "targets"]),
        properties: {
          ripple: { const: false, default: false, type: "boolean" },
        },
      });
      const moveTool = (await client.listTools()).tools.find((tool) => tool.name === "move_clips");
      expect(moveTool?.inputSchema).toMatchObject({
        required: expect.arrayContaining(["expectedProjectId", "expectedSequenceId", "expectedSequenceName", "move"]),
      });
      const exactTrimTool = (await client.listTools()).tools.find((tool) => tool.name === "trim_clip_exact");
      expect(exactTrimTool?.inputSchema).toMatchObject({
        required: expect.arrayContaining(["expectedProjectId", "expectedSequenceId", "expectedSequenceName", "trim"]),
      });
      const keyframeTool = (await client.listTools()).tools.find((tool) => tool.name === "set_effect_keyframes");
      expect(keyframeTool?.inputSchema).toMatchObject({
        required: expect.arrayContaining(["expectedProjectId", "expectedSequenceId", "expectedSequenceName", "trackItemId", "expectedProjectItemId", "expectedMediaType", "expectedTrackIndex", "expectedStartSeconds", "expectedEndSeconds", "componentIndex", "keyframes"]),
      });
      const staticValueTool = (await client.listTools()).tools.find((tool) => tool.name === "set_effect_values");
      expect(staticValueTool?.inputSchema).toMatchObject({
        required: expect.arrayContaining(["expectedProjectId", "expectedSequenceId", "expectedSequenceName", "trackItemId", "expectedProjectItemId", "expectedMediaType", "expectedTrackIndex", "expectedStartSeconds", "expectedEndSeconds", "componentIndex"]),
        properties: expect.objectContaining({values:expect.any(Object),parameters:expect.any(Object)}),
      });
      const keyframeEditTool = (await client.listTools()).tools.find((tool) => tool.name === "edit_effect_keyframes");
      expect(keyframeEditTool?.inputSchema).toMatchObject({
        required: expect.arrayContaining(["expectedProjectId", "expectedSequenceId", "expectedSequenceName", "trackItemId", "expectedProjectItemId", "expectedMediaType", "expectedTrackIndex", "expectedStartSeconds", "expectedEndSeconds", "componentIndex", "operations"]),
      });
    } finally {
      await client.close();
    }
  });
});
