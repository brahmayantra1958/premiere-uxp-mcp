type HostValueRecord = Record<string, unknown>;
export function decodeNativeColor(value:unknown):unknown {
  if(typeof value!=="number" || !Number.isInteger(value) || !Number.isFinite(value) || value<0)return value;
  const bits=BigInt(value);
  return {red:Number((bits>>32n)&65535n)/65280,green:Number((bits>>16n)&65535n)/65280,blue:Number(bits&65535n)/65280,alpha:Number((bits>>48n)&65535n)/65280};
}

/** Native Color parameters return Color directly from keyframe access in 26.5,
 * while numeric keyframes return {value:{value:...}}. Do not serialize proxy keys. */
export function snapshotKeyframeValue(key: any): unknown {
  if(["number","string","boolean"].includes(typeof key)) return key;
  return snapshotHostValue(key?.value !== undefined ? key.value : key && ["red","green","blue","alpha"].every(k=>typeof key[k]==="number") ? key :
    key && typeof key.x==="number" && typeof key.y==="number" ? key : undefined);
}

/**
 * Premiere 26.3 may return scalar and array component values inside a Variant-
 * shaped `{ value: ... }` wrapper. Normalize only that exact wrapper so PointF,
 * Color, and other structured values keep their semantic fields intact.
 */
export function unwrapHostValue(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as HostValueRecord;
  const keys = Object.keys(record);
  return keys.length === 1 && keys[0] === "value" ? unwrapHostValue(record.value) : value;
}

/** Snapshots own their complete value tree. Do not retain mutable host/Variant
 * objects in job baselines, receipts, or cross-transaction comparisons. */
export function snapshotHostValue(value: unknown): unknown {
  const copy = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(copy);
    if (v && typeof v === "object") {
      // Native Color/PointF expose accessors, not necessarily enumerable fields.
      const r=v as Record<string,unknown>;
      if (["red","green","blue","alpha"].every(k=>typeof r[k]==="number")) return Object.fromEntries(["red","green","blue","alpha"].map(k=>[k,r[k]]));
      if (typeof r.x==="number" && typeof r.y==="number") return {x:r.x,y:r.y};
      return Object.fromEntries(Object.entries(v).map(([key, item]) => [key, copy(item)]));
    }
    return v;
  };
  return copy(unwrapHostValue(value));
}
