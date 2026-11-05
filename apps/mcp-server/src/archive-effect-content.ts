type Row=Record<string,any>;
/** UXP annotations describe read capability, not stored clip content. Native
 * archive comparison separately protects all unsupported opaque parameters. */
export function observedContent(r:Row){return {item:r.item,components:r.components.map((c:Row)=>({...c,params:c.params.map((p:Row)=>{
  const {descriptor:_descriptor,sampledSequenceTime:_sequenceTime,timeMapping:_mapping,...value}=p;
  void _descriptor;void _sequenceTime;void _mapping;
  return {...value,keyframeDetails:p.keyframeDetails.map((k:Row)=>{const {sequenceTime:_seq,...native}=k;void _seq;return native;})};
})}))};}
