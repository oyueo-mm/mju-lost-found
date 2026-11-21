import{afterEach,beforeEach,expect,it,vi}from"vitest";
import{boundedSignal,createChatSynchronizer,SyncTimeout,validReadHint}from"./synchronizer";
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

// 2026-11-21: a request that never answers used to freeze the tab's sync.
it("abandons a hung run after the timeout, reports it once and runs the next refresh",async()=>{
  let signal:AbortSignal|undefined;
  const run=vi.fn().mockImplementationOnce((s:AbortSignal)=>{signal=s;return new Promise<void>(()=>{});}).mockResolvedValue(undefined);
  const errors=vi.fn(),sync=createChatSynchronizer(run,errors,300,15000);
  sync.invalidate(true);await vi.advanceTimersByTimeAsync(0);
  sync.invalidate();await vi.advanceTimersByTimeAsync(14000);
  expect(run).toHaveBeenCalledTimes(1);expect(errors).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1000);
  expect(signal?.aborted).toBe(true);
  expect(errors).toHaveBeenCalledTimes(1);expect(errors.mock.calls[0][0]).toBeInstanceOf(SyncTimeout);
  await vi.advanceTimersByTimeAsync(300);
  expect(run).toHaveBeenCalledTimes(2);
  sync.dispose();
});
it("frees the synchronizer even when the run ignores its signal",async()=>{
  const run=vi.fn().mockImplementationOnce(()=>new Promise<void>(()=>{})).mockResolvedValue(undefined);
  const errors=vi.fn(),sync=createChatSynchronizer(run,errors,300,15000);
  sync.invalidate(true);await vi.advanceTimersByTimeAsync(15000);
  sync.invalidate(true);await vi.advanceTimersByTimeAsync(0);
  expect(run).toHaveBeenCalledTimes(2);expect(errors).toHaveBeenCalledTimes(1);
  sync.dispose();
});
it("a run finishing in time leaves no timer behind and reports nothing",async()=>{
  const run=vi.fn(async()=>{}),errors=vi.fn(),sync=createChatSynchronizer(run,errors,300,15000);
  sync.invalidate(true);await vi.advanceTimersByTimeAsync(0);
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(20000);expect(errors).not.toHaveBeenCalled();
  sync.dispose();
});
it("dispose during a hung run aborts silently and never reports a timeout (room switch / unmount)",async()=>{
  let signal:AbortSignal|undefined;
  const run=vi.fn((s:AbortSignal)=>{signal=s;return new Promise<void>(()=>{});}),errors=vi.fn(),sync=createChatSynchronizer(run,errors,300,15000);
  sync.invalidate(true);await vi.advanceTimersByTimeAsync(5000);
  sync.dispose();await vi.advanceTimersByTimeAsync(20000);
  expect(signal?.aborted).toBe(true);expect(errors).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
});
it("boundedSignal: follows the parent, times out on its own, and clears",async()=>{
  const parent=new AbortController(),a=boundedSignal(parent.signal,1000);
  parent.abort();expect(a.signal.aborted).toBe(true);expect(a.timedOut()).toBe(false);a.clear();
  const b=boundedSignal(undefined,1000);await vi.advanceTimersByTimeAsync(1000);
  expect(b.signal.aborted).toBe(true);expect(b.timedOut()).toBe(true);expect(b.signal.reason).toBeInstanceOf(SyncTimeout);
  const c=boundedSignal(undefined,1000);c.clear();await vi.advanceTimersByTimeAsync(2000);expect(c.signal.aborted).toBe(false);
});
