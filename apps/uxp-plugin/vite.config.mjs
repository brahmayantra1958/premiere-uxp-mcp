import { resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import { writeLocalDeployment } from "../../installer/lib.mjs";

const directory = fileURLToPath(new URL(".", import.meta.url));


export default defineConfig({
  // Vite clears dist and copies the portable public placeholder on every build.
  // Regenerate only the local output sidecar afterwards, including watch builds;
  // otherwise Reload silently loses the scratch boundary and installed helpers.
  plugins: [{ name: "local-deployment", closeBundle() { writeLocalDeployment(resolve(directory, "../..")); } }],
  publicDir: "public",
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    minify: false,
    sourcemap: true,
    target: "esnext",
    rolldownOptions: {
      input: resolve(directory, "index.ts"),
      external: ["premierepro", "uxp"],
      output: {
        format: "cjs",
        preserveModules: true,
        preserveModulesRoot: directory,
        entryFileNames: "[name].js"
      }
    }
  }
});
