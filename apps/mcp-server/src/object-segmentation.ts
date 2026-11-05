import { normalizeLocalPath } from '@premiere-uxp/contracts/local-path';
import { stat } from "node:fs/promises";
import {
  objectMaskPromptSchema,
  type MaskSeedFrame,
  type ObjectMaskPrompt,
  type ObjectSegmentationRequest,
  type ObjectSegmentationResult,
} from "@premiere-uxp/contracts";
import { probePngEvidence } from "./mask-seed-frame.js";

function comparablePath(value: string): string {
  return normalizeLocalPath(value);
}

export function validateObjectMaskPrompt(seed: MaskSeedFrame, value: ObjectMaskPrompt): ObjectMaskPrompt {
  const prompt = objectMaskPromptSchema.parse(value);
  const { width, height } = seed.frame;
  for (const point of prompt.points) {
    if (point.x >= width || point.y >= height) throw new Error("OBJECT_MASK_PROMPT_POINT_OUTSIDE_IMAGE");
  }
  if (prompt.box) {
    const { left, top, right, bottom } = prompt.box;
    if (right <= left || bottom <= top) throw new Error("OBJECT_MASK_PROMPT_BOX_EMPTY");
    if (right > width || bottom > height) throw new Error("OBJECT_MASK_PROMPT_BOX_OUTSIDE_IMAGE");
  }
  return prompt;
}

export async function assertMaskSeedArtifact(seed: MaskSeedFrame, authorizedSeedPath: string): Promise<void> {
  if (comparablePath(seed.frame.outputPath) !== comparablePath(authorizedSeedPath)) {
    throw new Error("OBJECT_MASK_SEED_PATH_MISMATCH");
  }
  const evidence = await probePngEvidence(authorizedSeedPath);
  if (evidence.status !== "pass") throw new Error(`OBJECT_MASK_SEED_INVALID: ${evidence.errors.join("; ")}`);
  if (evidence.sha256 !== seed.frame.sha256 || evidence.sizeBytes !== seed.frame.sizeBytes) {
    throw new Error("OBJECT_MASK_SEED_CONTENT_DRIFT");
  }
  if (evidence.width !== seed.frame.width || evidence.height !== seed.frame.height) {
    throw new Error("OBJECT_MASK_SEED_DIMENSION_DRIFT");
  }
  if (seed.sequence.width !== seed.frame.width || seed.sequence.height !== seed.frame.height) {
    throw new Error("OBJECT_MASK_SEED_RECEIPT_DIMENSION_MISMATCH");
  }
}

export async function assertOutputPathAvailable(outputPath: string): Promise<void> {
  try {
    await stat(outputPath);
    throw new Error("OBJECT_MASK_OUTPUT_ALREADY_EXISTS");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
}

export async function verifyObjectSegmentationResult(
  request: ObjectSegmentationRequest,
  result: ObjectSegmentationResult,
  authorizedOutputPath: string,
): Promise<void> {
  if (result.requestId !== request.requestId || result.objectId !== request.objectId) {
    throw new Error("OBJECT_MASK_RESULT_IDENTITY_MISMATCH");
  }
  if (result.seedSha256 !== request.seed.frame.sha256) throw new Error("OBJECT_MASK_RESULT_SEED_MISMATCH");
  if (result.engine.model.name !== request.expectedModel) throw new Error("OBJECT_MASK_RESULT_MODEL_MISMATCH");
  if (comparablePath(result.mask.path) !== comparablePath(authorizedOutputPath)) {
    throw new Error("OBJECT_MASK_RESULT_PATH_MISMATCH");
  }
  if (result.mask.foregroundPixelCount > result.mask.width * result.mask.height) {
    throw new Error("OBJECT_MASK_RESULT_PIXEL_COUNT_INVALID");
  }
  const { left, top, right, bottom } = result.mask.bounds;
  if (right <= left || bottom <= top || right > result.mask.width || bottom > result.mask.height) {
    throw new Error("OBJECT_MASK_RESULT_BOUNDS_INVALID");
  }
  const evidence = await probePngEvidence(authorizedOutputPath);
  if (evidence.status !== "pass") throw new Error(`OBJECT_MASK_OUTPUT_INVALID: ${evidence.errors.join("; ")}`);
  if (evidence.sha256 !== result.mask.sha256) throw new Error("OBJECT_MASK_OUTPUT_HASH_MISMATCH");
  if (evidence.width !== request.seed.frame.width || evidence.height !== request.seed.frame.height) {
    throw new Error("OBJECT_MASK_OUTPUT_DIMENSION_MISMATCH");
  }
  if (result.mask.width !== evidence.width || result.mask.height !== evidence.height) {
    throw new Error("OBJECT_MASK_RESULT_DIMENSION_MISMATCH");
  }
}
