/** Extent discovery reads clocks on every AV track, including muted/disabled
 * content. Sequence.getEndTime may exclude such content. No item-count cap. */
export async function timelineExtentSeconds(sequence:any, clipType:number):Promise<number> {
  let end=Number((await sequence.getEndTime()).seconds);
  if(!Number.isFinite(end))throw Error('SPLIT_EXTENT_UNVERIFIED');
  for(const media of ['Video','Audio']) {
    const count=Number(await sequence[`get${media}TrackCount`]());
    if(!Number.isSafeInteger(count)||count<0)throw Error('SPLIT_EXTENT_UNVERIFIED');
    for(let index=0;index<count;index++) {
      const track=await sequence[`get${media}Track`](index);
      const items=await track.getTrackItems(clipType,false);
      if(!Array.isArray(items)||items.some(item=>!item))throw Error('SPLIT_EXTENT_UNVERIFIED');
      for(const item of items) {
        const seconds=Number((await item.getEndTime()).seconds);
        if(!Number.isFinite(seconds))throw Error('SPLIT_EXTENT_UNVERIFIED');
        end=Math.max(end,seconds);
      }
    }
  }
  return end;
}
