import type { ReactNode } from "react";

// Phase 17: the one empty-state look every list page shares (Lost, Found,
// Chat, My Posts, Matches, Notifications) -- replaces each page's own
// ad-hoc "아직 ~가 없습니다" <div>. `action` is optional because a few
// contexts (e.g. an empty search-result page) have no obvious single next
// step.
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-card border border-dashed border-border px-6 py-14 text-center">
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
