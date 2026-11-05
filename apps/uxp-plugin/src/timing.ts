/** Slowest supported delivery cadence is 23.976 fps; one frame is the maximum
 * acceptable host quantization error for timeline readback. */
export const MAX_FRAME_ALIGNMENT_ERROR_SECONDS = 1 / 23;

export function isFrameAligned(actualSeconds: number, requestedSeconds: number): boolean {
  return Number.isFinite(actualSeconds)
    && Number.isFinite(requestedSeconds)
    && Math.abs(actualSeconds - requestedSeconds) <= MAX_FRAME_ALIGNMENT_ERROR_SECONDS;
}
