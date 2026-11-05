import {describe,it,expect} from 'vitest';
import {NativeArchiveDocument} from '../../apps/mcp-server/src/native-archive-document.js';
import {inspectLumetriCurve,patchLumetriCurve,lumetriCurvePreservation} from '../../apps/mcp-server/src/lumetri-curve-archive.js';
import {inspectSpeedGraph,patchSpeedGraph} from '../../apps/mcp-server/src/speed-graph-archive.js';
import {fixture as curveFixture,target as curveTarget,points} from '../fixtures/lumetri-curve.js';
import {fixture as speedFixture,target as speedTarget} from '../fixtures/speed-graph.js';

describe('immutable archive reuse preserves correlation and freshness',()=>{
  it('preserves legacy per-reference matching for nested, duplicate and overlapping IDs',()=>{
    const ids=['','1','2','a.b','[nested]'];
    const reference=(xml:string,id:string,uid:boolean)=>{
      const escaped=id.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
      return [...xml.matchAll(new RegExp(`<([A-Za-z0-9_]+)\\b[^>]*Object${uid?'UID':'ID'}="${escaped}"[^>]*>[\\s\\S]*?</\\1>`,'g'))].map(m=>m[0]);
    };
    for(let seed=0;seed<50;seed++){
      const xml=ids.map((id,i)=>{
        const kind=(seed+i)%2?'UID':'ID',next=ids[(seed+i)%ids.length];
        return `<Node Object${kind}="${id}"><Node ObjectID="${next}">inner</Node><Other ObjectUID="${id}"/></Node><Other ObjectID="${id}">last</Other>`;
      }).join('')+'<Unclosed ObjectID="1">';
      const document=new NativeArchiveDocument(xml);
      for(const id of [...ids,'missing'])for(const uid of [false,true]){
        expect(document.objects(id,uid)).toEqual(reference(xml,id,uid));
      }
    }
  });
  it('keeps the original curve independent of patches and returned values',()=>{
    const xml=curveFixture(),document=new NativeArchiveDocument(xml),before=inspectLumetriCurve(document,curveTarget);
    const preserved=lumetriCurvePreservation(document,curveTarget);
    const patch=patchLumetriCurve(document,curveTarget,before.sha256,points);
    expect(patch).toEqual(patchLumetriCurve(xml,curveTarget,before.sha256,points));
    const changed=new NativeArchiveDocument(patch.xml),after=inspectLumetriCurve(changed,curveTarget);
    expect(after.points).toEqual(points);
    after.points[0]!.y=999;
    expect(inspectLumetriCurve(changed,curveTarget).points).toEqual(points);
    expect(inspectLumetriCurve(document,curveTarget)).toEqual(before);
    expect(lumetriCurvePreservation(changed,curveTarget)).toEqual(preserved);
    expect(()=>patchLumetriCurve(changed,curveTarget,before.sha256,points)).toThrow('STALE');
  });

  it('revalidates changed source, instance and parameter guards on a reused document',()=>{
    const document=new NativeArchiveDocument(curveFixture());
    const target={...curveTarget,parameterNames:[...curveTarget.parameterNames]};
    inspectLumetriCurve(document,target);
    target.parameterNames[target.paramIndex]='changed';
    expect(()=>inspectLumetriCurve(document,target)).toThrow();
    expect(()=>inspectLumetriCurve(document,{...curveTarget,projectItemId:'other'})).toThrow();
    expect(()=>inspectLumetriCurve(document,{...curveTarget,componentMatchNames:[...curveTarget.componentMatchNames,'AE.ADBE Lumetri']})).toThrow('OCCURRENCES');
  });

  it('does not reuse a successful parse for a changed or ambiguous file',()=>{
    const xml=curveFixture();
    inspectLumetriCurve(new NativeArchiveDocument(xml),curveTarget);
    expect(()=>inspectLumetriCurve(new NativeArchiveDocument(xml.replace('<ParameterID>42','<ParameterID>106')),curveTarget)).toThrow('UNSUPPORTED');
    expect(()=>inspectLumetriCurve(new NativeArchiveDocument(xml.replace('</Data>','<Other BinaryHash="abc">AAAA</Other></Data>')),curveTarget)).toThrow('AMBIGUOUS');
    expect(()=>inspectLumetriCurve(new NativeArchiveDocument(xml.replace('</Data>','<Other ObjectID="6"><Name>duplicate</Name></Other></Data>')),curveTarget)).toThrow('DUPLICATE_OBJECT');
  });

  it('reparses Speed patches and rejects a later content change',()=>{
    const xml=speedFixture(),document=new NativeArchiveDocument(xml),before=inspectSpeedGraph(document,speedTarget);
    const patch=patchSpeedGraph(document,speedTarget,before.contentSha256,true);
    expect(patch).toEqual(patchSpeedGraph(xml,speedTarget,before.contentSha256,true));
    expect(inspectSpeedGraph(new NativeArchiveDocument(patch.xml),speedTarget).expanded).toBe(true);
    expect(inspectSpeedGraph(document,speedTarget)).toEqual(before);
    expect(()=>patchSpeedGraph(new NativeArchiveDocument(patch.xml.replace('100,1,6;','100,2,6;')),speedTarget,before.contentSha256,false)).toThrow('CONTENT_CHANGED');
  });
});
