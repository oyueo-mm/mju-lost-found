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

## 5. 후속 조치 (2026-11-21 저녁, 브랜치 `fix/csrf-origin-chat-read`)

### P-2 같은 출처 검사 (구현, Preview 검증, Production 미배포)
- `src/lib/security/sameOrigin.ts`를 `withErrorHandling`(`src/lib/posts/response.ts`)에 넣었다. 세션 조회나 핸들러보다 먼저 실행되므로, 거부된 요청은 DB에 닿지 않는다.
  - GET/HEAD/OPTIONS는 통과시킨다.
  - `Sec-Fetch-Site`가 있으면 `same-origin`/`none`만 허용한다.
  - 이 헤더가 없으면 `Origin`이 요청 자신의 출처(URL scheme + Host)와 같아야 하고, `null`은 거부한다.
  - 두 헤더가 모두 없으면 브라우저가 아닌 요청(cron, 임베딩 kick, vercel curl)으로 보고 통과시킨다. 이런 요청도 각자의 인증(세션·bearer)은 그대로 거친다.
- 경로 구분: 라우트 35개(새 `read` 포함) 중 상태 변경 메서드가 있는 라우트는 예외 3개를 빼고 모두 래퍼를 쓴다. 예외 3개는 단위 테스트(`sameOrigin.test.ts` route inventory)에 이유와 함께 고정했다. 새 라우트가 래퍼 없이 POST를 내보내면 테스트가 실패한다.

  | 예외 | 이유 |
  |---|---|
  | `auth/[...nextauth]` | Auth.js 자체 CSRF 토큰. Google 콜백은 GET |
  | `csp-report` | 쿠키 인증을 쓰지 않음. 브라우저가 직접 보고 |
  | `chat/[id]/realtime` | 자체 검사가 더 엄격함(Origin 필수, cross-site 거부) |

- Webhook 경로는 없다. Vercel cron은 GET + bearer다.
- Server Actions는 Next 자체 Origin/Host 검사를 그대로 쓴다.
- 거부 로그는 `cross-origin request refused {"method","reason"}`만 남긴다. 경로, 외부 출처, 쿠키는 남기지 않는다(Preview 로그에서 0건 확인).

### P-3 읽음 처리 분리
- `GET /api/chat/[id]/messages`: 읽기 전용이다. 응답에서 `unreadChatCount`를 뺐다.
- `POST /api/chat/[id]/read {upToMessageId}`: 커서와 "message" 알림을 **클라이언트가 실제로 표시한 메시지까지만** 읽음 처리한다(`markChatRoomRead`·`markMessageNotificationsReadForChatRoom`의 `upToMessageId` 상한). 응답에는 새 미확인 합계를 담는다. 참여자 검증은 서비스가 다시 한다.
- `ChatThread`: 동기화(최초 로드, Realtime 힌트, polling)가 새 메시지를 가져왔을 때만 POST를 보낸다.
  - 진행 중인 요청이 있으면 가장 새 ID 하나로 합친다.
  - 실패하면 다음 동기화 때 다시 보낸다.
  - 방이 바뀌면 상태를 초기화한다.
  - 추가 호출은 "새 메시지가 있을 때 1회"뿐이고, polling 주기마다 생기지 않는다.

### 개선 전후 비교

| 항목 | 이전 | 이후 |
|---|---|---|
| 교차 출처 POST/PUT/PATCH/DELETE | `SameSite=Lax` 쿠키 한 겹(쿠키가 빠지면 401) | 쿠키 + 출처 검사 두 겹. 쿠키가 실려도 403, 세션 조회 전 차단 |
| 위조 헤더 + 실제 세션 쿠키(쿠키 방어가 무너진 상황 재현) | 요청이 처리됨 | 11/11 거부(무세션 1건 포함 12/12), DB 변화 0 |
| 다른 사이트에서 GET .../messages(Lax 쿠키 동반) | 방과 알림이 읽음 처리됨 | 읽기만 함(커서·알림 불변) |
| 읽음 범위 | 방의 최신 메시지까지, 알림 전체 | 표시한 메시지까지(커서·알림 모두) |

- 관찰(로컬 http 환경): WebKit은 다른 사이트의 `<img>` 하위 요청에도 Lax 쿠키를 보냈다(`GET .../messages` 200). 이전 코드였다면 이미지 태그 하나로 읽음 처리가 됐다. HTTPS 실서비스에서도 같은지는 확인하지 않았다.

### 검증
- 단위: 전체 280파일 3,146개, 타입, 린트 통과. 새 테스트는 다음과 같다.
  - `sameOrigin.test.ts`: 판정 행렬, 래퍼, 라우트 인벤토리
  - `chat/[id]/read/route.test.ts`
  - 서비스 상한 테스트
  - GET이 읽음 처리하지 않음
