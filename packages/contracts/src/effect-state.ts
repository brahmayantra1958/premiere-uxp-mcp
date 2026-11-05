type RecordValue=Record<string,any>;
/** Stable effect content for command-sequence guards. Native state and key
 * values/modes remain; sampled presentation coordinates/metadata do not. */
export function effectStateProjection(chain:RecordValue[]):RecordValue[]{
  return chain.map(c=>({...c,params:c.params.map((p:RecordValue)=>{
    const {descriptor,displayName:_name,sampledSequenceTime:_sequence,timeMapping:_mapping,...content}=p;
    void _name;void _sequence;void _mapping;
    return {...content,...(descriptor?.semanticRole==='host_status'?{value:undefined}:{}),keyframeDetails:content.keyframeDetails.map((k:RecordValue)=>{
      // query_timeline/get_effect_values add coordinate labels to the same
      // native key. Atomic mutation snapshots contain only time. Compare that
      // canonical native time plus all values/modes/tangents, not its aliases.
      // sampledAt/value deliberately remain: differing sample observations
      // must not silently pass a content guard.
      const {sequenceTime:_sequenceTime,clipTime:_clipTime,timeBasis:_basis,...key}=k;
      void _sequenceTime;void _clipTime;void _basis;return key;
    })};
  })}));
}
