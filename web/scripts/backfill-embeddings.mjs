// 실행: node --env-file=.env.local scripts/backfill-embeddings.mjs [--all]
// embedding 이 비어 있는 (또는 --all 이면 모든) 게시글의 벡터를 채운다.
import { createClient } from "@supabase/supabase-js";
import { embed } from "./_embed.mjs";

const s = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
);
const forceAll = process.argv.includes("--all");

let done = 0;
for (const table of ["lost_posts", "found_posts"]) {
  const { data, error } = await s
    .from(table)
    .select("id, title, description, category, location, embedding");
  if (error) {
    console.error(table, error.message);
    continue;
  }
  for (const p of data ?? []) {
    if (p.embedding && !forceAll) continue;
    const text = [p.title, p.description, p.category, p.location]
      .filter(Boolean)
      .join(" ");
    const vec = await embed(text);
    const { error: upErr } = await s
      .from(table)
      .update({ embedding: vec })
      .eq("id", p.id);
    console.log(table, p.id, upErr ? `실패: ${upErr.message}` : `완료 (${vec.length}d)`);
    if (!upErr) done++;
  }
}
console.log(`\n총 ${done}건 임베딩 완료`);
