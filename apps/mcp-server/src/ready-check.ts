import path from "node:path";
import type { ProjectSnapshot } from "@premiere-uxp/contracts";
import { isLocalProjectPath, normalizeLocalPath } from '@premiere-uxp/contracts/local-path';

type ReadyExpectations = {
  scratchRoot: string;
  activeLocalTarget?:boolean;
  expectedProjectPath?: string;
  expectedSequenceName?: string;
  designatedTarget?:{projectPath:string;projectId:string;sequenceId:string;sequenceName:string}|undefined;
};

function withoutWindowsDevicePrefix(value: string): string {
  if (value.startsWith("\\\\?\\UNC\\")) return "\\\\" + value.slice("\\\\?\\UNC\\".length);
  if (value.startsWith("\\\\?\\")) return value.slice("\\\\?\\".length);
  return value;
}

function comparable(value: string): string {
  return normalizeLocalPath(value);
}

function isInside(root: string, candidate: string): boolean {
  const flavor = root.startsWith('/') ? path.posix : path.win32;
  const relative = flavor.relative(
    withoutWindowsDevicePrefix(root),
    withoutWindowsDevicePrefix(candidate),
  );
  return relative !== "" && !relative.startsWith("..") && !flavor.isAbsolute(relative);
}

export function verifyReadySnapshot(snapshot: Pick<ProjectSnapshot,'projectId'|'projectPath'>&{activeSequence?:Pick<NonNullable<ProjectSnapshot['activeSequence']>,'id'|'name'>|null}, expectations: ReadyExpectations): string[] {
  const errors: string[] = [];
  const designated=expectations.designatedTarget;
  if(expectations.activeLocalTarget){
    if(!isLocalProjectPath(snapshot.projectPath)||!snapshot.activeSequence?.id||!snapshot.activeSequence.name)errors.push('A saved local project and active sequence are required');
  }else if(designated){
    const local=isLocalProjectPath(designated.projectPath);
    if(!local||!designated.projectId||!designated.sequenceId||!designated.sequenceName||comparable(snapshot.projectPath)!==comparable(designated.projectPath)||snapshot.projectId!==designated.projectId||snapshot.activeSequence?.id!==designated.sequenceId||snapshot.activeSequence?.name!==designated.sequenceName)errors.push('Active target differs from the exact designated local project/sequence');
  }else if (!snapshot.projectPath || !isInside(expectations.scratchRoot, snapshot.projectPath)) {
    errors.push(`Active project is not a local scratch working copy: ${snapshot.projectPath || "unsaved"}`);
  }
  if (expectations.expectedProjectPath && comparable(snapshot.projectPath) !== comparable(expectations.expectedProjectPath)) {
    errors.push(`Active project mismatch: expected ${expectations.expectedProjectPath}, received ${snapshot.projectPath}`);
  }
  const sequenceName = snapshot.activeSequence?.name ?? "";
  if (!expectations.activeLocalTarget&&!designated&&!sequenceName.startsWith("WORKING__")) errors.push(`Active sequence is not a WORKING__ sequence: ${sequenceName || "none"}`);
  if (expectations.expectedSequenceName && sequenceName !== expectations.expectedSequenceName) {
    errors.push(`Active sequence mismatch: expected ${expectations.expectedSequenceName}, received ${sequenceName || "none"}`);
  }
  return errors;
}
