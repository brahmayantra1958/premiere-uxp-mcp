import { describe, expect, it } from "vitest";
import { uxpModules } from "../helpers/uxp-modules.js";

function fixture() {
  let epoch = 0, pending = 0, peak = 0, selectedReads = 0, startReads = 0;
  const read = async <T>(generation: number, value: T): Promise<T> => {
    pending++; peak = Math.max(peak, pending);
    await Promise.resolve(); pending--;
    if (generation !== epoch) throw Error("Native collection advanced with reads pending");
    return value;
  };
  const time = (n: number) => ({ ticks: String(n * 100), seconds: n });
  const track = (t: number) => ({ getTrackItems: () => {
    if (pending) throw Error("Outstanding reads at collection boundary");
    const generation = ++epoch;
    return Array.from({ length: 19 }, (_, i) => ({
      getProjectItem: () => read(generation, { getId: () => `source-${i}`, name: `media ${i}` }),
      // Two same-start candidates must still be disambiguated by full source identity.
      getStartTime: () => { startReads++; return read(generation, time(Math.floor(i / 2))); },
      getEndTime: () => read(generation, time(Math.floor(i / 2) + 1)),
      getName: () => read(generation, `clip ${t}/${i}`),
      getInPoint: () => read(generation, time(i)), getOutPoint: () => read(generation, time(i + 1)),
      isDisabled: () => read(generation, false), getSpeed: () => read(generation, 1),
      isSpeedReversed: () => read(generation, false), isAdjustmentLayer: () => read(generation, false),
      getIsSelected: () => { selectedReads++; return read(generation, i === 17); },
    }));
  } });
  const sequence = { getVideoTrackCount: () => 2, getAudioTrackCount: () => 0, getVideoTrack: track };
  const host = uxpModules({ Constants: { TrackItemType: { CLIP: 1 } } })("apps/uxp-plugin/src/host-items.ts");
  return { sequence, host, stats: () => ({ pending, peak, selectedReads, startReads }) };
}

describe("bounded timeline read parity and native lifetime", () => {
  it('reuses only a numeric slot while rereading live metadata from a new collection', async()=>{
    const f=fixture(),hint:any={},id='video:1:800:source-17';
    const before=await f.host.findTrackItemEntry(f.sequence,id,hint),reads=f.stats().startReads;
    const get=f.sequence.getVideoTrack;
    f.sequence.getVideoTrack=t=>({getTrackItems:()=>get(t).getTrackItems().map((item:any)=>({...item,getSpeed:async()=>2}))});
    const after=await f.host.findTrackItemEntry(f.sequence,id,hint);
    expect(f.stats().startReads-reads).toBe(1);
    expect(after.raw).not.toBe(before.raw);expect(after.snapshot.speed).toBe(2);expect(before.snapshot.speed).toBe(1);
    expect(f.stats().pending).toBe(0);expect(hint).toEqual({id,index:17});
  });
  it('rejects same-time wrong-source hints and recovers after collection reordering',async()=>{
    const f=fixture(),id='video:1:800:source-17',hint:any={id,index:16};
    expect((await f.host.findTrackItemEntry(f.sequence,id,hint)).snapshot.id).toBe(id);
    const get=f.sequence.getVideoTrack;
    f.sequence.getVideoTrack=t=>({getTrackItems:()=>get(t).getTrackItems().reverse()});
    expect((await f.host.findTrackItemEntry(f.sequence,id,hint)).snapshot.id).toBe(id);expect(hint.index).toBe(1);
    f.sequence.getVideoTrack=t=>({getTrackItems:()=>get(t).getTrackItems().filter((_:any,i:number)=>i!==17)});
    await expect(f.host.findTrackItemEntry(f.sequence,id,hint)).rejects.toThrow('Track item not found');
    expect(f.stats().pending).toBe(0);
  });
  it("reacquires transient null clips without omitting targets or replaying consumers", async () => {
    const f=fixture(),getTrack=f.sequence.getVideoTrack;let reads=0,consumed=0;
    f.sequence.getVideoTrack=t=>({getTrackItems:()=>++reads===1?[null]:getTrack(t).getTrackItems()}) as any;
    const items=await f.host.mapTrackItemReads(f.sequence,async (entry:any)=>{consumed++;return entry.snapshot;});
    expect(items).toHaveLength(38);expect(consumed).toBe(38);expect(reads).toBe(3);
    reads=0;consumed=0;f.sequence.getVideoTrack=()=>({getTrackItems:()=>{reads++;return [null];}}) as any;
    await expect(f.host.mapTrackItemReads(f.sequence,async()=>{consumed++;})).rejects.toThrow("incomplete clip collection");
    expect(reads).toBe(2);expect(consumed).toBe(0);
  });
  it("matches serial snapshots in collection order and drains before returning", async () => {
    const f = fixture();
    const expected = (await f.host.trackItems(f.sequence)).map((entry: any) => entry.snapshot);
    const actual = await f.host.mapTrackItemReads(f.sequence, async (entry: any) => entry.snapshot);
    expect(actual).toEqual(expected);
    expect(f.stats().pending).toBe(0); expect(f.stats().peak).toBe(1);
  });
  it("checks every selection flag and returns only exact selected snapshots", async () => {
    const f = fixture(); const result = await f.host.timelineSelectionSnapshot(f.sequence);
    expect(result.itemIds).toEqual(["video:0:800:source-17", "video:1:800:source-17"]);
    expect(result.scannedItemCount).toBe(38); expect(result.truncated).toBe(false);
    expect(f.stats()).toMatchObject({ selectedReads: 38, pending: 0, peak: 1 });
  });
  it("drains consumers before reacquiring a collection and retains valid item wrappers", async () => {
    const f = fixture(); let pendingConsumers = 0, liveOwner: string | undefined;
    await f.host.mapTrackItemReads(f.sequence, async (entry: any) => {
      pendingConsumers++;
      expect(f.stats().pending).toBe(0);
      const owner = entry.snapshot.id; liveOwner = owner;
      await Promise.resolve(); await Promise.resolve();
      expect(liveOwner).toBe(owner);
      // The mock invalidates old wrappers if the next collection is acquired.
      expect(await entry.raw.getName()).toBe(entry.snapshot.name);
      pendingConsumers--;
      return entry.snapshot;
    });
    expect(pendingConsumers).toBe(0);
    expect(f.stats().pending).toBe(0);
  });
  it("finds a late candidate with matching ticks only after full identity comparison", async () => {
    const f = fixture(); const found = await f.host.findTrackItemEntry(f.sequence, "video:1:800:source-17");
    expect(found.snapshot).toMatchObject({ id: "video:1:800:source-17", name: "clip 1/17" });
    expect(f.stats().pending).toBe(0);
    await expect(f.host.findTrackItemEntry(f.sequence, "video:1:800:missing")).rejects.toThrow("Track item not found");
    expect(f.stats().peak).toBe(1);
  });
});
