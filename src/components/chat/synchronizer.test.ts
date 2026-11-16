import{afterEach,beforeEach,expect,it,vi}from"vitest";
import{createChatSynchronizer,validReadHint}from"./synchronizer";
beforeEach(()=>vi.useFakeTimers());afterEach(()=>vi.useRealTimers());
it("merges a hundred hints into one authorized request",async()=>{
  const run=vi.fn(async()=>{}),sync=createChatSynchronizer(run,vi.fn());
  for(let i=0;i<100;i++)sync.invalidate();await vi.advanceTimersByTimeAsync(300);expect(run).toHaveBeenCalledTimes(1);sync.dispose();
});
it("never overlaps and retains exactly one trailing refresh",async()=>{
  let finish!:()=>void;const run=vi.fn(()=>new Promise<void>(r=>{finish=r;})),sync=createChatSynchronizer(run,vi.fn());
  sync.invalidate(true);await vi.advanceTimersByTimeAsync(0);for(let i=0;i<100;i++)sync.invalidate();await vi.advanceTimersByTimeAsync(300);expect(run).toHaveBeenCalledTimes(1);
  finish();await vi.advanceTimersByTimeAsync(300);expect(run).toHaveBeenCalledTimes(2);sync.dispose();
});
it("aborts stale requests and suppresses later work",async()=>{
  let signal:AbortSignal|undefined;const run=vi.fn((s:AbortSignal)=>{signal=s;return new Promise<void>(()=>{});}),errors=vi.fn(),sync=createChatSynchronizer(run,errors);
  sync.invalidate(true);await vi.advanceTimersByTimeAsync(0);sync.dispose();expect(signal?.aborted).toBe(true);sync.invalidate();await vi.advanceTimersByTimeAsync(1000);expect(run).toHaveBeenCalledTimes(1);expect(errors).not.toHaveBeenCalled();
});
it("allows a bounded retry after network failure",async()=>{
  const run=vi.fn().mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce(undefined),errors=vi.fn(),sync=createChatSynchronizer(run,errors);
  sync.invalidate();await vi.advanceTimersByTimeAsync(300);expect(errors).toHaveBeenCalledTimes(1);sync.invalidate();await vi.advanceTimersByTimeAsync(300);expect(run).toHaveBeenCalledTimes(2);sync.dispose();
});
it("rejects malformed or unsafe cursor hints",()=>{
  expect(validReadHint({userId:1,lastReadMessageId:20})).toBe(true);
  for(const value of [null,{}, {userId:"1",lastReadMessageId:2},{userId:1,lastReadMessageId:Infinity},{userId:1,lastReadMessageId:-1}])expect(validReadHint(value)).toBe(false);
});
