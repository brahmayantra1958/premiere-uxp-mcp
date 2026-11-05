import {describe,expect,it,vi} from 'vitest';
import {uxpModules} from '../helpers/uxp-modules.js';

function fixture(){
  let epoch=0,pending=0;
  const time=(n:number)=>({ticks:String(n*100),seconds:n});
  const state={snapshot:{id:'audio:0:0:source',name:'Audio',mediaType:'audio',trackIndex:0,projectItemId:'source',start:time(0),end:time(1),inPoint:time(4),outPoint:time(5),speed:1,reversed:false,disabled:false,adjustmentLayer:false},
    components:[{name:'Volume',count:2},{name:'Pitch',count:3}],nullAt:'',afterName:(index:number)=>{void index;}};
  const events:string[]=[];
  const check=(born:number)=>{expect(pending).toBe(0);if(born!==epoch)throw Error('The script object is no longer valid.');};
  const complete=async()=>{pending++;await Promise.resolve();pending--;epoch++;};
  const reacquire=vi.fn(async()=>{
    expect(pending).toBe(0);const born=epoch;
    return {snapshot:state.snapshot,raw:{getComponentChain:async()=>{
      check(born);events.push('chain');await complete();
      if(state.nullAt==='chain')return null;
      const chainEpoch=epoch;
      return {getComponentCount:()=>{check(chainEpoch);return state.components.length;},getComponentAtIndex:(index:number)=>{
        check(chainEpoch);if(state.nullAt==='component')return null;
        const componentEpoch=epoch,definition=state.components[index]!;
        return {getParamCount:()=>{check(componentEpoch);return definition.count;},getMatchName:async()=>{
          check(componentEpoch);events.push('name');const name=definition.name;await complete();state.afterName(index);return name;
        },getParam:()=>{throw Error('Topology must not read parameter objects or values');}};
      }};
    }}};
  });
  const module=uxpModules({})('apps/uxp-plugin/src/host-graphic-components.ts');
  return {state,reacquire,module,events};
}
const baseline=()=>[
  {componentIndex:0,matchName:'Volume',params:[{paramIndex:0},{paramIndex:1}]},
  {componentIndex:1,matchName:'Pitch',params:[{paramIndex:0},{paramIndex:1},{paramIndex:2}]},
];

describe('fresh UI effect structure boundary',()=>{
  it('rebinds after every async name and returns detached full metadata without reading any value',async()=>{
    const f=fixture(),result=await f.module.readEffectStructure(f.reacquire);
    expect(result).toEqual({snapshot:f.state.snapshot,components:[['Volume',2],['Pitch',3]]});
    expect(f.reacquire).toHaveBeenCalledTimes(5);expect(f.events).toEqual(['chain','chain','name','chain','name']);
    f.state.snapshot.inPoint.ticks='changed';f.state.snapshot.speed=2;
    expect(result.snapshot.inPoint.ticks).toBe('400');expect(result.snapshot.speed).toBe(1);
    expect(f.module.effectStructureMatches(baseline(),result)).toBe(true);
  });
  it.each(['inPoint','speed','reversed','disabled','adjustmentLayer'])('rejects full %s metadata drift even when the callback reuses its snapshot object',async field=>{
    const f=fixture();
    f.state.afterName=index=>{if(index!==0)return;if(field==='inPoint')f.state.snapshot.inPoint.ticks='450';else if(field==='speed')f.state.snapshot.speed=2;else (f.state.snapshot as any)[field]=true;};
    await expect(f.module.readEffectStructure(f.reacquire)).rejects.toMatchObject({code:'GRAPHIC_OBJECT_NOT_READY'});
    expect(f.events.filter(event=>event==='name')).toHaveLength(1);
  });
  it('rejects metadata drift after the last component before returning a boundary witness',async()=>{
    const f=fixture();f.state.afterName=index=>{if(index===1)f.state.snapshot.end.ticks='200';};
    await expect(f.module.readEffectStructure(f.reacquire)).rejects.toMatchObject({code:'GRAPHIC_OBJECT_NOT_READY'});
  });
  it.each(['chain','component'])('rejects a null %s without dropping topology entries',async nullAt=>{
    const f=fixture();f.state.nullAt=nullAt;
    await expect(f.module.readEffectStructure(f.reacquire)).rejects.toMatchObject({code:'GRAPHIC_OBJECT_NOT_READY'});
  });
  it('rejects component-count drift between fresh bindings',async()=>{
    const f=fixture();f.state.afterName=index=>{if(index===0)f.state.components.push({name:'Unexpected',count:1});};
    await expect(f.module.readEffectStructure(f.reacquire)).rejects.toMatchObject({code:'GRAPHIC_OBJECT_NOT_READY'});
  });
  it.each(['order','matchName','paramCount','componentIndex','parameterIndex'])('compares complete ordered topology and rejects %s drift',async field=>{
    const f=fixture(),current=await f.module.readEffectStructure(f.reacquire),before=baseline();
    if(field==='order')before.reverse();
    else if(field==='matchName')before[1]!.matchName='Replacement';
    else if(field==='paramCount')before[1]!.params.pop();
    else if(field==='componentIndex')before[1]!.componentIndex=5;
    else before[1]!.params[2]!.paramIndex=0;
    expect(f.module.effectStructureMatches(before,current)).toBe(false);
  });
});
