# XSS·CSRF 종합 감사 (2026-11-21)

- 범위: `src/` 전체 코드 정적 점검과 Production 읽기 전용 실측(쿠키 속성, 교차 출처 POST 1건). 코드 변경 없음.
- 기준 커밋: `5711719`(현재 Production `dpl_6rutg8AmJikkZPacLL5stQwRD8wE`, CSP Report-Only).
- 분류: **실제 취약점**(지금 악용 가능)과 **잠재 위험**(다른 방어가 뚫리거나 조건이 바뀌면 문제)을 구분한다.

## 결론

| 구분 | 결과 |
|---|---|
| 실제 XSS 취약점 | **없음** |
| 실제 CSRF 취약점 | **없음** |
| 잠재 위험 | 4건(아래 표). 모두 낮음~중간, 즉시 조치 필요 없음 |

## 1. XSS

### 확인한 HTML 싱크 (`dangerouslySetInnerHTML`, `innerHTML`, `eval`, `new Function`, `document.write`)

| 위치 | 내용 | 사용자 입력 | 판정 |
|---|---|---|---|
| `src/app/layout.tsx` 인라인 스크립트 3개 | 테마·게시판 보기·개인정보 공지 초기화. 함수가 고정 문자열을 반환 | 없음(공지 시행일 상수만) | 안전 |
| `src/app/(main)/page.tsx` JSON-LD | 상수 객체, `<`를 `<`로 이스케이프 | 없음 | 안전 |
| `src/app/(policy)/policy/*/history/*` 6개 | 저장소의 정책 보관본 JSON(`src/lib/policy/archives/`) | 없음(빌드 시 고정) | 안전 |
| `new Function` | 테스트 파일에서만 사용 | - | 해당 없음 |

- 게시글·댓글·채팅·신고·닉네임 등 사용자 텍스트는 모두 React 텍스트 노드로 출력된다(자동 이스케이프). 본문 URL 자동 링크화(linkify)도 없다.
- React 19.2.8은 `href`의 `javascript:` URL을 차단한다. Next 16.4.6 / React 19.2.8은 2025-12 RSC 원격 코드 실행 취약점(React2Shell) 수정 버전 이후다.

### 리다이렉트·URL
- `callbackUrl`: `sanitizeCallbackUrl`(`src/lib/auth/callbackUrl.ts`)이 `/` 하나로 시작하는 상대 경로만 허용한다. `//`, `://`, 역슬래시, 제어 문자는 거부한다. 로그인·온보딩·실명 정보·동의 화면 모두 이 함수를 거친다. Auth.js `redirect` 콜백은 기본값(같은 출처만)이다.
- 서비스 워커(`public/sw.js`): 푸시 URL은 `/chat`으로 시작할 때만 쓰고, 클릭 시 같은 출처 창만 이동한다.
- 신고 증거 사진 프록시: 원본 Content-Type이 jpeg/png/webp일 때만 전달하고 `nosniff`를 붙인다.
- 채팅 사진: Supabase 서명 URL로 302. 사용자 파일은 우리 출처에서 제공되지 않는다.

### 업로드
- 업로드 서명 발급 시 Content-Type을 jpeg/png/webp로 제한하고, 버킷도 같은 MIME과 10MB로 제한된다.
- 파일은 Supabase 도메인에서 제공된다. 우리 출처(`mju-find.vercel.app`)에서 HTML/SVG로 해석될 경로가 없어 저장형 XSS로 이어지지 않는다.

## 2. CSRF

### 실측 (Production, 2026-11-21)
- `GET /api/auth/csrf` 응답 쿠키: `__Host-authjs.csrf-token`, `__Secure-authjs.callback-url` 모두 `HttpOnly; Secure; SameSite=Lax`. 세션 쿠키도 Auth.js 기본값(`__Secure-authjs.session-token`, `SameSite=Lax`)이다. 쿠키 설정을 바꾸는 코드는 없다.
- `POST /api/posts`에 `Origin: https://evil.example`, 쿠키 없음 → 401.

### 판정 근거
- 상태 변경 API는 모두 POST/PUT/PATCH/DELETE다(34개 라우트 확인). `SameSite=Lax` 쿠키는 교차 사이트 POST·fetch에 실리지 않으므로 세션 없이 401이 된다.
- `vercel.app`은 Public Suffix List에 있어 다른 `*.vercel.app` 사이트도 교차 사이트로 취급된다.
- Server Actions(`"use server"` 파일 31개): Next가 `Origin`과 `Host`를 비교해 다르면 거부한다. `serverActions.allowedOrigins` 확장 설정이 없다.
- Auth.js 로그인·로그아웃: 자체 이중 제출 CSRF 토큰을 쓴다.
- CORS 허용 헤더(`Access-Control-Allow-*`)를 보내는 코드가 없다.
- CSP `form-action 'self' https://accounts.google.com`, `frame-ancestors 'none'`, `X-Frame-Options: DENY`로 폼 하이재킹·클릭재킹도 막는다(현재 CSP는 Report-Only라 frame 차단은 X-Frame-Options가 담당).

## 3. 잠재 위험 (지금은 악용 불가)

| # | 내용 | 영향 | 권장 조치 | 우선순위 |
|---|---|---|---|---|
| P-1 | CSP `script-src 'unsafe-inline'` | 다른 경로로 HTML 주입이 생기면 CSP가 인라인 스크립트를 막지 못한다 | nonce(`strict-dynamic`) 방식 검토. 단, nonce는 모든 페이지를 동적 렌더링으로 바꿔 함수 호출이 늘어난다(Hobby 한도). 정적 페이지는 Next 부트스트랩 인라인 스크립트가 페이지마다 달라 hash 방식도 어렵다. enforce 전환과 분리해서 비교한다 | 중간 |
| P-2 | CSRF 방어가 `SameSite=Lax` 한 겹 | 쿠키 설정이 바뀌거나 브라우저 예외가 생기면 상태 변경 API가 노출된다 | 상태 변경 API 공통 래퍼에 `Sec-Fetch-Site`/`Origin` 같은 출처 검사를 추가(심층 방어). 비용 작음 | 중간 |
| P-3 | `GET /api/chat/[id]/messages`가 채팅방·알림을 "읽음" 처리 | Lax 쿠키는 최상위 GET 이동에 실린다. 다른 사이트가 참여자를 이 URL로 보내면 본인 방의 읽음 상태가 바뀐다(본인 방만, 데이터 노출 없음) | P-2의 `Sec-Fetch-Site` 검사 적용 시 함께 막힘. 또는 읽음 처리를 POST로 분리 | 낮음 |
| P-4 | 업로드 파일의 실제 바이트(매직 넘버) 미검증 | 선언 타입만 검사한다. 다른 출처(Supabase)에서 제공돼 XSS는 아니지만, 이미지가 아닌 파일이 저장될 수 있다 | "악성 첨부파일" 점검 항목에서 함께 다룬다(임베딩 작업에서 디코드 실패 처리 확인 포함) | 낮음 |

- 참고(위험 아님): 관리자 개발 통계의 외부 링크는 GitHub API `html_url`과 Vercel 배포 URL만 쓴다.

## 4. 다음 단계 제안
1. P-2(+P-3) 같은 출처 검사: 코드 수정 → 단위 테스트 → Preview → Production(별도 배포 승인).
2. P-1은 CSP Report-Only 관측 결과와 함께 enforce 결정 때 검토.
3. P-4는 IDOR/BOLA·Rate Limit·악성 첨부·의존성 점검 묶음에서 진행.
