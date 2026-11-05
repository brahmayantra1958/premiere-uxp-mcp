/** This geometry plan is an editable Motion percentage for supported square-pixel, centered/unrotated/uncropped sources. It covers source bounds, not subjects or embedded black bars; never bake source crop to satisfy a numeric scale request. */
export type ScaleToFillPlan = {
  frameWidth: number;
  frameHeight: number;
  sourceWidth: number;
  sourceHeight: number;
  scalePercent: number;
  scaledWidth: number;
  scaledHeight: number;
  cropLeftRightPixels: number;
  cropTopBottomPixels: number;
};

function positiveFinite(label: string, value: number): number {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${label} must be a positive finite number`);
  return value;
}

/** Compute one uniform Motion scale that fills the frame without distortion or bars. */
export function computeScaleToFill(frameWidth: number, frameHeight: number, sourceWidth: number, sourceHeight: number): ScaleToFillPlan {
  const targetWidth = positiveFinite("frameWidth", frameWidth);
  const targetHeight = positiveFinite("frameHeight", frameHeight);
  const mediaWidth = positiveFinite("sourceWidth", sourceWidth);
  const mediaHeight = positiveFinite("sourceHeight", sourceHeight);
  const scale = Math.max(targetWidth / mediaWidth, targetHeight / mediaHeight);
  const scaledWidth = mediaWidth * scale;
  const scaledHeight = mediaHeight * scale;
  return {
    frameWidth: targetWidth,
    frameHeight: targetHeight,
    sourceWidth: mediaWidth,
    sourceHeight: mediaHeight,
    scalePercent: scale * 100,
    scaledWidth,
    scaledHeight,
    cropLeftRightPixels: Math.max(0, scaledWidth - targetWidth),
    cropTopBottomPixels: Math.max(0, scaledHeight - targetHeight),
  };
}
