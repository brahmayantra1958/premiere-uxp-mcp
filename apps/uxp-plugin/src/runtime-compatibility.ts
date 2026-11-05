export const REQUIRED_PREMIERE_VERSION = "26.3.0";

export type RuntimeCompatibility = {
  requiredPremiereVersion: string;
  status: "compatible" | "incompatible" | "unknown";
  reason?: string;
};

function numericVersion(value: string): [number, number, number] | undefined {
  const match = value.trim().match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2] ?? 0), Number(match[3] ?? 0)];
}

export function compareAdobeVersions(left: string, right: string): -1 | 0 | 1 | undefined {
  const a = numericVersion(left);
  const b = numericVersion(right);
  if (!a || !b) return undefined;
  for (const index of [0, 1, 2] as const) {
    if (a[index] < b[index]) return -1;
    if (a[index] > b[index]) return 1;
  }
  return 0;
}

export function assessRuntimeCompatibility(
  premiereVersion: string,
  requiredPremiereVersion = REQUIRED_PREMIERE_VERSION,
): RuntimeCompatibility {
  const comparison = compareAdobeVersions(premiereVersion, requiredPremiereVersion);
  if (comparison === undefined) {
    return {
      requiredPremiereVersion,
      status: "unknown",
      reason: `Premiere runtime version could not be parsed: ${premiereVersion || "empty"}`,
    };
  }
  if (comparison < 0) {
    return {
      requiredPremiereVersion,
      status: "incompatible",
      reason: `Premiere ${premiereVersion} is older than required ${requiredPremiereVersion}`,
    };
  }
  return { requiredPremiereVersion, status: "compatible" };
}
