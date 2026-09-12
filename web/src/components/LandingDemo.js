import Icon from "./Icon";

// 랜딩용 정적 목업. 실제 검색 결과 카드와 같은 토큰·간격을 쓴다.
// 데이터는 예시 — 로그인 전에도 "제품이 이렇게 생겼다"를 보여주는 용도.
// t 는 서버에서 만든 번역 함수를 props 로 받는다.

function ResultRow({ title, meta, pct, kindLabel }) {
  return (
    <li className="flex items-center gap-3 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="chip shrink-0 bg-amber-tint text-amber-deep">{kindLabel}</span>
          <p className="truncate text-[13px] font-semibold">{title}</p>
        </div>
        <p className="mt-0.5 text-xs text-ink-faint">{meta}</p>
      </div>
      <span className="num chip shrink-0 bg-brand-tint text-brand-deep">{pct}%</span>
    </li>
  );
}

function DemoHeader({ icon, label, preview }) {
  return (
    <div className="flex items-center gap-2 border-b border-line-soft px-4 py-2.5">
      <Icon name={icon} size={14} className="text-brand" />
      <span className="text-xs font-bold">{label}</span>
      <span className="ml-auto text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
        {preview}
      </span>
    </div>
  );
}

export function SearchDemo({ t }) {
  const found = t("kind.found");
  return (
    <div className="card overflow-hidden">
      <DemoHeader icon="sparkle" label={t("demo.aiSearch")} preview={t("demo.preview")} />

      <div className="px-4 pt-4">
        <div className="flex items-center gap-2 rounded-lg border border-line bg-sunken px-3 py-2.5 text-[13px]">
          <Icon name="search" size={15} className="shrink-0 text-ink-faint" />
          <span className="min-w-0 truncate">{t("demo.query")}</span>
        </div>
      </div>

      <ul className="divide-y divide-line-soft px-4 pt-2">
        <ResultRow title={t("demo.r1.title")} meta={t("demo.r1.meta")} pct={92} kindLabel={found} />
        <ResultRow title={t("demo.r2.title")} meta={t("demo.r2.meta")} pct={78} kindLabel={found} />
      </ul>

      <p className="border-t border-line-soft px-4 py-2.5 text-[11px] leading-relaxed text-ink-faint">
        {t("demo.note")}
      </p>
    </div>
  );
}

export function ImageDemo({ t }) {
  const found = t("kind.found");
  const tags = t("demo.tags")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  return (
    <div className="card overflow-hidden md:grid md:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
      {/* 업로드 영역 */}
      <div className="flex flex-col border-b border-line-soft md:border-b-0 md:border-r">
        <DemoHeader icon="camera" label={t("demo.imageSearch")} preview={t("demo.preview")} />
        <div className="flex flex-1 items-center justify-center p-4">
          <div className="flex w-full flex-col items-center gap-2 rounded-lg border-[1.5px] border-dashed border-line py-8 text-center">
            <span className="grid h-10 w-10 place-items-center rounded-full bg-brand-tint text-brand">
              <Icon name="image" size={18} />
            </span>
            <p className="text-sm font-semibold">{t("demo.pick")}</p>
            <p className="text-[11px] text-ink-faint">{t("demo.pickHint")}</p>
          </div>
        </div>
      </div>

      {/* 결과 영역 */}
      <div>
        <div className="border-b border-line-soft px-4 py-3">
          <p className="kicker">{t("demo.aiRead")}</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <span key={tag} className="chip bg-sunken text-ink-soft">
                {tag}
              </span>
            ))}
          </div>
        </div>
        <ul className="divide-y divide-line-soft px-4">
          <ResultRow title={t("demo.i1.title")} meta={t("demo.i1.meta")} pct={89} kindLabel={found} />
          <ResultRow title={t("demo.i2.title")} meta={t("demo.i2.meta")} pct={74} kindLabel={found} />
        </ul>
      </div>
    </div>
  );
}
