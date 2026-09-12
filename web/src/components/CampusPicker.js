import Link from "next/link";
import { CAMPUSES } from "@/lib/campus";
import { KIND_CONFIG } from "@/lib/constants";
import Icon from "./Icon";

// 분실/습득 게시판 진입 시 캠퍼스 먼저 고르기.
export default function CampusPicker({ kind, basePath }) {
  const cfg = KIND_CONFIG[kind];
  return (
    <div>
      <h1 className="text-xl font-extrabold">{cfg.label} 게시판</h1>
      <p className="mt-1.5 text-sm text-ink-soft">
        먼저 캠퍼스를 선택하세요. 캠퍼스별로 게시글과 장소가 분리돼요.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {Object.values(CAMPUSES).map((c) => (
          <Link
            key={c.key}
            href={`${basePath}?campus=${c.key}`}
            className="card flex items-center justify-between p-5 transition hover:border-brand-soft"
          >
            <div>
              <p className="text-lg font-extrabold">{c.label}</p>
              <p className="mt-0.5 text-sm text-ink-faint">{c.city}</p>
            </div>
            <Icon name="arrowRight" size={20} className="text-brand" />
          </Link>
        ))}
      </div>
    </div>
  );
}
