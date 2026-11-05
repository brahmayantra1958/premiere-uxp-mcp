import {describe,it,expect,vi} from 'vitest';
import {RuntimeBootstrap} from '../../apps/uxp-plugin/src/runtime-bootstrap.js';

describe('fixed UXP runtime startup',()=>{
  it.each(['', 'user denied', new Error('launch unavailable')])('requests Adobe consent once and preserves connection-based readiness (%s)',async result=>{
    const openPath=vi.fn(async()=>{if(result instanceof Error)throw result;return result;});
    const log=vi.fn(),bootstrap=new RuntimeBootstrap({openPath},'C:/fixed/launcher.exe',log);
    await Promise.all([bootstrap.start(),bootstrap.start()]);
    await bootstrap.start();
    expect(openPath).toHaveBeenCalledTimes(1);
    expect(openPath).toHaveBeenCalledWith('C:/fixed/launcher.exe',expect.stringContaining('기존 Node'));
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]![0]).not.toContain('connected');
  });
  it('does not substitute a general launcher when the fixed capability is unavailable',async()=>{
    const log=vi.fn(),openPath=vi.fn();
    await new RuntimeBootstrap({openPath},undefined,log).start();
    await new RuntimeBootstrap(undefined,'C:/fixed/launcher.exe',log).start();
    expect(openPath).not.toHaveBeenCalled();
  });
});
