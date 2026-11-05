/** A full inspected chain, in native component-index order. Display names are
 * localized and never identify the generated-graphic boundary. */
export interface EffectInsertionComponent {
  componentIndex: number;
  matchName: string;
}

export interface EffectInsertionPlan {
  index: number;
  mode: "append" | "insert";
  policy: "append" | "before_graphic_group" | "explicit";
  graphicGroupIndex?: number;
}

export class EffectInsertionError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "EffectInsertionError";
  }
}

/** Generated graphics expose their group/text children in the same native
 * chain as clip-level effects. Appending after that boundary can read back
 * correctly without affecting the graphic render (Premiere 26.5 live probe).
 * Auto placement is immediately before the unique Graphic Group, so repeated
 * additions retain their requested order. Explicit indices are never moved.
 * This is a placement contract, not proof of the resulting rendered image. */
export function planEffectInsertion(
  chain: readonly EffectInsertionComponent[],
  mediaType: "video" | "audio",
  explicitIndex?: number,
): EffectInsertionPlan {
  if (chain.some((component, index) => component.componentIndex !== index)) {
    throw new EffectInsertionError("EFFECT_CHAIN_INDEX_AMBIGUOUS", "Insertion requires the complete current effect chain in native index order; inspect the chain again before editing");
  }
  if (explicitIndex !== undefined && (!Number.isInteger(explicitIndex) || explicitIndex < 0 || explicitIndex > chain.length)) {
    throw new EffectInsertionError("INVALID_COMPONENT_INDEX", "Effect insertion index is outside the current chain");
  }
  const groups = mediaType === "video"
    ? chain.filter(component => component.matchName === "AE.ADBE Graphic Group")
    : [];
  const boundary = groups[0]?.componentIndex;
  if (explicitIndex !== undefined) {
    if (boundary !== undefined && explicitIndex > boundary) {
      throw new EffectInsertionError("GRAPHIC_EFFECT_INSERTION_AFTER_GROUP", `Video effect index ${explicitIndex} is after the generated Graphic Group boundary ${boundary}, where a clip-level effect may not render. Inspect the current chain and explicitly choose an index at or before ${boundary}; no effect was inserted`);
    }
    return { index: explicitIndex, mode: "insert", policy: "explicit", ...(boundary === undefined ? {} : { graphicGroupIndex: boundary }) };
  }
  if (groups.length > 1) {
    throw new EffectInsertionError("GRAPHIC_EFFECT_INSERTION_AMBIGUOUS", `Multiple Graphic Groups prevent automatic clip-level placement. Inspect the full chain and supply an explicit insertionIndex at or before the first group (${boundary}); no effect was inserted`);
  }
  if (boundary !== undefined) return { index: boundary, mode: "insert", policy: "before_graphic_group", graphicGroupIndex: boundary };
  return { index: chain.length, mode: "append", policy: "append" };
}
