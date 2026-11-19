"use client";
import {useCallback,useEffect,useRef} from "react";
import {createChatRealtimeClient} from "@/lib/supabase/realtimeBrowser";
import {ChatAccessRevoked,createChatSynchronizer,validReadHint,type ReadCursor} from "./synchronizer";

// A 204 (polling mode) Retry-After, clamped so a bad header can neither
// hammer the token API nor park the tab in polling for good.
export function pollingRecheckMs(retryAfter:string|null):number{
  const seconds=Number(retryAfter);
  return (Number.isFinite(seconds)&&seconds>0?Math.min(600,Math.max(30,seconds)):120)*1000;
}

type Handlers={
  sync:(signal:AbortSignal)=>Promise<ReadCursor[]>;
  identityChanged:()=>void;
  pollingChanged:(polling:boolean)=>void;
};
export function useChatRoomRealtime(chatRoomId:number,currentUserId:number,handlers:Handlers):()=>void{
  const handlersRef=useRef(handlers);useEffect(()=>{handlersRef.current=handlers;});
  const invalidateRef=useRef<()=>void>(()=>{});
  const invalidate=useCallback(()=>invalidateRef.current(),[]);
  useEffect(()=>{
    let disposed=false,denied=false,connected=false,retryAt=0,failures=0;
    let client:ReturnType<typeof createChatRealtimeClient>|undefined;
    let poll:ReturnType<typeof setTimeout>|undefined,renew:ReturnType<typeof setTimeout>|undefined;
    let request:AbortController|undefined,connecting=false;
    // Canary-room only: report state changes (fixed words, no content) so a
    // silent tab can be told apart from a failing one in the server logs.
    let diag=false;
    const report=(event:string)=>{if(!diag)return;void fetch('/api/chat/'+chatRoomId+'/realtime',{method:"POST",credentials:"same-origin",cache:"no-store",keepalive:true,headers:{"x-mju-realtime-diag":event}}).catch(()=>{});};
    const confirmed=new Map<number,number>(),seen=new Set<string>();
    const sync=createChatSynchronizer(async signal=>{
      if(document.visibilityState!=="visible")return;
      const cursors=await handlersRef.current.sync(signal);
      for(const c of cursors)if(validReadHint(c))confirmed.set(c.userId,Math.max(confirmed.get(c.userId)??0,c.lastReadMessageId));
      failures=0;
    },error=>{if(error instanceof ChatAccessRevoked){denied=true;handlersRef.current.pollingChanged(false);void stopTransport();return;}failures=Math.min(failures+1,3);});
    invalidateRef.current=()=>sync.invalidate();
    async function stopTransport(abortRequest=true){connected=false;if(abortRequest)request?.abort();if(renew)clearTimeout(renew);const old=client;client=undefined;try{await old?.disconnect();}catch{/* API polling remains available when socket teardown fails. */}}
    function schedulePoll(reset=false){
      if(reset&&poll){clearTimeout(poll);poll=undefined;}
      if(poll||disposed||denied||document.visibilityState!=="visible")return;
      const delay=connected?60000:Math.min(30000,10000*2**failures);
      poll=setTimeout(()=>{poll=undefined;if(disposed||denied)return;sync.invalidate();if(!connected&&Date.now()>=retryAt)void connect();schedulePoll();},delay);
    }
    function enterPolling(reason:"mode"|"token"|"transport"|"error"="error"){
      const wasConnected=connected;
      if(!denied)report("polling-"+reason);
      connected=false;
      handlersRef.current.pollingChanged(!denied);
      if(wasConnected&&!denied)sync.invalidate(true);
      // Repeated join errors must not push the next API refresh into the future.
      schedulePoll(wasConnected);
    }
    function hint(event:string,payload:unknown){
      if(disposed||denied||document.visibilityState!=="visible"||!payload||typeof payload!=="object")return;
      const data=payload as Record<string,unknown>;
      if(typeof data.eventId!=="string"||!/^[0-9a-f-]{36}$/i.test(data.eventId))return;
      if(seen.has(data.eventId))return;seen.add(data.eventId);if(seen.size>128)seen.delete(seen.values().next().value!);
      if(event==="read"){
        if(!validReadHint(payload)||payload.userId===currentUserId||payload.lastReadMessageId<=(confirmed.get(payload.userId)??0))return;
      }else if(event!=="post_status"&&(!Number.isSafeInteger(data.messageId)||Number(data.messageId)<1))return;
      // A forged high cursor is never remembered. Only API results confirm it.
      sync.invalidate();
    }
    let lastTokenOutcome:"mode"|"token"="token";
    async function fetchToken(signal:AbortSignal,refresh=true):Promise<{token:string;topic:string;expiresAt:string;receiptEnabled?:boolean}|null>{
      lastTokenOutcome="token";
      const response=await fetch('/api/chat/'+chatRoomId+'/realtime',{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},cache:"no-store",signal});
      // Deliberate polling mode: no token now. Re-check at the server's pace
      // (Retry-After, bounded) so the tab joins once private mode is enabled,
      // without a reload. Foreground/network changes also re-check at once.
      if(response.status===204){lastTokenOutcome="mode";retryAt=Date.now()+pollingRecheckMs(response.headers.get("retry-after"));return null;}
      if(response.status===409&&refresh){await fetch("/api/auth/session",{credentials:"same-origin",cache:"no-store",signal});return fetchToken(signal,false);}
      if(response.status===401||response.status===403||response.status===404){
        // A 404 can be the polling-compatible rollback; never use public RT.
        if(response.status!==404){denied=true;sync.invalidate(true);}return null;
      }
      if(!response.ok){retryAt=Date.now()+Math.max(30000,Number(response.headers.get("retry-after")??0)*1000);return null;}
      const value=await response.json();
      if(value.userId!==currentUserId||value.roomId!==chatRoomId){denied=true;handlersRef.current.identityChanged();return null;}
      if(typeof value.token!=="string"||typeof value.topic!=="string"||!/^mju-chat:[0-9a-f-]{36}$/i.test(value.topic)||!Number.isFinite(Date.parse(value.expiresAt)))return null;
      if(Date.parse(value.expiresAt)<=Date.now()+5000)return null;
      retryAt=0;
      if(value.receiptEnabled===true)diag=true;
      return value;
    }
    async function connect(){
      if(disposed||denied||connecting||document.visibilityState!=="visible")return;connecting=true;
      request?.abort();request=new AbortController();const signal=request.signal;
      try{
        const token=await fetchToken(signal);if(disposed||signal.aborted)return;
        if(!token){enterPolling(lastTokenOutcome);await stopTransport(false);return;}
        const old=client;client=undefined;await old?.disconnect();if(disposed||signal.aborted)return;
        const transport=createChatRealtimeClient();client=transport;
        await transport.setAuth(token.token);if(disposed||signal.aborted){await transport.disconnect();return;}
        let channel=transport.channel(token.topic,{config:{private:true}});
        for(const event of ["message","reaction","read","post_status"])channel=channel.on("broadcast",{event},({payload})=>hint(event,payload));
        if(token.receiptEnabled===true){
          const receipts=new Set<string>();
          channel=channel.on("broadcast",{event:"transport_control"},({payload})=>{
            const nonce=payload?.nonce;
            if(disposed||denied||client!==transport||!connected||typeof nonce!=="string"||!/^[0-9a-f-]{36}$/i.test(nonce)||receipts.has(nonce)||receipts.size>=4)return;
            receipts.add(nonce);
            void fetch('/api/chat/'+chatRoomId+'/realtime',{method:"POST",credentials:"same-origin",headers:{"x-mju-realtime-receipt":nonce},cache:"no-store",signal}).catch(()=>{});
          });
        }
        function transportFailed(){
          if(disposed||client!==transport)return;
          retryAt=Date.now()+30000;
          enterPolling("transport");
          void stopTransport(false);
        }
        transport.onHeartbeat(status=>{
          if(["timeout","error","disconnected"].includes(status))transportFailed();
        });
        channel.subscribe(status=>{
          if(disposed||client!==transport)return;
          if(status==="SUBSCRIBED"){
            connected=true;
            report("subscribed");
            handlersRef.current.pollingChanged(false);
            sync.invalidate(true);
            failures=0;
            schedulePoll(true);
          }else if(["CHANNEL_ERROR","TIMED_OUT","CLOSED"].includes(status)){
            transportFailed();
          }
        });
        if(renew)clearTimeout(renew);
        renew=setTimeout(()=>{void connect();},Math.max(1000,Date.parse(token.expiresAt)-Date.now()-30000));
      }catch{if(!signal.aborted){retryAt=Date.now()+30000;enterPolling();await stopTransport(false);}}
      finally{connecting=false;schedulePoll();if(signal.aborted&&!disposed&&!denied&&document.visibilityState==="visible")void connect();}
    }
    function visible(){
      report((document.visibilityState==="visible"?"visible-":"hidden-")+(connected?"connected":"polling"));
      if(document.visibilityState==="visible"){denied=false;sync.invalidate(true);void connect();schedulePoll();}
      else{if(poll){clearTimeout(poll);poll=undefined;}sync.cancel();void stopTransport();}
    }
    visible();document.addEventListener("visibilitychange",visible);window.addEventListener("online",visible);
    return()=>{disposed=true;invalidateRef.current=()=>{};sync.dispose();if(poll)clearTimeout(poll);if(renew)clearTimeout(renew);document.removeEventListener("visibilitychange",visible);window.removeEventListener("online",visible);void stopTransport();};
  },[chatRoomId,currentUserId]);
  return invalidate;
}
