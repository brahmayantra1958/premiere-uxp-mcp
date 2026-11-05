import {existsSync} from "node:fs";
import path from "node:path";
import {repositoryRoot} from "./config.js";

/** Environment overrides are executable paths, never shell commands. A local
 * verified install survives runtime restarts without changing machine PATH. */
export function mediaExecutable(tool:"ffmpeg"|"ffprobe"):string {
  const explicit=process.env[tool==="ffmpeg"?"PREMIERE_FFMPEG_PATH":"PREMIERE_FFPROBE_PATH"];
  if(explicit)return explicit;
  const local=path.join(repositoryRoot,"artifacts","tools","ffmpeg",tool+(process.platform==="win32"?".exe":""));
  return existsSync(local)?local:tool;
}
