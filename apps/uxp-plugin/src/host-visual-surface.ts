import {activeProject,activeSequence,ppro,uxp} from "./host-context.js";
import {collectRuntimeSurface} from "./premiere-feature-routes.js";

/** Descriptor-only feature discovery. Never calls undocumented methods or native setters. */
export async function inspectVisualSurface() {
  const project=await activeProject(),sequence=await activeSequence(project);
  const surfaces:Record<string,unknown>={uxp,project,sequence,sourceMonitor:ppro.SourceMonitor,hSLScripting:uxp.hSLScripting};
  for(const name of ["Application","ProjectUtils","ProjectItemSelection","ObjectMaskUtils","WorkAreaUtils","SequenceEditor"]) {
    surfaces[name]=ppro[name];surfaces[`${name}.prototype`]=ppro[name]?.prototype;
  }
  const selected=await sequence.getSelection();
  const items=await selected.getTrackItems();
  const first=items[0];
  if(first){surfaces.trackItem=first;const chain=await first.getComponentChain?.();surfaces.chain=chain;if(chain&&await chain.getComponentCount()){const component=await chain.getComponentAtIndex(0);surfaces.component=component;}}
  return {mutationCalls:0,surfaces:Object.fromEntries(Object.entries(surfaces).map(([key,value])=>[key,collectRuntimeSurface(value)]))};
}
