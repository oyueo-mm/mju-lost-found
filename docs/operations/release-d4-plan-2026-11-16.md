# D-4 CSP·보안 응답 헤더 구현 계획

Production의 공개 Realtime이 OFF이고 채팅은 인증 polling을 사용한다. 이번 D-4 구현은 기본 헤더 4개와 Preview 검증으로 진행한다. 기존 모바일 사진 촬영 경로를 위해 camera 정책은 추가하지 않았다. CSP Report-Only, 보고 API와 enforcement는 별도 검증이 필요하다. XSS/CSRF 집중 감사(E), 고아 파일 정리(D-5), 기존 DB 잔여 권한 정리는 이번 범위에서 제외한다. [D-3 종결 기록](release-d3-production-preparation-2026-11-18.md#2026-11-19-production-공개-접근-차단-완료)

## 현재 코드와 운영 기준

- `next.config.ts`에는 전역 보안 headers가 없다. Production `/api/version`에서 CSP/Report-Only/nosniff/Referrer-Policy/Permissions-Policy/X-Frame-Options는 없고, Vercel HSTS `max-age=63072000; includeSubDomains; preload`는 이미 있다. HTML·API·이미지·service worker를 각각 다시 조사하여 경로별 기준을 고정한다.
- `src/proxy.ts`는 세 경로의 동의 화면 return path만 처리한다. CSP를 추가할 경우 기존 LANDING_HEADER 삭제·검증과 matcher 동작을 보존해야 한다.
- `src/app/layout.tsx`는 theme/boardView/privacyNotice 초기화 인라인 스크립트 3개를 첫 화면 전에 실행한다. Next hydration/RSC 스크립트도 있다. 곧바로 `script-src 'self'`를 강제하면 기능이 깨진다.
- Google/Auth.js는 기존 OAuth 리다이렉트를 유지한다. Google을 모든 리소스 지시문에 광범위하게 허용하지 않고 실제 리다이렉트·콜백·로그인 실패/계정 선택 경로를 브라우저로 검사한다.
- 이미지 최적화는 D-1의 두 Supabase 프로젝트와 post-images의 lost/found 경로만 허용한다. D-1 당시 레거시 Blob 실사용 참조는 0개였다. D-4 CSP 허용 목록도 새 읽기 전용 인벤토리와 실제 브라우저 요청으로 결정한다. 공개 최적화 이미지와 채팅/신고 비공개 이미지 정책을 구분한다.
- D-3는 Storage와 Realtime 클라이언트를 분리한다. Storage HTTPS와 환경별 Realtime WSS/HTTPS 연결, private 토큰 갱신 API, 인증 API polling을 모두 확인해야 한다. 웹 푸시는 self service worker와 서버 발신 구조다. 브라우저가 직접 접속하지 않는 push endpoint 전체를 CSP connect-src에 추측으로 추가하지 않는다.

## 단계와 정책 후보

1. **헤더와 요청 인벤토리:** Preview에서 Chromium/Firefox/WebKit의 로그인·사진·채팅·푸시·관리자 동작을 수집한다. URL의 query/fragment, 서명 토큰, 쿠키, 개인정보는 결과에서 제거한다. Next 16.4.6 설치 문서의 CSP/headers/proxy 규약을 다시 확인한다.
2. **기본 헤더:** `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, 클릭재킹 방지 `X-Frame-Options: DENY`를 후보로 검증한다. 프레이밍이 필요한 실제 기능이 확인되면 정확한 환경/출처만 별도 설계한다. Preview 대시보드의 임베디드 미리보기와 직접 URL 이용 차이도 보고한다. HSTS·기존 Cache-Control·서명 URL 수명은 변경하지 않는다.
3. **Permissions-Policy:** 미사용 camera/microphone/geolocation/payment/usb 권한을 차단하는 최소 정책부터 검사한다. 사진 파일 선택·모바일 촬영 선택, 공유/클립보드 기능은 실제 사용 API와 브라우저 호환성을 확인한다. COOP/COEP/CORP는 OAuth·외부 이미지 영향이 크므로 일괄 적용하지 않는다.
4. **CSP Report-Only 우선:** `default-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'`와 정확한 이미지·font·worker·connect 목록을 후보로 만든다. 첫 비교에서는 필요한 인라인 실행을 명시적으로 허용해 기존 동작을 보존하되, 이는 인라인 XSS 방어 완료가 아님을 기록한다. Production에 `unsafe-eval`을 추가하지 않는다. 개발용 localhost/WebSocket 허용은 개발 환경에만 둔다. `frame-ancestors`는 Report-Only에서 강제 차단을 제공하지 않으므로 X-Frame-Options의 실제 차단 검증을 별도로 수행한다.
5. **엄격한 script 정책 비교:** nonce·고정 스크립트 hash 후보를 Preview에서 비교한다. nonce는 요청마다 새로 생성하고 외부 `x-nonce`/CSP 입력은 덮어쓴다. 요청 CSP 전달 및 layout의 명시적 인라인 script nonce를 맞추고 Next 스크립트에도 적용되는지 확인한다. nonce 때문에 정적 경로가 동적으로 바뀌는 캐시·TTFB·호출 비용을 측정한다. 고정 3개 스크립트 hash만으로 동적인 RSC 스크립트가 해결됐다고 판단하지 않는다. 비용/호환성 근거 없이 전체 페이지를 동적 렌더링으로 전환하지 않는다.
6. **운영 관측 후 승격:** Preview를 통과한 Report-Only를 단계 배포하고 정상 기능 위반이 없는 관측 구간을 확보한 뒤 enforcement 여부를 결정한다. Report-Only 수집 완료와 실제 차단 완료를 구분한다. 배포 승인 범위에 enforcement가 포함되지 않으면 보고만 한다.

## CSP 보고 수집의 개인정보·자원 보호

동일 출처 신규 보고 API를 검토한다. 신뢰할 수 없는 공개 입력이므로 크기 제한(초안 16 KiB), JSON 지시문 allowlist, 비로그인 IP 신뢰 범위를 포함한 fail-closed 요청 제한, 중복 집계·샘플링을 적용한다. `report-uri`/Reporting API 양쪽 브라우저 지원을 확인한다. 원문 body·document-uri/blocked-uri의 query와 path·script-sample·쿠키·raw IP를 저장하거나 로그로 내보내지 않는다. 지시문·허용 목록에 있는 출처 분류·상태별 집계만 우선 수집하여 새 개인정보 보존 테이블을 만들지 않는 안을 선호한다. 임의 외부 수집 서비스·유료 상품은 추가하지 않는다.

## 수정 대상

| 파일 | 예정 작업 |
| --- | --- |
| `next.config.ts` | 기본 보안 헤더·Report-Only 경로/환경 범위 |
| 신규 `src/lib/security/headers.ts` 및 테스트 | 순수 정책 생성·허용 목록·환경 분리 |
| `src/proxy.ts`, `src/app/layout.tsx` | nonce 채택 시에만 요청 nonce·기존 동의 경로 보존 |
| 신규 보고 API/수집 모듈 | 크기·요청 제한·비밀/개인정보 제거·집계 |
| `src/lib/rateLimit/index.ts` | 보고 입력용 별도 예산과 장애 구분 |
| `scripts/regression/*` | 브라우저 보안 헤더·실제 리소스/정상 기능 검증 |
| 운영/롤백 문서 | Report-Only 관측·승격 기준·환경 차이·캐시/성능 기록 |

## 테스트·DB·롤백

- 전체 단위·타입·린트·빌드, 16단계 통합 회귀와 D-3 private 보안 검사를 재사용한다. CSP 위반으로 차단·누락된 요청, hydration 오류, 화면 깜빡임·다크모드·게시판 보기·정책 공지가 없는지 확인한다.
- 실제 Google 로그인/콜백·로그아웃, 게시글/레거시 사진·이미지 검색, chat/evidence private 이미지, 파일/클립보드/다운로드, push 등록·수신·클릭, private Realtime 갱신·재연결·API 대체 경로를 검사한다. 로컬 테스트 계정으로 대체할 수 없는 OAuth/OS push 검사는 남은 필수 항목으로 명시한다.
- 잘못된 MIME의 script 차단·iframe 클릭재킹 차단·위조 보고/폭주·nonce 재사용/외부 헤더 주입을 Preview 독립 데이터로만 검사한다. Production에서 공격 테스트를 하지 않는다.
- 응답 헤더 변경만으로는 DB 마이그레이션이 필요 없다. 보고는 기존 로그 집계를 우선 사용하며 별도 저장 구조가 필요하면 이유·보존 기간을 먼저 보고한다. Data API·Realtime 정책·DB 권한은 변경하지 않는다.
- 같은 경로의 warm/cold TTFB, 정적/동적 렌더 수, 캐시 적중, 함수 호출량, 보고량을 변경 전후 비교한다. nonce로 인한 비용 증가는 명시적인 채택 판단 대상이다.
- 롤백은 D-3의 안전한 인증/비공개 채널 앱을 보존한 채 D-4 헤더/보고 경로만 이전 설정으로 복구한다. Realtime 공개 접근이나 기존 보안 가드를 다시 열지 않는다.

근거: 설치된 `node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md` 및 [Next CSP 가이드](https://nextjs.org/docs/app/guides/content-security-policy). 구현 전 해당 설치 버전 문서를 기준으로 다시 확인한다.
