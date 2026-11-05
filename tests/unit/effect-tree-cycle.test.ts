import {describe,it,expect} from "vitest";
import {cycleEffectTree,type NativeDisclosure,type EffectTreeServices} from "../../apps/mcp-server/src/effect-tree-cycle.js";

function host(){
 const rows:NativeDisclosure[]=[{index:12,depth:0,expanded:false},{index:14,depth:1,expanded:false},{index:110,depth:2,expanded:false},{index:114,depth:3,expanded:false},{index:374,depth:0,expanded:false},{index:386,depth:1,expanded:false},{index:477,depth:0,expanded:false},{index:479,depth:1,expanded:false}];
 const writes:Array<[number,boolean]>=[],progress:unknown[]=[];
 const services:EffectTreeServices={assertTarget:async()=>{},progress:async value=>{progress.push(value);},
 inspect:async()=>{const ancestors:NativeDisclosure[]=[];return {complete:true,rows:rows.filter(row=>{while(ancestors.length&&ancestors.at(-1)!.depth>=row.depth)ancestors.pop();const visible=ancestors.every(p=>p.expanded);ancestors.push(row);return visible;}).map(row=>({...row}))};},
 set:async(row,expanded)=>{writes.push([row.index,expanded]);rows.find(r=>r.index===row.index)!.expanded=expanded;return {status:"pass",expanded};}};
 return {rows,writes,progress,services};
}
describe("Effect Controls five-cycle native protocol",()=>{
 it("discovers nested controls then proves all five collapse/breadth-first expansions",async()=>{
  const h=host(),result=await cycleEffectTree(5,h.services);expect(result).toMatchObject({status:"pass",completedCycles:5,controls:8,maxDepth:3});expect(h.progress).toHaveLength(25);expect(h.rows.every(r=>r.expanded)).toBe(true);
  const firstCollapse=h.writes.findIndex(x=>!x[1]);expect(h.writes.slice(firstCollapse,firstCollapse+8).map(x=>x[0])).toEqual([114,110,479,386,14,477,374,12]);
  expect(h.writes.slice(firstCollapse+8,firstCollapse+16).map(x=>x[0])).toEqual([12,374,477,14,386,479,110,114]);
 });
 it("never retries an unverified Speed arrow or claims a completed cycle",async()=>{
  const h=host(),set=h.services.set;h.services.set=async(row,expanded)=>row.index===479?(h.writes.push([row.index,expanded]),{status:"unverified",expanded:false}):set(row,expanded);
  await expect(cycleEffectTree(5,h.services)).rejects.toThrow("ACTION_UNVERIFIED_NO_REPLAY");expect(h.writes.filter(x=>x[0]===479)).toHaveLength(1);expect(h.progress).toHaveLength(0);
 });
 it("rejects a truncated sweep and a changed target before any notification",async()=>{
  const h=host();h.services.inspect=async()=>({complete:false,rows:h.rows});await expect(cycleEffectTree(5,h.services)).rejects.toThrow("OBSERVATION_INCOMPLETE");expect(h.writes).toHaveLength(0);
  h.services.assertTarget=async()=>{throw Error("TARGET_CHANGED");};await expect(cycleEffectTree(5,h.services)).rejects.toThrow("TARGET_CHANGED");expect(h.writes).toHaveLength(0);
 });
 it("detects a changed native tree before reporting the first cycle",async()=>{
  const h=host(),inspect=h.services.inspect;let calls=0;h.services.inspect=async()=>{const r=await inspect();if(++calls>5)r.rows[0]!.index=99;return r;};
  await expect(cycleEffectTree(5,h.services)).rejects.toThrow("PHASE_UNVERIFIED");expect(h.progress).toHaveLength(0);
 });
 it.each([0,6,1.2,NaN])("rejects invalid cycle count %s",async count=>{const h=host();await expect(cycleEffectTree(count,h.services)).rejects.toThrow("CYCLES_INVALID");expect(h.writes).toHaveLength(0);});
});
