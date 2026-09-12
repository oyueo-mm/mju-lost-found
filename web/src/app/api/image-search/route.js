import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { describeImage } from "@/lib/embedding";
import { semanticOnly } from "@/lib/search";

export const maxDuration = 60;

export async function POST(request) {
  await requireUser();

  const form = await request.formData();
  const file = form.get("image");
  if (!file || typeof file === "string" || file.size === 0) {
    return NextResponse.json({ error: "이미지를 선택해 주세요." }, { status: 400 });
  }
  if (file.size > 5 * 1024 * 1024) {
    return NextResponse.json({ error: "이미지는 5MB 이하만 가능해요." }, { status: 400 });
  }

  let description;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    description = await describeImage(bytes);
  } catch {
    return NextResponse.json(
      { error: "이미지 분석에 실패했어요. 잠시 후 다시 시도해 주세요." },
      { status: 502 },
    );
  }
  if (!description) {
    return NextResponse.json({ error: "이미지에서 물건을 인식하지 못했어요." }, { status: 422 });
  }

  const supabase = await createClient();
  const results = await semanticOnly(supabase, {
    q: description,
    board: form.get("board") || "all",
    campus: form.get("campus") || "",
  });

  if (results && !Array.isArray(results) && results.error) {
    return NextResponse.json({ description, results: [], warning: results.error });
  }

  return NextResponse.json({
    description,
    results: (Array.isArray(results) ? results : []).map((r) => ({
      kind: r.kind,
      score: r.score,
      pct: r.pct,
      post: r.post,
    })),
  });
}
