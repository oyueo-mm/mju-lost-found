/**
 * 세션 쿠키 설정.
 *
 * 서버 메모리에 세션을 두지 않고 서명된 쿠키에 담는다. 그래서 Railway 가
 * 컨테이너를 재시작해도 로그인이 풀리지 않는다. 쿠키에는 user id 만 들어가고,
 * 권한/정지/관리자 여부는 매 요청마다 DB에서 다시 읽는다 (BE/auth.js 참고).
 */
import cookieSession from 'cookie-session';

const isProduction = process.env.NODE_ENV === 'production';

const SESSION_SECRET = process.env.SESSION_SECRET
  || (isProduction
    // 배포에서 시크릿이 없으면 재시작할 때마다 전원 로그아웃되므로 차라리 즉시 실패시킨다.
    ? (() => { throw new Error('SESSION_SECRET 환경변수를 설정해주세요. (Railway Variables)'); })()
    : 'dev-only-insecure-secret');

export const sessionMiddleware = cookieSession({
  name: 'mju_lf_session',
  keys: [SESSION_SECRET],
  maxAge: 14 * 24 * 60 * 60 * 1000, // 2주
  httpOnly: true,
  sameSite: 'lax',
  secure: isProduction,
});
