import {NextRequest,NextResponse} from "next/server";
import {auth} from "@/lib/auth/auth";
import {getCurrentUser} from "@/lib/auth/session";
import {issueChatRealtimeGrant} from "@/lib/chat/realtimeGrants";
import {rateLimitFailure,rateLimitFailureResponse} from "@/lib/rateLimit";
const headers={"Cache-Control":"private, no-store, max-age=0",Pragma:"no-cache",Vary:"Cookie"};
export const runtime="nodejs";
export async function POST(request:NextRequest,{params}:{params:Promise<{id:string}>}){
  const origin=request.headers.get("origin");
  // Same-origin browser POST only. No forwarded Host/origin re-call.
  if(!origin||origin!==request.nextUrl.origin||request.headers.get("sec-fetch-site")==="cross-site")return NextResponse.json({error:"Forbidden"},{status:403,headers});
  try{
    const user=await getCurrentUser();if(!user)return NextResponse.json({error:"Unauthorized"},{status:401,headers});
    const roomId=Number((await params).id);if(!Number.isSafeInteger(roomId)||roomId<1)return NextResponse.json({error:"Invalid room"},{status:400,headers});
    const session=await auth();
    if(!session?.realtimeSessionId||session.realtimeSessionNeedsRefresh)return NextResponse.json({code:"session_refresh_required"},{status:409,headers});
    if(String(user.id)!==session.user.id||!session.authExpiresAt)return NextResponse.json({error:"Unauthorized"},{status:401,headers});
    const issued=await issueChatRealtimeGrant(user,{id:session.realtimeSessionId,expiresAt:session.authExpiresAt},roomId);
    if(issued.kind==="polling")return new NextResponse(null,{status:204,headers});
    if(issued.kind==="limited"){
      const response=rateLimitFailureResponse(rateLimitFailure(issued.admission)!);for(const [key,value]of Object.entries(headers))response.headers.set(key,value);return response;
    }
    if(issued.kind!=="ok")return NextResponse.json({code:issued.kind==="forbidden"?"access_revoked":"realtime_unavailable"},{status:issued.kind==="forbidden"?403:503,headers});
    return NextResponse.json({token:issued.token,topic:issued.topic,expiresAt:issued.expiresAt,userId:user.id,roomId},{headers});
  }catch{return NextResponse.json({code:"realtime_unavailable"},{status:503,headers});}
}
