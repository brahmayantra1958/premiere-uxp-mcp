import {describe,it,expect} from 'vitest';
import {RuntimeEvents} from '../../apps/mcp-server/src/runtime-events.js';
describe('bounded runtime event observations',()=>{
  it('keeps a terminal wait pending through intermediate job progress',async()=>{
    const j=new RuntimeEvents();let resolved=false;const wait=j.wait({jobId:'job',terminalOnly:true,timeoutMs:1000}).then(page=>{resolved=true;return page;});
    j.append({kind:'job',id:'job',state:'running'});j.append({kind:'command',id:'job',state:'pass'});await Promise.resolve();expect(resolved).toBe(false);
    j.append({kind:'job',id:'job',state:'pass'});expect((await wait).events.map(e=>e.kind+':'+e.state)).toEqual(['job:pass']);j.close();
  });
  it('paginates without dropping the next page and signals overflow/restart',()=>{
    const journal=new RuntimeEvents(3);for(let i=0;i<5;i++)journal.append({kind:'command',id:String(i),state:'pass'});
    const first=journal.list({sessionId:journal.sessionId,afterRevision:1,limit:1});expect(first).toMatchObject({overflow:true,nextRevision:3,hasMore:true});
    expect(journal.list({sessionId:journal.sessionId,afterRevision:first.nextRevision}).events.map(e=>e.revision)).toEqual([4,5]);
    expect(new RuntimeEvents().list({sessionId:journal.sessionId,afterRevision:5})).toMatchObject({resetRequired:true,events:[]});
  });
  it('wakes independent filtered clients only on a matching change and excludes payloads',async()=>{
    const j=new RuntimeEvents(),a=j.wait({jobId:'a',timeoutMs:1000}),b=j.wait({jobId:'b',timeoutMs:1000});
    j.append({kind:'job',id:'a',jobId:'a',state:'pass',secret:'hidden'} as any);
    expect((await a).events).toHaveLength(1);expect((await a).events[0]).not.toHaveProperty('secret');
    j.append({kind:'job',id:'b',jobId:'b',state:'unverified'});expect((await b).events[0]?.state).toBe('unverified');j.close();
  });
  it('bounds waiters, releases aborted waits and closes pending requests',async()=>{
    const j=new RuntimeEvents(4,1),a=new AbortController(),pending=j.wait({timeoutMs:1000},a.signal);
    await expect(j.wait({timeoutMs:1000})).rejects.toThrow('EVENT_WAITER_LIMIT');a.abort();await pending;
    const final=j.wait({timeoutMs:1000});j.close();expect((await final).closed).toBe(true);
  });
  it('times out without publishing or accessing a host',async()=>{
    const j=new RuntimeEvents();expect(await j.wait({timeoutMs:5})).toMatchObject({timedOut:true,events:[],latestRevision:0});
  });
});
