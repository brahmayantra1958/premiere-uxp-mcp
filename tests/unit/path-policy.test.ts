import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { MediaRoot } from "@premiere-uxp/contracts";
import { PathPolicy, PathPolicyError } from "../../apps/mcp-server/src/path-policy.js";
import { sourceMediaRoots } from "../../apps/mcp-server/src/installation-settings.js";

let sandbox: string;
let source: string;
let output: string;
let outside: string;

function root(rootPath: string, access: MediaRoot["access"], isNas = false): MediaRoot {
  return { path: rootPath, role: access === "readOnly" ? "source" : "output", access, isNas, allowedExtensions: [".mp4", ".mov"], pathBoundary: "enforced" };
}

beforeEach(async () => {
  // The repository may be on exFAT or another volume without Windows junction
  // support. Use the system temp volume so this security boundary is tested
  // instead of being skipped or failing for an unrelated checkout location.
  sandbox = await mkdtemp(path.join(tmpdir(), "premiere-path-policy-"));
  source = path.join(sandbox, "source");
  output = path.join(sandbox, "output");
  outside = path.join(sandbox, "outside");
  await Promise.all([source, output, outside].map((directory) => mkdir(directory, { recursive: true })));
  await writeFile(path.join(source, "source.mp4"), "read-only fixture", "utf8");
});

afterEach(async () => {
  await rm(sandbox, { recursive: true, force: true });
});

describe("PathPolicy", () => {
  it("keeps user-configured NAS roots explicitly read-only on both platforms", () => {
    const shares = ['\\\\example-nas\\media', '/Volumes/ExampleNAS/media'];
    const nasRoots = sourceMediaRoots(shares, ['.mp4']).filter(candidate => candidate.isNas);
    expect(nasRoots.map(candidate => candidate.path)).toEqual(shares);
    expect(nasRoots.every((candidate) => candidate.access === "readOnly" && candidate.pathBoundary === "enforced")).toBe(true);
  });

  it("allows reads but blocks writes below a read-only source root", () => {
    const policy = new PathPolicy([root(source, "readOnly"), root(output, "readWrite")]);
    expect(policy.authorizeRead(path.join(source, "source.mp4")).root.access).toBe("readOnly");
    expect(() => policy.authorizeWrite(path.join(source, "new.mp4"))).toThrowError(PathPolicyError);
    expect(() => policy.authorizeWrite(path.join(source, "new.mp4"))).toThrow(/Writes are forbidden/);
  });

  it("accepts Premiere's extended-length spelling of an allowed local file", () => {
    const policy = new PathPolicy([root(source, "readOnly")]);
    const ordinary = path.join(source, "source.mp4");
    const extended = `\\\\?\\${ordinary}`;
    expect(policy.authorizeRead(extended).path).toBe(policy.authorizeRead(ordinary).path);
  });

  it("blocks parent traversal and disallowed extensions", () => {
    const policy = new PathPolicy([root(output, "readWrite")]);
    expect(() => policy.authorizeWrite(path.join(output, "..", "outside", "escape.mp4"))).toThrow(/outside configured roots/);
    expect(() => policy.authorizeWrite(path.join(output, "payload.exe"))).toThrow(/Extension/);
  });

  it("refuses directory inputs", () => {
    const policy = new PathPolicy([root(source, "readOnly"), root(output, "readWrite")]);
    expect(() => policy.authorizeRead(source)).toThrow(/not a file/);
  });

  it("canonicalizes junctions and blocks an escape through the link", async () => {
    const link = path.join(output, "linked-outside");
    await symlink(outside, link, "junction");
    const policy = new PathPolicy([root(output, "readWrite")]);
    expect(() => policy.authorizeWrite(path.join(link, "escape.mp4"))).toThrow(/outside configured roots/);
  });

  it("blocks writes to any root marked as NAS", () => {
    const policy = new PathPolicy([root(source, "readWrite", true)]);
    expect(() => policy.authorizeWrite(path.join(source, "new.mp4"))).toThrow(/Writes are forbidden/);
  });
});
