// 구글 계정 표시이름에서 학과/소속 추출.
// 예: "윤성민/학생/인공지능·소프트웨어융합대학" -> "인공지능·소프트웨어융합대학"
export function majorFromName(name) {
  if (!name || typeof name !== "string") return null;
  const parts = name
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length < 2) return null;
  const last = parts[parts.length - 1];
  // 마지막 조각이 신분(학생/교수/직원)뿐이면 그 앞 조각 사용
  if (/^(학생|교수|직원|조교|연구원)$/.test(last) && parts.length >= 3) {
    return parts[parts.length - 2];
  }
  return last;
}
