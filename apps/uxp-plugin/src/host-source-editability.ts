import { ppro } from './host-context.js';
import { sourceEditability, type SourceMapping } from './source-editability.js';

/** Media.duration is asynchronous on some hosts; source time remains file-relative. */
export async function readMediaDuration(clip: any): Promise<string> {
  const media = await clip.getMedia();
  const duration = await (typeof media.getDuration === 'function' ? media.getDuration() : media.duration);
  if (!/^\d+$/.test(String(duration?.ticks)) || BigInt(duration.ticks) <= 0n) throw Error('SOURCE_DURATION_UNAVAILABLE');
  return String(duration.ticks);
}

export async function readSourceEditability(rawProjectItem: any, item: any, mapping?: SourceMapping) {
  let path = String(rawProjectItem?.name ?? ''), duration: string | undefined;
  try {
    const clip = await ppro.ClipProjectItem.cast(rawProjectItem);
    path = String(await clip.getMediaFilePath()) || path;
    duration = await readMediaDuration(clip);
  } catch { /* Return explicit unknown handles; do not invent a source length. */ }
  return { trackItemId: item.id, ...sourceEditability(path, duration, item.inPoint?.ticks, item.outPoint?.ticks, mapping) };
}
