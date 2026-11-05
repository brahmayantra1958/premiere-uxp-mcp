import {appendFile,mkdir,writeFile} from "node:fs/promises";
import path from "node:path";
import {setTimeout as delay} from "node:timers/promises";
import {describe,it,expect} from "vitest";
import {runtimePaths} from "../../apps/mcp-server/src/config.js";
import {waitForProgramFrame} from "../../apps/mcp-server/src/program-frame-artifact.js";

describe("asynchronous native PNG completion",()=>{
  it("waits for the actual final chunk rather than trusting export acceptance",async()=>{
    const directory=path.join(runtimePaths.output,"program-frame-tests");await mkdir(directory,{recursive:true});
    const file=path.join(directory,"partial.png"),png=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aO6sAAAAASUVORK5CYII=","base64");
    await writeFile(file,png.subarray(0,-12));let complete=false;
    const reading=waitForProgramFrame(file).then(value=>{complete=true;return value;});
    await delay(80);expect(complete).toBe(false);await appendFile(file,png.subarray(-12));
    await expect(reading).resolves.toMatchObject({status:"pass",width:1,height:1,sizeBytes:png.length});
  });
  it("rejects paths outside the output root and non-PNG targets",async()=>{
    await expect(waitForProgramFrame(path.join(runtimePaths.runtimeDirectory,"token.png"))).rejects.toThrow("PATH_NOT_ALLOWED");
    await expect(waitForProgramFrame(path.join(runtimePaths.output,"frame.jpg"))).rejects.toThrow("PATH_NOT_ALLOWED");
  });
});
