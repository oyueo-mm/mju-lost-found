"use client";

import { useTransition } from "react";
import { KIND_CONFIG } from "@/lib/constants";
import { setPostStatus } from "@/lib/post-actions";

export default function MyPostStatusControl({ kind, id, status }) {
  const cfg = KIND_CONFIG[kind];
  const [pending, startTransition] = useTransition();

  return (
    <select
      value={status}
      disabled={pending}
      onChange={(e) =>
        startTransition(() => setPostStatus(kind, id, e.target.value))
      }
      className="shrink-0 rounded-lg border border-line bg-surface px-2 py-1 text-xs outline-none focus:border-brand"
    >
      {cfg.statuses.map((s) => (
        <option key={s} value={s}>
          {s}
        </option>
      ))}
    </select>
  );
}
