// Only run() can fetch/apply authorized state; events are hints, not data.
export function createChatSynchronizer(run:(signal:AbortSignal)=>Promise<void>,onError:(error:unknown)=>void,minDelay=300){
  let stopped=false,dirty=false,running=false,timer:ReturnType<typeof setTimeout>|undefined;
  let controller:AbortController|undefined;
  async function flush(){
    timer=undefined;if(stopped||running||!dirty)return;
    dirty=false;running=true;controller=new AbortController();
    try{await run(controller.signal);}catch(error){if(!stopped&&!controller.signal.aborted)onError(error);}
    finally{running=false;controller=undefined;if(!stopped&&dirty)schedule();}
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
