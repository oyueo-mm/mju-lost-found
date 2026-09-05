/**
 * 백엔드 호출 헬퍼.
 *
 * 프론트와 API 가 같은 도메인에서 서빙되므로 항상 상대 경로("/api/...")만 쓴다.
 * 개발 중에는 vite.config.js 의 proxy 가, 배포에서는 Express 가 직접 처리한다.
 * 그래서 이 파일 어디에도 호스트 주소가 하드코딩돼 있지 않다.
 */

/** 서버가 내려준 error 메시지를 그대로 담아 던지는 에러. status 로 401/403 구분이 가능하다. */
export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function parse(res) {
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // 서버가 JSON 이 아닌 응답(예: 프록시 오류 HTML)을 준 경우
    throw new ApiError('서버 응답을 이해할 수 없습니다.', res.status);
  }
  if (!res.ok) throw new ApiError(body?.error || '요청을 처리하지 못했습니다.', res.status);
  return body;
}

export function get(path) {
  return fetch(path, { credentials: 'same-origin' }).then(parse);
}

export function send(path, method, body) {
  return fetch(path, {
    method,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  }).then(parse);
}

export const post = (path, body) => send(path, 'POST', body);
export const patch = (path, body) => send(path, 'PATCH', body);
export const del = (path) => send(path, 'DELETE');

/**
 * 파일이 섞인 폼 전송. Content-Type 을 직접 지정하면 안 된다 --
 * 브라우저가 multipart 경계 문자열을 포함해 자동으로 붙여줘야 한다.
 */
export function sendForm(path, method, formData) {
  return fetch(path, { method, credentials: 'same-origin', body: formData }).then(parse);
}

/** 쿼리스트링 만들기. 값이 비었거나 "전체"면 아예 파라미터를 넣지 않는다. */
export function qs(params) {
  const usp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '' || value === '전체') continue;
    usp.set(key, String(value));
  }
  const s = usp.toString();
  return s ? `?${s}` : '';
}
