"use client";

import { useEffect } from "react";

import { browserStorage, sweepDrafts } from "@/lib/posts/postDraft";

// 임시저장 shared-PC cleanup, on every page of the main layout: signed out
// removes every post draft in this browser; signed in keeps only this
// account's (and drops its expired ones). Logging out ends on a page of
// this layout, so a draft never outlives the session that wrote it.
export function DraftJanitor({ userId }: { userId: number | null }) {
  useEffect(() => {
    sweepDrafts(browserStorage(), userId);
  }, [userId]);
  return null;
}
