# D-4 CSP·보안 응답 헤더 구현 계획

Production의 공개 Realtime이 OFF이고 채팅은 인증 polling을 사용한다. 이번 D-4 구현은 기본 헤더 4개와 Preview 검증으로 진행한다. 기존 모바일 사진 촬영 경로를 위해 camera 정책은 추가하지 않았다. CSP Report-Only, 보고 API와 enforcement는 별도 검증이 필요하다. XSS/CSRF 집중 감사(E), 고아 파일 정리(D-5), 기존 DB 잔여 권한 정리는 이번 범위에서 제외한다. [D-3 종결 기록](release-d3-production-preparation-2026-11-18.md#2026-11-19-production-공개-접근-차단-완료)

## 변경 전 Production 기준과 호환성

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

## 2026-11-19 기본 헤더 및 UX Preview 검증

- `fix/release-d4-core-headers`의 `4ee7d1e`에서 `nosniff`, `strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, `Permissions-Policy: geolocation=(), microphone=(), payment=(), usb=()`를 적용했다. 헤더는 Next.js 설정에서 반환하며 요청별 DB 작업은 추가하지 않는다.
- `feat/category-and-discoverability`의 `869d52f`에서 소분류 표시·초기화, 홈 등록 버튼 배치, MJU Find의 한국어 서비스 설명, 공개 홈과 두 게시판의 canonical 및 sitemap을 추가했다. Preview는 검색 엔진 수집과 색인 대상에서 제외하도록 설정했다.
- 두 변경을 포함한 Preview `dpl_EKp12SuRrw1fmuatsD9gGwB5F1iY`가 고정 URL에 배포됐다. 단위 테스트 3,013/3,013, 통합 회귀 16/16과 테스트 데이터 정리, 로컬 Chromium 검사 5/5, 호스팅 비파괴 프로브 16/16, 타입 검사·린트·빌드가 통과했다. Chromium 재현 절차는 [회귀 검사 안내](../../scripts/regression/README.md)에 있다.
- 실제 호스팅의 홈, 로그인, 버전 API, 서비스 워커, robots.txt, sitemap.xml에서 보안 헤더 네 개를 확인했다. 홈 `noindex, nofollow`, robots.txt의 전체 수집 금지, 비어 있는 sitemap도 확인했다. 검색 네 경로의 단일 응답 시간은 198~1,169ms였으며 전후 성능 비교와 실제 검색 엔진 색인은 측정하지 않았다.
- Production은 D-3 `cd123bf`의 인증 polling 및 공개 채널 차단 상태다. 이번 헤더·UX 변경은 Preview까지 적용했으며 DB 마이그레이션은 필요 없다. Preview 복구는 직전 `dpl_5DCPPR7weezg1dbrfdXkiSaKDTn4`를 고정 URL에 다시 연결한다. CSP Report-Only와 강제 적용은 별도로 검증할 범위다.

## 2026-11-19 명지찾기 및 홈·검색 UX 후속 Preview

- `3bddd74`는 임시 한국어 표시명 '명지찾기'와 돋보기·체크 로고를 도입했다. 이는 승인되지 않은 임의 변경이었으며 `23498c4`에서 승인된 서비스명 **명지대학교 분실물 센터**(`src/lib/brand.ts`)로 교체하고 기존 로고·설치 아이콘을 복구했다. 영문 명칭 MJU Find는 구조화 데이터의 대체 이름(`alternateName`)으로만 남긴다. 새 로고 후보 3개는 [docs/design/logo-candidates](../design/logo-candidates/)에 있으며 최종 승인 전에는 앱에 적용하지 않는다.
- 등록과 게시판 바로가기에서 분실물을 왼쪽, 습득물을 오른쪽에 배치했다. 등록과 검색의 소분류 항목에 대분류를 먼저 고르라는 안내를 지원 언어 7개에 추가했다. 홈페이지 `WebSite`와 공개 게시판별 제목을 추가하고 Preview 수집 제한을 유지했다.
- 고정 Preview는 `dpl_9RCXUS7GmdBdvyUz32cCRsx31eTJ`다. 단위 검사 3,013/3,013, 로컬 Chromium 검사 6/6, 호스팅 비파괴 프로브 16/16, 린트와 호스팅 빌드·타입 검사를 통과했다. 실제 응답의 기본 보안 헤더, 서비스 표시명, 사이트 구조화 데이터, 설치 아이콘 설정, 링크 공유 이미지와 두 게시판 canonical을 확인했다. 기존 Preview `dpl_EKp12SuRrw1fmuatsD9gGwB5F1iY`는 UX 복구 대상이다. 이 변경은 Production에 배포하지 않았다.

## 2026-11-19 UX 릴리스 인수인계(Codex → Claude Code)와 Production 현황

- Codex가 사용 한도로 중단된 시점의 실제 상태를 조회했다. Production은 이미 `dpl_99h6yK3CAQtRhN9F7YMK36DgHrn7`(`23498c4`, 14:36 KST, 서비스명 명지대학교 분실물 센터·기존 로고 복구)였고 전 별칭에 연결돼 있다. 이 배포 환경변수에 `MJU_REALTIME_CANARY_ROOM_ID`는 없다. 직전 Production `dpl_9NmiRUieiMdU1U8a9KoWLFvVz9Rz`(`346813f`)만 51번 방 canary 변수를 갖고 있다. `--realtime-canary-room=51`은 D-3 제한 비공개 시험용 옵션이며 UX 배포에는 쓰지 않는다.
- Production의 D-4 보안 헤더는 `next.config.ts`에서 의도적으로 꺼져 있다(`VERCEL_ENV === "production"`이면 빈 배열). 실제 응답에도 HSTS 외 네 헤더가 없다. Preview에서만 적용·검증됐고 Production 승격은 별도 승인 대상이다.
- Production 읽기 전용 검증: 비파괴 프로브 16/16, 최근 20분 error·5xx 0건, 3개 뷰포트(1440/390/320) 시각 검사(`HOSTED_UX_ORIGIN=https://mju-find.vercel.app python scripts/regression/hosted-ux.py`), 매니페스트·아이콘·canonical·sitemap·WebSite 구조화 데이터 확인. 홈 카드는 분실물 왼쪽·습득물 오른쪽, 소분류 첫 항목은 '잘 모르겠어요 (선택 안 함)'이며 필수가 아니다.
- `7dc2179`: 관리자 통계 내보내기 제목·XLSX 속성의 'MJU Find'를 서비스명으로 통일했다(영문명은 `alternateName`에만 유지). 단위 3,016/3,016, 타입·린트, 로컬 Preview 빌드, 16단계 통합 회귀 통과, 회귀 테스트 데이터(사용자 561–563, 글 320, 채팅방 239) 정리 확인. Preview `dpl_8ZVdUpqarWDsuaDEhG12KyPJQbxZ`에 연결했고 프로브 16/16·보안 헤더 4종·3개 뷰포트 검사를 통과했다. **이 변경은 Production에 배포하지 않았다**(관리자 내보내기 문구뿐이며 다음 릴리스에 포함).
- 롤백: 앱은 `dpl_ADBchXMB69zKRG4QCdXpiqTZonC7`(`cd123bf`, canary 변수 없음, READY)를 우선 대상으로 하고 `dpl_9NmiRUieiMdU1U8a9KoWLFvVz9Rz`는 canary 변수가 붙어 있어 차선이다. DB 변경이 없어 역마이그레이션은 없다.
- 새 로고 후보 3개(A 분실물 태그, B 물건을 건네는 손, C 교내 지도)는 [docs/design/logo-candidates](../design/logo-candidates/)에만 있으며 앱에는 적용하지 않았다.
- 주의: vitest는 Git Bash에서 실행하면 모든 스위트가 "failed to find the current suite"로 실패한다(환경 문제). 전체 테스트는 PowerShell에서 실행한다.

## 2026-11-19 대학 행정 서비스형 UI 시범 (Preview 전용)

- 브랜치 `feat/ui-center-header-pilot`, 커밋 `5a2de4f`. 공통 헤더에서 로고를 제거하고 "분실물 센터"만 표시(접근성 이름은 정식 명칭). 홈 제목은 "명지대학교 / 분실물 센터"(모바일 2줄, PC 1줄)와 부제 "교내 분실물과 습득물을 한곳에서 찾아보세요."(7개 언어). 홈 하단에 "교내 협력" 안내(학생지원팀·교목팀·교내 경비실, 기존 운영정책 링크, 공식 지정 표현·협력기관 로고 없음). 푸터의 "공식 서비스가 아님" 고지는 유지.
- 변경하지 않음: 파비콘·PWA 아이콘·매니페스트·OG 이미지(Production과 해시 동일 확인), SEO 메타데이터, 검색, 카드 배치(왼쪽 분실물·오른쪽 습득물), 소분류 UX, DB·환경변수·Realtime·Data API. 새 로고 후보는 [docs/design/logo-candidates](../design/logo-candidates/)에 보존.
- Preview `dpl_ApPnCr6gY6iJsfQJ51pQ4Q3oAgEP`(고정 URL 연결). 단위 270파일 3,019개, 타입·린트, 프로브 16/16, `scripts/regression/hosted-ux.py`(1440/390/320 헤더·제목·협력 안내·겹침·가로 스크롤·다른 페이지 헤더) 통과. 전후 비교는 [docs/design/ui-pilot](../design/ui-pilot/). Production은 `dpl_99h6yK3CAQtRhN9F7YMK36DgHrn7`(`23498c4`) 그대로이며 이 시범을 배포하지 않았다.
- 복구: Preview 고정 URL을 직전 `dpl_8ZVdUpqarWDsuaDEhG12KyPJQbxZ`(`7dc2179`)에 다시 연결한다. 로그인 상태 헤더(알림·프로필)의 시각 검증은 하지 않았다(해당 코드는 변경 없음).

## 2026-11-19 UI 시범 최종 채택 및 Production 반영

- 사용자가 Preview 디자인을 최종 채택하고 추가 변경 없이 Production 반영을 승인했다. 배포 전 로그인 상태 헤더를 `scripts/regression/logged-in-header.mjs`(로컬 빌드 + Preview DB의 격리 테스트 회원 1명·미확인 알림 1건, 종료 시 정리)로 1440/390/320px에서 검증했다. 이름·검색·알림(배지)·프로필이 모두 표시되고 겹침과 가로 스크롤이 없다. 부수 관찰: 1536px 미만의 데스크톱 프로필 아이콘 링크는 접근성 이름이 없다(이번 변경 이전부터의 동작).
- Production `dpl_HxSWo6BzrNfDTQDwg6NdMBMaYZKw` (`35168f0`, 브랜치 `feat/ui-center-header-pilot`)를 DB·환경변수 변경 없이 배포했다. 환경변수 키 집합이 직전과 동일하고 canary 변수는 없다. 직전 Production `dpl_99h6yK3CAQtRhN9F7YMK36DgHrn7`(`23498c4`)는 READY 롤백 대상이다. 배포 이력 기록은 기본값(Preview DB)만 썼고 Production DB에는 쓰지 않았다.
- 배포 후 검증: 비파괴 프로브 16/16, 1440/390/320px 홈·게시판·검색 헤더·소분류 검사, 아이콘·매니페스트·OG 이미지 크기 동일, 제목·canonical·OG 정식 명칭 유지, 최근 error·5xx 0건.

## 2026-11-21 기본 헤더 Production 적용 계획과 CSP Report-Only 설계 (준비만, 배포 없음)

### 기본 보안 헤더 4종 (Production)
- 현재: `next.config.ts`에서 `VERCEL_ENV === "production"`이면 헤더를 내보내지 않는다. Preview에서는 2026-11-19 검증(프로브, 헤더 4종, 3개 뷰포트)을 마쳤다.
- 변경: production 조건을 없애 4종(`nosniff`, `strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, `Permissions-Policy: geolocation=(), microphone=(), payment=(), usb=()`)을 Production에도 보낸다. 코드 변경은 조건 한 줄이다.
- 영향 검토
  - 사이트를 iframe에 넣는 기능이 없다(코드 inventory: iframe 0, 외부 임베드 0).
  - 카메라는 파일 선택(`input type=file`)만 사용하고, Permissions-Policy는 camera를 막지 않는다.
  - Referrer 정책이 바뀌면 외부 링크로 이동할 때 경로가 전달되지 않는다. 내부 통계(UTM)는 자체 파라미터라 영향이 없다.
- 검증
  - 배포 전: 로컬 Production 빌드 헤더 단위 테스트(`csp.test.ts`의 next.config 경로).
  - 배포 후: 공개 프로브 16/16, 응답 헤더 4종 확인, `csp-browser`류 흐름을 Production에서 수동 확인(로그인, 사진, 채팅).
- 롤백: 직전 Production 배포로 `vercel rollback`.

### CSP Report-Only 설계 (구현, 기본 OFF)
- 코드: `src/lib/security/csp.mjs`. `MJU_CSP_MODE=report-only|enforce`를 **빌드 시** 설정할 때만 헤더를 추가하고, 기본은 OFF라 현재 배포 동작이 바뀌지 않는다. `next.config.ts`가 사용한다.
- 정책(Production):
  ```
  default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob: https://<prod>.supabase.co; font-src 'self' data:;
  connect-src 'self' https://<prod>.supabase.co wss://<prod>.supabase.co;
  worker-src 'self'; manifest-src 'self'; frame-src 'none'; frame-ancestors 'none';
  form-action 'self' https://accounts.google.com; base-uri 'self'; object-src 'none'
  ```
  Preview에는 Preview Supabase와 Vercel 툴바(`vercel.live`, `vercel.com` 이미지, pusher WSS)를 더하고, 개발에는 `'unsafe-eval'`과 `ws:`를 더한다.
- 출처 근거(코드 inventory)
  - Storage 사진과 업로드, D-3 Realtime WSS
  - next/font 자체 호스팅, `/_next/image` 같은 출처
  - blob: 미리보기(글쓰기, 채팅, 사진 검색), `/sw.js`
  - Google 로그인 이동
  - 외부 스크립트·아바타·iframe 없음
- `'unsafe-inline'`: Next 인라인 부트스트랩과 layout 초기화 스크립트 3개 때문에 필요하다. **인라인 XSS 방어는 아직 아니다**(5단계 nonce/hash 비교 과제).
- Zod 4의 `Function("")` JIT 탐지가 모든 입력 검증 페이지에서 `script-src eval` 위반을 만들었다(예외를 잡아 기능 영향은 없음). `src/instrumentation-client.ts`의 `z.config({ jitless: true })`로 탐지를 끄고, 보고 잡음을 없앴다.
- 검증(로컬 Preview 빌드, **enforce 모드**: Report-Only보다 엄격)
  - `scripts/regression/csp-browser.mjs`(Chromium + WebKit): 위반 0, 6개 흐름 통과.
    - 익명 페이지 6개의 헤더
    - 사진 글의 최적화 이미지와 Storage 직접 이미지
    - 사진 검색(blob: 미리보기와 검색 요청)
    - Google 로그인의 accounts.google.com 이동
    - 로그인 페이지 5개
    - 글쓰기 사진 미리보기
  - `realtime-fallback.mjs --two-member`(실제 private WebSocket): 13/13, 신규 "CSP 위반 없음" 검사 포함.
  - 단위: `csp.test.ts`(정책·모드·next.config 출력), `cspRealtime.test.ts`(CSP가 생기면 Realtime·Storage 출처를 요구).
- 남은 설계 결정
  1. 보고 수집: Report-Only는 브라우저 콘솔에만 남는다. Production 관측을 위해 같은 출처의 `/api/csp-report`를 둔다. 크기 16KiB 제한, 지시문·출처 분류만 집계하고 원문·쿼리·IP는 저장하지 않으며, 요청 제한을 건다. 새 함수 수(Hobby 12개)와 저장 위치(기존 MetricDaily 집계)를 확인한 뒤 구현한다. 이 단계 전까지는 위 브라우저 검사와 수동 확인으로 대신한다.
  2. 배포 순서: ① 기본 헤더 4종 Production → ② `MJU_CSP_MODE=report-only` Production(환경 변수 추가와 재배포) → ③ 관측 기간 → ④ enforce 승인.
- 롤백: 환경 변수를 지우거나 직전 배포로 `vercel rollback`. DB 변경은 없다.

## 2026-11-21 기본 헤더 4종 Production 반영 (완료)

- 커밋 `faf3be9`: `next.config.ts`의 Production 제외 조건을 없앴다. 값은 Preview에서 검증한 그대로다. CSP는 `MJU_CSP_MODE`가 없으므로 꺼져 있다.
- 배포 전 확인
  - `253de8f`(C-2 Production) 대비 앱 코드 차이는 세 가지다: `next.config.ts`, `src/instrumentation-client.ts`(Zod jitless, 로컬 enforce 검증 완료), 꺼진 CSP 모듈.
  - 단위 275파일 3,051개, 타입, 린트 통과.
- Preview `dpl_9WGYGXZj6ipjeD14wJtEZrUyXe4f`(`faf3be9`): 프로브 16/16, 호스팅 헤더 검사 12/12 경로(`scripts/regression/security-headers-hosted.mjs preview`).
- **Production `dpl_DvLnpG3ixQT6t1XAqV6Cru73hWCM`(`5db5350`, 앱은 `faf3be9`와 같고 검사 스크립트만 추가)**
  - 실제 응답 헤더: `/`, `/login`, `/lost`, `/found`, `/search`, `/api/version`, `/api/auth/session`, `/api/auth/providers`, `/sw.js`, `/manifest.webmanifest`, `/robots.txt`, `/icon.svg` 12개 모두 4종 일치. CSP 없음, HSTS 유지.
  - 공개 프로브 16/16. 인증 경계 401(채팅·관리자·신고 증거·유지보수). 검색 4종 순위가 배포 전과 같다.
  - `scripts/regression/hosted-anonymous-browser.py`(Chromium + WebKit): 헤더, 게시글 사진, 사진 검색(blob 미리보기와 검색 200), Google 로그인 이동(accounts.google.com), iframe 삽입 거부, 우리 페이지 오류 0.
  - 배포 후 error·5xx 0건.
- 롤백: `vercel rollback dpl_3AgGm82bTYAQUV8bRJevsf8JquRX`(C-2, READY 확인). DB 변경은 없다.
- 미확인: 로그인 상태(채팅 WebSocket, 관리자)는 Production에서 자동으로 확인할 수 없어 사용자 확인 대상이다. 같은 코드의 private WebSocket 2인 E2E는 로컬 enforce 빌드에서 13/13 통과했다.

## 2026-11-21 CSP 위반 보고 수집 (Report-Only 준비, Preview 검증 완료)

### 구조 (새 외부 서비스 없음)
- `POST /api/csp-report`(`src/app/api/csp-report/route.ts`, 파싱은 `src/lib/security/cspReport.ts`). 같은 출처, 익명. 브라우저는 보고에 세션을 싣지 않으므로 비로그인 페이지에서도 보고된다.
- 비용 순서대로 막는다. 쓰레기 요청은 DB에 닿지 않는다.
  1. Content-Type이 `application/csp-report`, `application/reports+json`, `application/json`이 아니면 415.
  2. 본문 16KiB 초과면 413(선언 길이와 실제 스트림 모두 검사).
  3. 메모리에서 해석하고 거른다: 다른 출처 페이지의 보고(위조), 확장 프로그램 소음, 형식 오류는 204로 답하고 `csp.ignored.*`로 세기만 한다.
  4. IP별 요청 제한(기존 `RateLimitCounter`, `AUTH_SECRET` 솔트 해시, 원 IP 미저장): 분당 30, 하루 300을 넘으면 429. 제한기가 고장 나면 조용히 버린다(페이지에는 영향 없음).
- 저장: 원문, 전체 URL, 쿼리, IP, UA, 사용자 ID는 저장하지 않는다.
  - DB에는 `MetricDaily`의 `csp.<report|enforce>.<지시문>.<분류>` 카운터만 남는다. 기존 지표와 묶어 1분 단위로 쓴다. 이름은 고정 집합이다. 지시문 22종과 other, 분류는 inline, eval, wasm-eval, data, blob, self, supabase, google, vercel-toolbar, external, unknown이다.
  - Vercel 런타임 로그에는 위반마다 한 줄을 남긴다: 경로 패턴(`/post/[id]`), 지시문, 분류, external이면 호스트만, 같은 출처 스크립트 경로와 줄 번호. Hobby 로그는 짧게 보존된다.
- 보존: `csp.*` 카운터는 일일 보존 정리 cron(`runRetention`)이 **90일** 뒤 삭제한다. 요청 제한 행은 기존 규칙대로 2일 뒤 정리된다.
- Hobby
  - 함수 수: 새 라우트는 기존 공유 함수에 묶인다. Report-Only Preview 배포가 READY였고, Hobby는 12개를 넘으면 배포를 거부한다.
  - 호출 비용: 정상 페이지는 보고 0건으로 확인했다. 위반이 생겨도 보고 1건이 호출 1회이고, IP당 하루 300회로 묶인다.

### report-uri와 report-to 검토 (2026-11-21 실측)
- `report-uri`만 둘 때: Chromium(두 headless 모두)과 WebKit이 즉시 보낸다.
- `report-to`를 함께 둘 때:
  - Chromium은 `report-uri`를 무시하고, Reporting API 업로드가 로컬 검사에서 80초 동안 오지 않았다.
  - WebKit은 본문 형식을 바꾼다(`type`과 `body`를 가진 단일 객체).
  - Preview는 Deployment Protection 때문에 HTTPS에서 Reporting API를 검증할 수 없다.
- 결론: 정책은 **`report-uri /api/csp-report`만** 사용한다. 엔드포인트는 Reporting API 배열·단일 객체와 WebKit의 `type`과 `csp-report`가 함께 있는 본문까지 모두 해석하므로, 나중에 HTTPS에서 확인되면 `report-to`를 추가할 수 있다.

### 정책 확인
- Google 로그인: `form-action 'self' https://accounts.google.com`. 로그인 버튼의 accounts.google.com 이동에서 보고 0건(Chromium, WebKit, 로컬과 Preview).
- Supabase Storage(`img-src`·`connect-src https://<project>.supabase.co`)와 Realtime(`connect-src wss://<project>.supabase.co`): 환경별 프로젝트만 허용한다. 사진 게시글과 사진 검색에서 보고 0건. 2인 private WebSocket은 로컬 enforce에서 13/13, 위반 0.
- Preview에는 Vercel 툴바 출처가 추가된다. Preview 정상 페이지에서 보고 0건.

### 검증
- 단위: `cspReport.test.ts`(형식 4종, 개인정보 미보존, 외부 출처·확장 프로그램, 묶음 한도, 이름 한정), `route.test.ts`(415/413/외부 출처/429/제한기 고장/Host 기준 출처), `csp.test.ts`(report-uri만). 전체 277파일 3,069개 통과.
- 로컬 Report-Only 빌드(`scripts/regression/csp-report-browser.mjs`, Preview DB)
  - 정상 페이지 7개와 Google 이동: 보고 0건.
  - 일부러 만든 교차 출처 이미지와 fetch: Chromium·WebKit 모두 도착.
  - 로그에 쿼리와 표식 비밀값 없음, 카운터 2종 기록, 이름 한정.
  - 시험 행은 정리했다.
- Preview `dpl_9ZeEuVWpFkNe5w7K55NWya178GJ9`(`da92170`, `--csp-mode=report-only`, 고정 URL 연결), `scripts/regression/csp-report-hosted.mjs` 15/15
  - Report-Only 헤더와 report-uri, 강제 CSP 없음.
  - 형식 3종 204. 415, 413, 405.
  - 외부 출처, 확장 프로그램, 형식 오류는 버리고 셈.
  - 브라우저 2종 보고 도착과 로그(쿼리·비밀값 없음).
  - 31번째 요청에 429.
  - 카운터 8종, 이름 한정.
- 정리: Preview `MetricDaily csp.*`와 `RateLimitCounter cspReport:*`가 0행인 것을 확인했다. 정상 페이지 재방문(Chromium, WebKit) 뒤에도 0행, 로그 0줄이다.
- 배포 도구: `scripts/deployments/deploy.mjs --csp-mode=report-only|enforce`가 해당 배포에만 빌드 시점 `MJU_CSP_MODE`를 넘긴다.

### Production 활성화 시 (별도 결정)
1. `node scripts/deployments/deploy.mjs production --csp-mode=report-only`(코드는 `da92170` 이후). DB 변경은 없다.
2. 배포 후 `security-headers-hosted.mjs production --expect-csp report-only`, `hosted-anonymous-browser.py`, 프로브.
3. 관측: `MetricDaily csp.*`(읽기 전용)와 런타임 로그의 `csp-violation`.
4. enforce는 관측 결과를 보고 별도 승인한다.
- 롤백: 직전 배포로 `vercel rollback`(헤더만 바뀐다).

## 2026-11-21 Production CSP Report-Only 활성화 (완료)

- 승인: 사용자 인수인계 지시("Production CSP Report-Only 활성화"). enforce는 관측 뒤 별도 승인.
- 배포: `node scripts/deployments/deploy.mjs production --csp-mode=report-only` → **Production `dpl_6rutg8AmJikkZPacLL5stQwRD8wE`(`5711719`)**. `da92170`(Preview 15/15 검증 빌드) 대비 앱 코드 차이 없음(문서·검사 스크립트만). DB·환경 변수 변경 없음. 배포 이력은 기본값(Preview DB)에만 기록.
- 배포 전: 단위 3,069개, 타입, 린트 통과. 롤백 대상 `dpl_DvLnpG3ixQT6t1XAqV6Cru73hWCM`(`5db5350`) READY 확인.
- 배포 후
  - `security-headers-hosted.mjs production --expect-csp report-only`: 12/12 경로에서 기본 헤더 4종 + `Content-Security-Policy-Report-Only`, 강제 CSP 없음, HSTS 유지.
  - `release-probes.mjs`: 16/16(버전, 공개 4, 인증 경계 401 4, 검색 4종, 기존 사진 3).
  - `hosted-anonymous-browser.py`(Chromium + WebKit): 통과(헤더, 사진, 사진 검색, Google 이동, framing 거부).
  - 런타임 로그: 50행 중 5xx·error 0. `csp-violation` 1건 = `frame-ancestors`/`self`/`/login`. **검사 스크립트의 framing 거부 확인(일부러 iframe 삽입)이 만든 보고**이며, Production `MetricDaily csp.report.frame-ancestors.self` 1건으로 집계됐다(관측 시 기준 잡음으로 제외, 삭제하지 않음).
- 관측 방법: `MetricDaily csp.*`(Production DB 읽기는 승인 필요) 또는 `vercel logs`의 `csp-violation`(약 50행만 보존). 실제 사용자 로그인 흐름(채팅 WebSocket, 사진 업로드, 관리자)의 보고 여부가 enforce 판단 근거다.
- 롤백: `vercel rollback dpl_DvLnpG3ixQT6t1XAqV6Cru73hWCM`(헤더만 바뀜). Report-Only는 어떤 요청도 막지 않는다.

## 2026-11-21 CSP 운영 보강 (Production 변경 없음)

- **배포 스크립트 모드 검증**(`scripts/deployments/cspMode.mjs`, 테스트 `cspMode.test.ts`)
  - `deploy.mjs production`은 `--csp-mode`가 없으면 배포하지 않고 종료 코드 2로 끝난다.
  - `enforce`는 `--confirm-csp-enforce`, `off`는 `--allow-csp-off`를 함께 지정해야 한다.
  - 배포 뒤 새 배포의 응답 헤더를 `vercel curl`로 다시 읽는다. 요청한 모드와 다르면 롤백 안내와 함께 실패로 끝난다.
  - Preview에서 확인했다: `dpl_AF3mKwp3…` "CSP 확인: report-only".
- **Production 집계(읽기 전용, 최소 필드)**: `scripts/operations/csp-metrics.mjs`는 `MetricDaily`의 `csp.*` 행(day, metric, value)만 읽는다. 승인 참조 `CSP-METRICS-READONLY-2026-11-21`.
  - 2026-11-21 20:3x KST 결과: `csp.report.frame-ancestors.self` = 2. **둘 다 알려진 시험 보고**다.
    - 19:48:11 Chromium(경로 `/`: Chromium은 교차 출처 iframe 보고의 주소를 출처로 줄인다)
    - 19:48:37 WebKit(`/login`)
    - 배포 직후 `hosted-anonymous-browser.py`의 iframe 차단 확인에서 생겼다.
  - 실제 운영 위반은 0건, enforce 위반 0건, 무시(외부·확장 프로그램) 0건이다.
- 시험 보고 분리
  - 스크립트가 `KNOWN_TEST_REPORTS`로 시험 보고를 따로 표시한다. 행은 삭제하지 않는다.
  - `hosted-anonymous-browser.py`는 iframe 검사 중 자기 보고 요청을 브라우저에서 막는다(`framing_csp_reports_blocked`로 셈). 이후 실행은 Production 집계에 시험 보고를 남기지 않는다.
- 판단: Report-Only 적용 후 1시간 미만이고, 로그인 사용자 흐름(채팅·글쓰기·관리자)에서 생긴 보고 표본이 없다. **0건을 근거로 enforce하지 않는다.** 최소 1~2주 관측과 로그인 흐름 표본(사용자 확인 또는 테스트 계정)을 확보한 뒤 enforce를 다시 판단한다.
