/**
 * This ID is part of the UXP manifest/runtime contract.
 *
 * A deployment may use a distinct plugin bundle ID and display label to avoid
 * colliding with an older UDT registration, but its panel entrypoint ID must
 * continue to match this value.
 */
export const PANEL_ENTRYPOINT_ID = "premiereUxpMcpPanel";
export const PANEL_VERSION = "0.16.10";
export const PANEL_MODE = "agent";
