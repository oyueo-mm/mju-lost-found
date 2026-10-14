import type { CSSProperties } from "react";

// Start delay for one part of a landing demo (see the "Landing demos" block
// in globals.css): parts of a mockup play in sequence after their section
// is revealed.
export function demoDelay(ms: number): CSSProperties {
  return { "--demo-delay": `${ms}ms` } as CSSProperties;
}
