import { describe, expect, it, vi } from "vitest";
vi.mock("../../apps/uxp-plugin/src/host-context.js", () => ({ ppro: { TickTime: { TIME_ZERO: { ticks: "0", seconds: 0 }, createWithTicks: (ticks: string) => ({ ticks, seconds: Number(ticks) / 100 }) },
  Keyframe: { INTERPOLATION_MODE_LINEAR: 1, INTERPOLATION_MODE_HOLD: 2, INTERPOLATION_MODE_BEZIER: 3 } }, activeSequence: vi.fn() }));
vi.mock("../../apps/uxp-plugin/src/host-foundation.js", () => ({ text: (v: unknown) => v == null ? "" : String(v), asTickTime: (v: any) => ({ ticks: String(v.ticks), seconds: Number(v.seconds) }) }));
vi.mock("../../apps/uxp-plugin/src/host-items.js", () => ({ trackItems: vi.fn() }));
import { componentSnapshot } from "../../apps/uxp-plugin/src/host-components.js";

function fixture() {
  const components = Array.from({ length: 2 }, (_, c) => ({
    getParamCount: () => 12,
    getDisplayName: async () => `effect ${c}`,
    getMatchName: async () => `match.${c}`,
    getParam: (p: number) => ({ displayName: `param ${p}`, getValueAtTime: async () => ({ value: p % 2 ? { x: p, y: c } : p }),
      isTimeVarying: () => p === 3,
      getKeyframeListAsTickTimes: () => p === 3 ? [{ ticks: "25", seconds: .25 }, { ticks: "50", seconds: .5 }] : [],
      getKeyframePtr: (time: any) => ({ value: { value: time.seconds * 7 }, getTemporalInterpolationMode: async () => time.ticks === "25" ? 2 : 3 }),
    }),
  }));
  return { components, item: { getComponentChain: async () => ({ getComponentCount: () => components.length, getComponentAtIndex: (i: number) => components[i] }) } };
}
describe("serial and bounded component read parity", () => {
  it('never acquires another parameter or name while a native promise is pending, even with the legacy parallel request',async()=>{
    const f=fixture();let pending=0,peak=0,reads=0;
    const hold=async<T>(value:T)=>{pending++;peak=Math.max(peak,pending);await Promise.resolve();await Promise.resolve();pending--;reads++;return value;};
    for(const c of f.components){
      const get=c.getParam,display=c.getDisplayName,match=c.getMatchName;
      c.getDisplayName=()=>hold(display());c.getMatchName=()=>hold(match());
      c.getParam=i=>{expect(pending).toBe(0);const p=get(i);return {...p,getValueAtTime:()=>hold(p.getValueAtTime()),areKeyframesSupported:()=>hold(true)};};
    }
    const result=await componentSnapshot(f.item,true,true);
    expect(result).toHaveLength(2);expect(result[1]!.params).toHaveLength(12);
    expect(peak).toBe(1);expect(pending).toBe(0);expect(reads).toBe(52);
  });
  it('projects one native parameter without touching unrelated effect handles or values',async()=>{
    const f=fixture(),full=await componentSnapshot(f.item,true),chain=await f.item.getComponentChain();
    const get=chain.getComponentAtIndex;
    f.item.getComponentChain=async()=>({...chain,getComponentAtIndex:(i:number)=>{if(i!==1)throw Error('Unrelated effect touched');return get(i);}});
    const param=f.components[1]!.getParam;f.components[1]!.getParam=(i:number)=>{if(i!==3)throw Error('Unrelated parameter touched');return param(i);};
    const projected=await componentSnapshot(f.item,true,false,undefined,{componentIndex:1,paramIndex:3});
    expect(projected[0]!.componentIndex).toBe(1);expect(projected[0]!.params).toEqual([full[1]!.params[3]]);
    await expect(componentSnapshot(f.item,true,false,undefined,{componentIndex:2})).rejects.toThrow('COMPONENT_PROJECTION_OUT_OF_RANGE');
    await expect(componentSnapshot(f.item,true,false,undefined,{componentIndex:1,paramIndex:12})).rejects.toThrow('PARAMETER_PROJECTION_OUT_OF_RANGE');
  });
  it("reacquires an invalidated read-only component chain once without cached fallback",async()=>{
    const f=fixture(),read=f.item.getComponentChain;let attempts=0;
    f.item.getComponentChain=async()=>{if(++attempts===1)throw Error("The script object is no longer valid.");return read();};
    expect(await componentSnapshot(f.item,true)).toHaveLength(2);expect(attempts).toBe(2);
    attempts=0;f.item.getComponentChain=async()=>{attempts++;throw Error("The script object is no longer valid.");};
    await expect(componentSnapshot(f.item,true)).rejects.toThrow("no longer valid");expect(attempts).toBe(2);
  });
  it.each([false,true])("reports exact animated Color keys even when native sampling is unavailable with fresh=%s",async fresh=>{
    const f=fixture();f.components.splice(1);f.components[0]!.getParamCount=()=>1;
    f.components[0]!.getParam=()=>({displayName:"Color",getValueAtTime:async()=>{throw Error("not supported for these value types");},isTimeVarying:()=>true,getKeyframeListAsTickTimes:()=>[{ticks:"25",seconds:.25}],
      getStartValue:async()=>({red:0,green:0,blue:0,alpha:0}),getKeyframePtr:(t:any)=>{if(t.ticks!=="25")throw Error("No exact key");return {value:{value:Number(0x000033006600cc00n)},getTemporalInterpolationMode:async()=>2};}} as any);
    const p=(await componentSnapshot(f.item,true,false,undefined,undefined,undefined,fresh?async()=>f.item:undefined))[0]!.params[0];
    expect(p).toMatchObject({nativeValueType:"color",valueKind:"color",readStatus:{value:"unsupported",animation:"pass"},keyframeDetails:[{value:{red:.2,green:.4,blue:.8,alpha:0},interpolation:"hold"}]});
    expect(p.value).toBeUndefined();
  });
  it.each([false,true])("reads native Color through the verified static fallback and labels opaque controls with fresh=%s",async fresh=>{
    const f=fixture();f.components.splice(1);f.components[0]!.getParamCount=()=>2;
    f.components[0]!.getParam=(p:number)=>({displayName:p?"Opaque":"Color",getValueAtTime:async()=>{throw Error("not supported for these value types");},isTimeVarying:()=>false,getKeyframeListAsTickTimes:()=>[],getKeyframePtr:()=>{throw Error("No key");},getStartValue:async()=>p?null:{red:.2,green:.4,blue:.8,alpha:0}} as any);
    const c=(await componentSnapshot(f.item,true,false,undefined,undefined,undefined,fresh?async()=>f.item:undefined))[0]!;
    expect(c.params[0]).toMatchObject({value:{red:.2,green:.4,blue:.8,alpha:0},valueReadMethod:"getStartValue_verified_static",descriptor:{inputKind:"color"}});
    expect(c.params[1]).toMatchObject({valueKind:"opaque",readStatus:{value:"unsupported"},descriptor:{staticWrite:"unsupported_value_shape"}});
  });
  it("never substitutes a static Color start value for unreadable animation",async()=>{
    const f=fixture();f.components.splice(1);f.components[0]!.getParamCount=()=>1;
    const start=vi.fn();f.components[0]!.getParam=()=>({displayName:"Color",getValueAtTime:async()=>{throw Error("not supported for these value types");},isTimeVarying:()=>true,getKeyframeListAsTickTimes:()=>[],getKeyframePtr:()=>{throw Error("No key");},getStartValue:start} as any);
    await expect(componentSnapshot(f.item,true)).rejects.toThrow("not supported");expect(start).toHaveBeenCalledTimes(1);
  });
  it.each([false, true])("preserves all parameter values, ordering and keyframe details with strict=%s", async strict => {
    const f = fixture(); const serial = await componentSnapshot(f.item, strict, false); const parallel = await componentSnapshot(f.item, strict, true);
    expect(parallel).toEqual(serial);
    expect(parallel[1]?.params[3]).toMatchObject({ value: { x: 3, y: 1 }, keyframeDetails: [
      { time: { ticks: "25", seconds: .25 }, value: 1.75, interpolation: "hold" },
      { time: { ticks: "50", seconds: .5 }, value: 3.5, interpolation: "bezier" },
    ] });
    if (strict) expect(parallel[0]?.params[3].timeVarying).toBe(true);
    const fresh=await componentSnapshot(f.item,strict,false,undefined,undefined,undefined,async()=>f.item);
    expect(fresh).toEqual(serial);
  });
  it("uses two fresh bindings per parameter while retaining every value, native key and interpolation read", async () => {
    const f=fixture(),calls={value:0,state:0,support:0,list:0,key:0,interpolation:0};
    for(const component of f.components){
      const getParam=component.getParam;
      component.getParam=p=>{
        const original=getParam(p);
        return {...original,
          getValueAtTime:async()=>{calls.value++;return original.getValueAtTime();},
          isTimeVarying:()=>{calls.state++;return original.isTimeVarying();},
          areKeyframesSupported:async()=>{calls.support++;return true;},
          getKeyframeListAsTickTimes:()=>{calls.list++;return original.getKeyframeListAsTickTimes();},
          getKeyframePtr:(time:any)=>{calls.key++;const key=original.getKeyframePtr(time);return {...key,getTemporalInterpolationMode:async()=>{calls.interpolation++;return key.getTemporalInterpolationMode();}};},
        };
      };
    }
    const legacy=await componentSnapshot(f.item,true);
    expect(calls).toEqual({value:24,state:24,support:24,list:24,key:4,interpolation:4});
    for(const name of Object.keys(calls) as (keyof typeof calls)[])calls[name]=0;
    const factory=vi.fn(async()=>f.item);
    const fresh=await componentSnapshot(null,true,false,undefined,undefined,undefined,factory);
    expect(fresh).toEqual(legacy);
    expect(calls).toEqual({value:24,state:24,support:24,list:24,key:4,interpolation:4});
    // 1 initial + 5 per component + 2 per parameter + 1 per keyframe.
    // The previous four-bindings-per-parameter route needed 111 acquisitions.
    expect(factory).toHaveBeenCalledTimes(63);
  });
  it.each(["state", "list", "missingList", "undefinedList", "support", "unsupported"])("keeps %s metadata failures and unsupported results identical with fresh bindings",async failure=>{
    const f=fixture();f.components.splice(1);f.components[0]!.getParamCount=()=>1;
    const stateError=Error("state failed"),listError=Error("list failed");
    f.components[0]!.getParam=()=>({displayName:"Amount",getValueAtTime:async()=>7,
      isTimeVarying:()=>{if(failure==="state")throw stateError;return false;},
      getKeyframeListAsTickTimes:failure==="missingList"?undefined:()=>{if(failure==="list")throw listError;if(failure==="undefinedList")throw undefined;return [];},
      areKeyframesSupported:async()=>{if(failure==="support")throw Error("support failed");return failure!=="unsupported";},
    } as any);
    const legacy=await componentSnapshot(f.item,false);
    const fresh=await componentSnapshot(null,false,false,undefined,undefined,undefined,async()=>f.item);
    expect(fresh).toEqual(legacy);
    const param=fresh[0]!.params[0];
    expect(param.supportsKeyframes).toBe(failure==="support"?null:failure!=="unsupported");
    expect(param.readErrors).toEqual(failure==="state"?["animation state: Error: state failed"]:failure==="list"?["keyframe list: Error: list failed"]:failure==="missingList"?["keyframe list: Error: Keyframe list API unavailable"]:failure==="undefinedList"?["keyframe list: undefined"]:[]);
  });
  it.each([false,true])("preserves strict failure identity and does not start support after a failed state read with fresh=%s",async fresh=>{
    const f=fixture();f.components.splice(1);f.components[0]!.getParamCount=()=>1;
    const failure=Error("strict state failed"),support=vi.fn(async()=>true),list=vi.fn(()=>[]);
    f.components[0]!.getParam=()=>({displayName:"Amount",getValueAtTime:async()=>7,isTimeVarying:()=>{throw failure;},areKeyframesSupported:support,getKeyframeListAsTickTimes:list} as any);
    await expect(componentSnapshot(f.item,true,false,undefined,undefined,undefined,fresh?async()=>f.item:undefined)).rejects.toBe(failure);
    expect(support).not.toHaveBeenCalled();expect(list).not.toHaveBeenCalled();
  });
  it.each([false,true])("preserves strict key-list failure after checking support with fresh=%s",async fresh=>{
    const f=fixture();f.components.splice(1);f.components[0]!.getParamCount=()=>1;
    const failure=Error("strict list failed"),support=vi.fn(async()=>true);
    f.components[0]!.getParam=()=>({displayName:"Amount",getValueAtTime:async()=>7,isTimeVarying:()=>false,areKeyframesSupported:support,getKeyframeListAsTickTimes:()=>{throw failure;}} as any);
    await expect(componentSnapshot(f.item,true,false,undefined,undefined,undefined,fresh?async()=>f.item:undefined)).rejects.toBe(failure);
    expect(support).toHaveBeenCalledTimes(1);
  });
  it("both paths reject unreadable strict values before mutation", async () => {
    const f = fixture(); f.components[0]!.getParam = p => ({ ...fixture().components[0]!.getParam(p), getValueAtTime: async () => { throw Error("unreadable"); } });
    await expect(componentSnapshot(f.item, true, false)).rejects.toThrow("unreadable");
    await expect(componentSnapshot(f.item, true, true)).rejects.toThrow("unreadable");
  });
  it("retains one native chain owner even when callers request snapshots concurrently", async () => {
    let owner = "";
    const items = ["first", "second"].map(id => {
      const f = fixture(), originalChain = f.item.getComponentChain;
      f.item.getComponentChain = async () => { owner = id; return originalChain(); };
      for (const component of f.components) {
        const originalParam = component.getParam;
        component.getParam = index => ({ ...originalParam(index), getValueAtTime: async () => {
          await Promise.resolve(); await Promise.resolve();
          if (owner !== id) throw Error("Native component owner was invalidated");
          return originalParam(index).getValueAtTime();
        } });
      }
      return f.item;
    });
    const results = await Promise.all(items.map(item => componentSnapshot(item, true, true)));
    expect(results[0]).toEqual(results[1]);
  });
  it("releases component ownership after failure so a queued snapshot can finish", async () => {
    const bad = fixture(), good = fixture();
    bad.components[0]!.getParam = p => ({ ...fixture().components[0]!.getParam(p), getValueAtTime: async () => { throw Error("bad value"); } });
    const results = await Promise.allSettled([componentSnapshot(bad.item, true, true), componentSnapshot(good.item, true, true)]);
    expect(results[0].status).toBe("rejected");
    expect(results[1].status).toBe("fulfilled");
  });
});