- 로컬(실서버 + Preview DB, 격리 회원 3명, 끝나면 정리): `scripts/regression/csrf-local.mjs` 20/20
  - 위조 헤더 + 실제 쿠키 11종 403(채팅 송신·삭제, 알림, 전체 읽음, 회원 탈퇴 포함)
  - 무세션 403(1종)
  - 교차 사이트 GET은 상태 불변
  - 비참여자 403
  - 공격 사이트 페이지(Chromium·WebKit: 폼 자동 제출, no-cors fetch, img, 최상위 이동): 상태 불변
  - 같은 출처는 표시한 메시지까지만 처리
  - 헤더 없는 클라이언트는 정상 처리
- 호스팅 Preview `dpl_AF3mKwp3d9TdH3H1Bw5ztZWKj2kk`(`940cbf0`, 고정 별칭 미변경): `scripts/regression/csrf-hosted.mjs` 10/10
  - 외부 출처·다른 vercel.app 출처 403
  - 같은 출처·헤더 없음은 인증 단계(401)까지 도달
  - 실제 브라우저(Chromium·WebKit)에서 배포 페이지의 fetch는 401, 공격 페이지는 403

### P-4 정정 (감사 1차 판정 오류)
- 1차 보고에서 "매직 넘버 미검증"이라고 했으나 **이미 구현돼 있다**(Release B H-3).
  - 게시글 사진(`setPostImage` 등 → `verifyUploadedPostImages`)과 채팅 사진(`sendMessage`)은 첨부 전에 `sanitizeStoredImage`를 거친다.
  - 이 단계에서 파일을 내려받아 첫 바이트(JPEG/PNG/WebP 시그니처, `magicBytes.ts`)로 판정하고, 경로 확장자와 대조하고, sharp로 디코드하고(픽셀 한도 4천만), EXIF/GPS가 있으면 다시 인코딩한다. 실패하면 이번 업로드 객체를 삭제한다.
  - 신고 증거는 이미 검사를 통과한 사진의 복사본이다.
- 남은 위험: 업로드 서명만 받고 **첨부하지 않은 객체**는 바이트 검사 없이 Storage에 남는다. 공개 버킷 post-images는 Supabase 도메인에서 선언된 타입으로 제공된다. 우리 출처의 XSS는 아니지만 파일 보관 악용 여지가 있다. 해결은 D-5 고아 파일 자동 정리(짧은 유예 뒤 미참조 객체 삭제)다. 업로드 직후 별도 검사 API는 클라이언트 신뢰가 필요해 효과가 작다.

### P-1 `'unsafe-inline'` 제거(nonce) 비용·성능 비교 (조사만)
- **렌더링 방식 변화 없음**: 현재 빌드(`next build`, 2026-11-21)에서 HTML 페이지는 이미 모두 동적(ƒ)이다. 정적(○)은 아이콘, manifest, robots, sitemap, OG 이미지뿐이다. 레이아웃이 세션 쿠키를 읽기 때문이다. Next 문서가 말하는 "nonce를 쓰면 정적→동적 전환, CDN 캐시 상실, 함수 호출 증가"는 이 서비스에는 **이미 반영된 상태**라, 페이지 렌더링 함수 호출은 늘지 않는다.
- **실제 추가 비용은 Proxy 실행**: 요청마다 nonce를 만들어 요청·응답 CSP 헤더에 넣는 일은 Proxy(`src/proxy.ts`)만 할 수 있다. `next.config` 헤더는 빌드 시 고정이다.
  - 지금 Proxy는 3개 경로에서만 돈다.
  - nonce를 쓰면 모든 문서 요청과 RSC 이동 요청(`api`, `_next/static`, `_next/image`, prefetch 제외)에서 돌아야 한다.
  - Vercel에서는 해당 요청마다 Routing Middleware 실행이 1회 추가된다. 증가량은 "HTML·RSC 페이지 요청 수"와 같다. 요금제 한도와 실측은 Vercel 사용량 화면의 Middleware/Edge 항목으로 확인해야 한다(이번에는 측정하지 않음).
  - 지연은 요청당 nonce 생성(난수 + 헤더 조립, 1ms 미만)과 Proxy 단계 추가다.
- 코드 영향
  - `layout.tsx`의 인라인 스크립트 3개에 `headers()`의 nonce를 붙인다.
  - Next 부트스트랩·RSC 인라인 스크립트에는 Next가 자동으로 붙인다.
  - `style-src`는 React `style` 속성 때문에 `'unsafe-inline'`을 유지한다(스크립트만 강화).
  - Preview 툴바는 별도로 허용해야 한다.
- 대안 검토
  - hash 방식: RSC 인라인 페이로드가 요청마다 달라 불가능하다.
  - `experimental.sri`: 외부 청크 무결성만 다루고 인라인 문제는 해결하지 못한다.
- 권장: ① 이번 출처 검사를 Production에 먼저 반영 → ② Preview에서 nonce + `'strict-dynamic'` Report-Only 빌드로 위반·Proxy 호출량·지연 측정 → ③ Production Report-Only 관측 → ④ enforce 결정. ②부터 별도 승인을 받는다.
