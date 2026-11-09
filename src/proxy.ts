import { NextResponse, type NextRequest } from "next/server";
import { gateReturnPath, LANDING_HEADER } from "@/lib/metrics/landing";

// Layouts have no searchParams. Pass a validated return path upstream so
// the parent consent/nickname gate agrees with the registration page.
export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  headers.delete(LANDING_HEADER);
  const returnPath = gateReturnPath(request.nextUrl.pathname + request.nextUrl.search);
  if (returnPath) headers.set(LANDING_HEADER, returnPath);
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: ["/found/new", "/lost/new", "/me/identity"] };
