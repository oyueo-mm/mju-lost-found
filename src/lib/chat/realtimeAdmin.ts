import { getSupabaseAdminClient } from "@/lib/supabase/adminClient";
import { randomUUID } from "node:crypto";
import { currentChatRealtimeTopics, withAuthorizedChatRealtimeTopic } from "./realtimeGrants";

// Private receive-only grant topics. Admission RLS is cached by Realtime, so
// every dispatch rechecks the grant, session and current room membership under
// shared locks. Revocation serializes with bounded in-flight sends. Events
// remain content-free hints; message/read state is fetched through the API.
export type ChatBroadcastEvent =
  | { event: "message"; payload: { messageId: number } }
  | { event: "reaction"; payload: { messageId: number } }
  | { event: "read"; payload: { userId: number; lastReadMessageId: number } }
  // the room's post changed state (찾음 완료 / reopened): re-read the room
  | { event: "post_status"; payload: { postType: "lost" | "found"; postId: number } };

// Best-effort, matching every other "notify, but never let a failure here
// block the mutation that already succeeded" side effect in this app
// (embedPostBestEffort, deleteObjectSafely, ...). httpSend() -- not the
// implicit send()-without-subscribe fallback -- is used explicitly: this
// runs inside a Route Handler / Server Action, which never holds a live
// WebSocket connection, so REST delivery is the only mode that makes
// sense here; httpSend() is Supabase's own documented way to say that
// intent isn't a fallback.
export async function broadcastChatEvent(chatRoomId: number, event: ChatBroadcastEvent): Promise<void> {
  try {
    const payload={...event.payload,eventId:randomUUID()};
    const topics = await currentChatRealtimeTopics(chatRoomId);
    // Bound concurrent connections and authorization locks, not recipients.
    for(let i=0;i<topics.length;i+=4){
      const results=await Promise.allSettled(topics.slice(i,i+4).map(topic=>withAuthorizedChatRealtimeTopic(chatRoomId,topic,async()=>{
        const client=getSupabaseAdminClient();
        const channel=client.channel(topic,{config:{private:true}});
        try{await channel.httpSend(event.event,payload,{timeout:1500});}
        finally{await client.removeChannel(channel);}
      })));
      if(results.some(r=>r.status==="rejected"))console.error("Private chat delivery incomplete");
    }
  } catch (error) {
    console.error("Private chat broadcast unavailable:", error instanceof Error ? error.name : "Error");
  }
}
