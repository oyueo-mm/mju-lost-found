"use client";

import { createContext } from "react";

// Hero pagination can update its local query without navigating. Other
// lists continue to use their normal Next links.
export const SearchNavigationContext = createContext<{
  push: (href: string) => void;
} | null>(null);
