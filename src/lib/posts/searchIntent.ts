// Cheap, conservative query routing. This never runs a model or changes q.
export function usesSemanticSearch(query: string | undefined): boolean {
  const text = query?.normalize("NFKC").trim().replace(/\s+/g, " ") ?? "";
  const length = Array.from(text.replace(/\s/g, "")).length;
  if (length < 18) return false;
  const words = text.split(" ");
  const koreanSentence = /(?:에서|근처에|잃어버렸|잃었|분실했|주웠|습득했|찾고\s*있|두고\s*왔|놓고\s*왔|입니다|있어요|같아요)/u.test(text);
  if (koreanSentence && (words.length >= 4 || /(?:잃어버렸|주웠|습득했|분실했|찾고있)/u.test(text))) return true;
  return length >= 28 && words.length >= 6 && /\b(?:I|my|lost|found|left|looking|dropped|someone)\b/i.test(text);
}

// Page functions must not import the ONNX service. Unified text searches
// use one API request so keyword misses can fall back without a second query.
export function needsSearchApi(mode: string | undefined, query: string | undefined): boolean {
  return mode === "semantic" || (mode === "unified" && Boolean(query?.trim()));
}
