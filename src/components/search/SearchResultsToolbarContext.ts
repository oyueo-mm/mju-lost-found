"use client";

import { createContext, type ReactNode } from "react";

// Place the result count beside the form's sort control without moving
// search requests or duplicating result state in the filter component.
export const SearchResultsToolbarContext = createContext<((count?: number) => ReactNode) | null>(null);
