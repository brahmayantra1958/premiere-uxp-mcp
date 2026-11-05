import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const repositoryRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: { alias: [{ find: /^@premiere-uxp\/contracts$/, replacement: path.resolve(repositoryRoot,"packages/contracts/src/index.ts") }, { find: /^@premiere-uxp\/contracts\/(.*)$/, replacement: path.resolve(repositoryRoot,"packages/contracts/src/$1.ts") }] },
  define: {
    "globalThis.__PREMIERE_MCP_DEPLOYMENT__": JSON.stringify({ scratchRoot: path.resolve(repositoryRoot, "artifacts", "scratch") }),
  },
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    // Isolated processes avoid the Windows Node worker-thread heap crash seen
    // during the full suite; keep parallelism bounded on installer machines.
    pool: "forks",
    maxWorkers: 4,
  },
});
