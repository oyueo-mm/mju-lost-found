// Deliberately no DB writes in the local search/quality harness.
export const calls = { text: 0, image: 0 };
export function recordDaily() {}
export async function timed<T>(name: string, operation: () => Promise<T>): Promise<T> {
  if (name === "ai:text-embed") calls.text++;
  if (name === "ai:image-embed") calls.image++;
  return operation();
}
