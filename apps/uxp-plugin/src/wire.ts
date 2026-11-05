import type { WorkTarget } from "./work-target.js";
import type { BridgeReadPurpose } from '@premiere-uxp/contracts/read-purpose';

export type BridgeRequest = {
  version: 1;
  id: string;
  command: string;
  args: Record<string, unknown>;
  timeoutMs: number;
  readPurpose?: BridgeReadPurpose;
};

export type BridgeResponse = {
  version: 1;
  id: string;
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string; details?: unknown };
  durationMs: number;
};

type BridgeAuthBase = {
  version: 1;
  type: "authenticate";
  projectId: string;
  client: "premiere-uxp-panel";
};

export type BridgeAuthRequest =
  | (BridgeAuthBase & { method: "pairing_token"; token: string })
  | (BridgeAuthBase & { method: "project_credential"; credential: string })
  | (BridgeAuthBase & { method: "local_approval" });

export type BridgeAuthentication =
  | { method: "pairing_token"; projectId: string; token: string }
  | { method: "project_credential"; projectId: string; credential: string }
  | { method: "local_approval"; projectId: string };

export type BridgeAuthResponse = {
  effectChainProofProtocol?: 1;
  effectNativeSampleProtocol?: 1;
  effectNativeTimeProtocol?: 1|2;
  nativePanelProtocol?: 1;
  programFrameProtocol?: 1;
  nativeVisualProtocol?: 1;
  projectSelectionProtocol?: 1;
  effectDisclosureProtocol?: 1;
  maskTrackingProtocol?: 1;
  version: 1;
  type: "authenticated";
  ok: true;
  projectId: string;
  credential?: string;
  credentialIssued: boolean;
};

export type HostResult = {
  workTarget?: WorkTarget;
  /** Host-resolved placement readback, never supplied by an agent. */
  placedItemIds?: string[];
  status: "pass" | "partial" | "fail" | "unsupported" | "unverified";
  before?: unknown;
  hostResult?: unknown;
  after?: unknown;
  changedFiles?: string[];
  errors?: string[];
  recovery?: string;
};
