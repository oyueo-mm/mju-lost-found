import { NextRequest } from "next/server";

import { jsonError, jsonOk, withErrorHandling } from "@/lib/posts/http";
import { postTypeSchema } from "@/lib/posts/schema";
import { findSimilarPostsByImageForDisplay } from "@/lib/posts/aiService";

// GET /api/posts/[id]/similar-images?type=lost|found
//
// Public, no auth gate -- same policy as the rest of this app's read
// paths (posts/service.ts) and identical to how this call used to be made
// in-process from the post detail page's own server render before this
// change. Moved behind a button click (ImageSimilaritySection.tsx) so a
// plain page visit no longer runs a real SigLIP image-embedding vector
// search unconditionally -- see this phase's report for why. AI logic and
// accuracy are unchanged: this route calls the exact same
// findSimilarPostsByImageForDisplay() the page used to call directly.
export const runtime = "nodejs";

export const GET = withErrorHandling(
  async (request: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id: idParam } = await params;
    const id = Number(idParam);
    const typeResult = postTypeSchema.safeParse(request.nextUrl.searchParams.get("type"));
    if (!Number.isInteger(id) || !typeResult.success) {
      return jsonError(400, "id와 type('lost' 또는 'found')이 올바르지 않습니다.");
    }

    const data = await findSimilarPostsByImageForDisplay(typeResult.data, id);
    return jsonOk(data);
  },
);
