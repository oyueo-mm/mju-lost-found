"use client";

import { Button } from "@/components/ui/Button";

const SELECT_CLASS =
  "rounded-lg border border-border bg-transparent px-3.5 py-2.5 text-sm text-foreground disabled:opacity-60";

type OrganizationOption = { organizationId: number; organizationName: string };

// Phase 12-8 §1: shared by PostForm.tsx (게시글) and CommentSection.tsx
// (댓글) -- both composers pick 게시 주체 through this exact same two-step
// UI now: a 개인/단체 toggle first, then (only once 단체 is selected) a
// dropdown of the current user's own ACTIVE-organization memberships. The
// option list itself is never built from client state -- both callers
// pass it straight through from a server-fetched myOrganizations prop
// (see PostForm's own comment on that prop).
export function PostAsSelector({
  organizations,
  value,
  onChange,
  disabled,
  // Phase 12-7's edit-mode fallback, carried over unchanged: when editing
  // a post/comment currently attributed to an organization the user is no
  // longer an ACTIVE member of, this still shows it as a distinct,
  // selectable-back-to option instead of silently losing track of it --
  // see PostForm's own comment for the full rationale.
  currentOrganizationIfUnlisted,
  ariaLabel = "게시 주체 선택",
}: {
  organizations: OrganizationOption[];
  value: number | null;
  onChange: (organizationId: number | null) => void;
  disabled?: boolean;
  currentOrganizationIfUnlisted?: OrganizationOption | null;
  ariaLabel?: string;
}) {
  const options =
    currentOrganizationIfUnlisted &&
    !organizations.some((org) => org.organizationId === currentOrganizationIfUnlisted.organizationId)
      ? [...organizations, currentOrganizationIfUnlisted]
      : organizations;

  // No ACTIVE membership at all (and, in edit mode, no dangling current
  // attribution either) -- nothing to choose from, so the toggle itself
  // is pointless to show; the composer stays exactly as it was before
  // this phase (개인 only, no selector).
  if (options.length === 0) return null;

  const mode = value === null ? "personal" : "organization";

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1.5" role="group" aria-label={ariaLabel}>
        <Button
          type="button"
          variant={mode === "personal" ? "primary" : "secondary"}
          size="sm"
          aria-pressed={mode === "personal"}
          disabled={disabled}
          onClick={() => onChange(null)}
          className="h-8 px-3 text-xs"
        >
          개인
        </Button>
        <Button
          type="button"
          variant={mode === "organization" ? "primary" : "secondary"}
          size="sm"
          aria-pressed={mode === "organization"}
          disabled={disabled}
          onClick={() => onChange(value ?? options[0].organizationId)}
          className="h-8 px-3 text-xs"
        >
          단체
        </Button>
      </div>
      {mode === "organization" && (
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-muted-foreground">대표 단체</span>
          <select
            value={value ?? options[0].organizationId}
            onChange={(e) => onChange(Number(e.target.value))}
            disabled={disabled}
            className={SELECT_CLASS}
          >
            {options.map((org) => (
              <option key={org.organizationId} value={org.organizationId}>
                {org.organizationName}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}
