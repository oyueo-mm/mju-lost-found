// Only run() can fetch/apply authorized state; events are hints, not data.
//
// Every run is bounded (2026-11-21): a request the server or network never
// answers used to keep `running` true forever, so that tab stopped syncing
// until a reload (seen in the polling regression, before and after P-3).
// After timeoutMs the run's signal is aborted (the fetch rejects and nothing
// is applied), onError gets a SyncTimeout (so polling backs off like any
// failure), and a refresh requested meanwhile runs right after. cancel()
// and dispose() still abort silently.
export const SYNC_TIMEOUT_MS=15000;
export class SyncTimeout extends Error {constructor(){super("Chat sync timed out");this.name="SyncTimeout";}}

/**
 * An AbortSignal that aborts with the parent or after `ms`, whichever comes
 * first (AbortSignal.any is missing on older iOS Safari). Call clear() when
 * the work is done so no timer is left behind.
 */
export function boundedSignal(parent:AbortSignal|undefined,ms:number):{signal:AbortSignal;clear:()=>void;timedOut:()=>boolean}{
  const controller=new AbortController();let expired=false;
  const onAbort=()=>controller.abort(parent?.reason);
  if(parent?.aborted)controller.abort(parent.reason);else parent?.addEventListener("abort",onAbort,{once:true});
  const timer=setTimeout(()=>{expired=true;controller.abort(new SyncTimeout());},ms);
  return {signal:controller.signal,timedOut:()=>expired,clear(){clearTimeout(timer);parent?.removeEventListener("abort",onAbort);}};
}

export function createChatSynchronizer(run:(signal:AbortSignal)=>Promise<void>,onError:(error:unknown)=>void,minDelay=300,timeoutMs=SYNC_TIMEOUT_MS){
  let stopped=false,dirty=false,running=false,timer:ReturnType<typeof setTimeout>|undefined;
  let controller:AbortController|undefined;
  async function flush(){
    timer=undefined;if(stopped||running||!dirty)return;
    dirty=false;running=true;const own=new AbortController();controller=own;
    const bounded=boundedSignal(own.signal,timeoutMs);
    try{
      // The run may ignore its signal; the race still frees the synchronizer.
      await new Promise<void>((resolve,reject)=>{
        bounded.signal.addEventListener("abort",()=>reject(bounded.signal.reason),{once:true});
        run(bounded.signal).then(resolve,reject);
      });
    }catch(error){
      if(stopped||own.signal.aborted){/* cancel()/dispose(): silent */}
      else onError(bounded.timedOut()?new SyncTimeout():error);
    }
    finally{bounded.clear();running=false;if(controller===own)controller=undefined;if(!stopped&&dirty)schedule();}
  }
  function schedule(delay=minDelay){if(!running&&!timer&&!stopped)timer=setTimeout(()=>{void flush();},delay);}
  return {
    invalidate(immediate=false){if(stopped)return;dirty=true;schedule(immediate?0:minDelay);},
    cancel(){dirty=false;if(timer){clearTimeout(timer);timer=undefined;}controller?.abort();},
    dispose(){stopped=true;dirty=false;if(timer)clearTimeout(timer);controller?.abort();},
  };
}
export type ReadCursor={userId:number;lastReadMessageId:number};
export class ChatAccessRevoked extends Error {constructor(){super("Chat access revoked");this.name="ChatAccessRevoked";}}
export function validReadHint(payload:unknown):payload is ReadCursor{
  if(!payload||typeof payload!=="object")return false;
  const value=payload as Record<string,unknown>;
  return Number.isSafeInteger(value.userId)&&Number(value.userId)>0&&Number.isSafeInteger(value.lastReadMessageId)&&Number(value.lastReadMessageId)>=0;
}
