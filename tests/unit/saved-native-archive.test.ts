import {describe,it,expect,beforeEach,vi} from 'vitest';
import {gzipSync} from 'node:zlib';
import {readFile,stat} from 'node:fs/promises';
import {readNativeArchiveFile,readNativeArchiveBytes} from '../../apps/mcp-server/src/saved-native-archive.js';
vi.mock('node:fs/promises',()=>({readFile:vi.fn(),stat:vi.fn()}));
const info={isFile:()=>true,size:100,mtime:new Date('2026-09-16T00:00:00Z')};
beforeEach(()=>{vi.resetAllMocks();vi.mocked(stat).mockResolvedValue(info as any);});
describe('saved native archive effect boundary',()=>{
  it('reads a fresh immutable document even when the path and mtime do not change',async()=>{
    vi.mocked(readFile).mockResolvedValueOnce(gzipSync('<Data>before</Data>')).mockResolvedValueOnce(gzipSync('<Data>after!</Data>'));
    const a=await readNativeArchiveFile('same.prproj','TEST_BOUND'),b=await readNativeArchiveFile('same.prproj','TEST_BOUND');
    expect(a.document.xml).toBe('<Data>before</Data>');expect(b.document.xml).toBe('<Data>after!</Data>');
    expect(a.document).not.toBe(b.document);expect(readFile).toHaveBeenCalledTimes(2);
    expect(a.savedAt).toBe(info.mtime.toISOString());
  });
  it('keeps strict gzip validation and byte-only optimistic checks distinct',async()=>{
    const plain=Buffer.from('<Data/>');vi.mocked(readFile).mockResolvedValue(plain);
    expect((await readNativeArchiveFile('x','TEST_BOUND')).xml).toBe('<Data/>');
    await expect(readNativeArchiveFile('x','TEST_BOUND','gzip')).rejects.toThrow();
    const corrupt=Buffer.from([31,1,2]);vi.mocked(readFile).mockResolvedValue(corrupt);
    expect(await readNativeArchiveBytes('x','TEST_BOUND')).toEqual(corrupt);
    await expect(readNativeArchiveFile('x','TEST_BOUND')).rejects.toThrow();
  });
  it('rejects directories and oversized stat results before reading',async()=>{
    for(const changed of [{...info,isFile:()=>false},{...info,size:48*1024*1024+1}]){
      vi.mocked(stat).mockResolvedValue(changed as any);
      await expect(readNativeArchiveFile('x','CALLER_ERROR')).rejects.toThrow('CALLER_ERROR');
    }
    expect(readFile).not.toHaveBeenCalled();
  });
  it('retains filesystem failures instead of treating a missing file as cached success',async()=>{
    vi.mocked(readFile).mockResolvedValueOnce(Buffer.from('<Data/>'));
    await readNativeArchiveFile('x','TEST_BOUND');
    vi.mocked(stat).mockRejectedValueOnce(Object.assign(Error('gone'),{code:'ENOENT'}));
    await expect(readNativeArchiveFile('x','TEST_BOUND')).rejects.toMatchObject({code:'ENOENT'});
    expect(readFile).toHaveBeenCalledTimes(1);
  });
  it('rejects bytes that grew beyond the bound after stat without parsing them',async()=>{
    vi.mocked(readFile).mockResolvedValue({length:48*1024*1024+1} as Buffer);
    await expect(readNativeArchiveFile('x','GROWTH_BOUND')).rejects.toThrow('GROWTH_BOUND');
    await expect(readNativeArchiveBytes('x','GROWTH_BOUND')).rejects.toThrow('GROWTH_BOUND');
  });
});
