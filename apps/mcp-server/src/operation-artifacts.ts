import {existsSync} from 'node:fs';
import {stat} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import type {OperationReceipt} from '@premiere-uxp/contracts';
import {probeDelivery} from './media.js';
import {probePngEvidence} from './mask-seed-frame.js';
import {declaredOutputPaths} from './mutation-plan.js';

/** Filesystem boundary: refuse overwrite before dispatch. Finalization may
 * promote only the explicit Node-verification placeholder; unknown host
 * execution remains UNVERIFIED even when an output file happens to exist. */
export function assertFreshArtifacts(args: Record<string, unknown>): void {
  const candidates = declaredOutputPaths(args);
  const existing = candidates.filter((candidate) => existsSync(candidate));
  if (existing.length) throw new Error(`OUTPUT_ALREADY_EXISTS: choose a new operationId and a unique outputPath (e.g. append that UUID before .mogrt); automatic naming is not implemented. Refusing to overwrite ${existing.join(", ")}`);
}

/** Probe only declared outputs, with a bounded finalization wait. File success
 * may satisfy the explicit Node-verification placeholder, never host uncertainty. */
export async function verifyCreatedFiles(receipt: OperationReceipt): Promise<OperationReceipt> {
  if (!receipt.changedFiles.length) return receipt;
  const filesystemVerificationCanPromote = receipt.status === "unverified"
    && receipt.errors.length > 0
    && receipt.errors.every((error) => error.includes("Node server must verify"));
  const reports = [];
  for (const file of receipt.changedFiles) {
    let report: Record<string, unknown> = { path: file, exists: false, status: "fail", errors: ["File finalization did not start"] };
    const deadline = Date.now() + 3_000;
    do {
      if (/\.png$/i.test(file)) report = await probePngEvidence(file);
      else if (/\.(mp4|mov|mxf|avi|mkv|wav|mp3|jpg|jpeg|tif|tiff)$/i.test(file)) report = await probeDelivery(file);
      else {
        try { const info = await stat(file); report = { path: file, exists: true, sizeBytes: info.size, status: "pass" }; }
        catch (error) { report = { path: file, exists: false, status: "fail", errors: [error instanceof Error ? error.message : String(error)] }; }
      }
      if (report.status === "pass" && report.exists) break;
      await delay(250);
    } while (Date.now() < deadline);
    reports.push(report);
  }
  const allPass = reports.every((report) => report.status === "pass" && report.exists);
  return {
    ...receipt,
    status: allPass && filesystemVerificationCanPromote ? "pass" : allPass ? receipt.status : receipt.status==='unverified'?'unverified':"fail",
    after: { host: receipt.after, files: reports },
    errors: allPass && filesystemVerificationCanPromote
      ? receipt.errors.filter((error) => !error.includes("Node server must verify"))
      : allPass ? receipt.errors : [...receipt.errors, "One or more declared output files did not pass filesystem verification"],
  };
}
