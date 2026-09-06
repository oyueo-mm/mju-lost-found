"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { SearchIcon } from "@/components/icons";

// Phase 17: Home's hero search -- deliberately simple (query text only,
// no mode/category/status controls) since its job is a fast first
// interaction, not replacing /search's full SearchFilterBar (which every
// board's own page already has). Submitting just navigates to /search?q=…
// -- the existing keyword-search path (searchPosts()); this component
// never calls any search API itself and the search algorithm is
// unchanged.
export function HomeSearchBar() {
  const router = useRouter();
  const [value, setValue] = useState("");

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const q = value.trim();
    router.push(q ? `/search?q=${encodeURIComponent(q)}` : "/search");
  }

  return (
    <form onSubmit={handleSubmit} className="w-full">
      <div className="flex items-center gap-2 rounded-full border border-border bg-card px-4 py-3 shadow-sm transition-colors focus-within:border-primary">
        <SearchIcon className="size-5 shrink-0 text-muted-foreground" />
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="에어팟, 지갑, 학생증 등을 검색해보세요"
          maxLength={100}
          aria-label="분실물·습득물 검색"
          className="w-full min-w-0 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
        />
        <button
          type="submit"
          className="shrink-0 rounded-full bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          검색
        </button>
      </div>
    </form>
  );
}
