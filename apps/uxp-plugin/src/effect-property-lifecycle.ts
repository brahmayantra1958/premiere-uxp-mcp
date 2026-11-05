/** Native Properties owners can be replaced by a commit or selection rebuild.
 * Only primitive values cross that boundary; a completed write is never replayed.
 * An unresolved acquire/settle promise continues to own the caller's host lane. */
export type EffectPropertyOwner = { project: any; properties: any };
export type AcquireEffectProperties = () => Promise<EffectPropertyOwner>;

export async function readEffectProperty(acquire: AcquireEffectProperties, key: string): Promise<unknown> {
  const { properties } = await acquire();
  return properties.getValue(key);
}

export async function writeEffectProperty(
  acquire: AcquireEffectProperties,
  key: string,
  value: boolean,
  commit: (owner: EffectPropertyOwner, key: string, value: boolean) => boolean,
  settle: () => Promise<void>,
): Promise<{ accepted: boolean; actual: unknown }> {
  const owner = await acquire();
  const accepted = commit(owner, key, value);
  await settle();
  return { accepted, actual: await readEffectProperty(acquire, key) };
}
