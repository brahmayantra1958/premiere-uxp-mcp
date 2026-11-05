import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { runInNewContext } from "node:vm";
import ts from "typescript";

/** Executes actual UXP adapters with only Adobe modules substituted. */
export function uxpModules(ppro: unknown, globals: Record<string, unknown> = {}) {
  const modules = new Map<string, any>();
  const contracts=JSON.parse(readFileSync("packages/contracts/package.json","utf8")).exports;
  function contract(name:string):any {
    const key=name==="@premiere-uxp/contracts"?".":"./"+name.slice("@premiere-uxp/contracts/".length);
    const exported=contracts[key]?.import;
    if(typeof exported!=="string"||!/^\.\/dist\/[a-z-]+\.js$/.test(exported))throw Error(`Undeclared contract module: ${name}`);
    return load(resolve("packages/contracts",exported.replace("./dist/","src/").replace(/\.js$/,".ts")));
  }
  function load(file: string): any {
    const path = resolve(file);
    if (modules.has(path)) return modules.get(path);
    const exports = {};
    modules.set(path, exports);
    const code = ts.transpileModule(readFileSync(path, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    runInNewContext(code, { exports, setTimeout, clearTimeout, URL, performance,
      __PREMIERE_MCP_LOCAL_SCRATCH_ROOT__: "C:\\scratch",
      __PREMIERE_MCP_DESIGNATED_EDIT_TARGET__: null,
      ...globals,
      __PREMIERE_MCP_DEPLOYMENT__: { scratchRoot: globals.__PREMIERE_MCP_LOCAL_SCRATCH_ROOT__ ?? "C:\\scratch", trackTargeting: globals.__PREMIERE_MCP_TRACK_TARGETING__ ?? null, trackLock: globals.__PREMIERE_MCP_TRACK_LOCK__ ?? null },
      require: (name: string) => name === "premierepro" ? ppro : name === "uxp" ? { host: { version: "26.5.0" } }
        : name.startsWith("@premiere-uxp/contracts/") ? contract(name)
        : load(resolve(dirname(path), name.replace(/\.js$/, ".ts"))),
    }, { filename: path });
    return exports;
  }
  return load;
}
