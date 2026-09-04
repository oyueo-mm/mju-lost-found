// Next.js page `searchParams` values can be a string, an array (repeated
// query keys), or absent -- this project's search/filter params are all
// single-value, so this just picks the first occurrence and drops
// anything else, giving zod a plain Record<string, string> to parse.
export function normalizeSearchParams(
  raw: Record<string, string | string[] | undefined>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "string") result[key] = value;
    else if (Array.isArray(value) && value.length > 0) result[key] = value[0];
  }
  return result;
}
