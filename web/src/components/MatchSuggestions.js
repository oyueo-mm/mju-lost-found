import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { KIND_CONFIG } from "@/lib/constants";
import { rankMatchesStrict } from "@/lib/matching";
import { locationDisplay } from "@/lib/campus";
import { getT } from "@/i18n/server";
import MatchConfirmButton from "./MatchConfirmButton";

// matching.js 가 돌려주는 한국어 사유 → 사전 키
const REASON_KEY = {
  "같은 카테고리": "match.sameCat",
  "다른 카테고리": "match.diffCat",
  "같은 장소": "match.samePlace",
  "다른 장소": "match.diffPlace",
  "시간대 일치": "match.timeOk",
  "시간 순서 안 맞음": "match.timeBad",
};
const reasonLabel = (t, r) => (REASON_KEY[r] ? t(REASON_KEY[r]) : r);

export default async function MatchSuggestions({ target, kind, canMatch }) {
  const cfg = KIND_CONFIG[kind];
  const oppCfg = KIND_CONFIG[cfg.opposite];
  const t = await getT();
  const oppItem = t(oppCfg.kind === "lost" ? "kind.lostItem" : "kind.foundItem");

  if (!target?.embedding) {
    return (
      <section>
        <p className="kicker text-brand">{t("detail.aiMatch", { kind: oppItem })}</p>
        <p className="mt-2 card p-5 text-sm text-ink-faint">{t("detail.analyzing")}</p>
      </section>
    );
  }

  const supabase = await createClient();
  let candQuery = supabase
    .from(oppCfg.table)
    .select("*, author:profiles!user_id(nickname)")
    .eq("status", oppCfg.defaultStatus)
    .not("embedding", "is", null)
    .limit(300);
  // 같은 캠퍼스끼리만 매칭
  if (target.campus) candQuery = candQuery.eq("campus", target.campus);
  const { data: candidates } = await candQuery;

  // 코사인 후보 → cross-encoder 재정렬 → 장소·카테고리·시간 가감 (까다롭게)
  const matches = await rankMatchesStrict(target, kind, candidates || []);

  return (
    <section>
      <p className="kicker text-brand">{t("detail.aiMatch", { kind: oppItem })}</p>

      {matches.length === 0 ? (
        <p className="mt-2 card p-5 text-center text-sm leading-relaxed text-ink-faint">
          {t("detail.noMatch", { kind: oppItem })}
          <br />
          {t(kind === "lost" ? "detail.noMatchLost" : "detail.noMatchFound")}
        </p>
      ) : (
        <div className="mt-2 card divide-y divide-line-soft overflow-hidden">
          {matches.map(({ post, score, reasons, warnings = [] }) => {
            const lostPostId = kind === "lost" ? target.id : post.id;
            const foundPostId = kind === "lost" ? post.id : target.id;
            const pct = Math.round(score * 100);
            return (
              <div key={post.id} className="flex items-start gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <Link
                      href={`/${oppCfg.kind}/${post.id}`}
                      className="min-w-0 flex-1 truncate text-[15px] font-semibold tracking-[-0.01em] hover:text-brand-strong"
                    >
                      {post.title}
                    </Link>
                    <span
                      className={`num chip shrink-0 ${
                        pct >= 80
                          ? "bg-brand text-white"
                          : "bg-brand-tint text-brand-deep"
                      }`}
                    >
                      {pct}%
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-1 text-[13px] text-ink-soft">
                    {post.description}
                  </p>
                  <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12px] text-ink-faint">
                    <span className="font-medium text-ink-soft">
                      {t(`cat.${post.category}`)}
                    </span>
                    <span aria-hidden>·</span>
                    <span>{locationDisplay(post.campus, post.location)}</span>
                    {reasons.map((r) => (
                      <span
                        key={r}
                        className="rounded bg-brand-tint px-1.5 py-px text-[10px] font-semibold text-brand-deep"
                      >
                        {reasonLabel(t, r)}
                      </span>
                    ))}
                    {warnings.map((w) => (
                      <span
                        key={w}
                        className="rounded bg-amber-tint px-1.5 py-px text-[10px] font-semibold text-amber-deep"
                      >
                        {reasonLabel(t, w)}
                      </span>
                    ))}
                  </p>
                </div>
                {canMatch && (
                  <MatchConfirmButton
                    lostPostId={lostPostId}
                    foundPostId={foundPostId}
                    score={score}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
