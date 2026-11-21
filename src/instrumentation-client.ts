// D-4 CSP: Zod 4 probes for JIT support with `Function("")` the first time it
// parses an object, which a CSP without 'unsafe-eval' reports (and blocks) on
// every page that validates input in the browser. The probe is caught and Zod
// falls back to its interpreter, so nothing breaks -- but it would flood
// Report-Only results and hide real violations. Opt out of the probe (and the
// JIT) before any app code runs. Server-side parsing is unaffected.
import { z } from "zod";

z.config({ jitless: true });
