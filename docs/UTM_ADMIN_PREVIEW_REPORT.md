# UTM 관리자 도구 · Preview 검증 결과

검증일: 2026-11-09 (KST)

- Preview: https://mju-lost-found-preview.vercel.app/admin/utm
- 고정 배포: https://mju-lost-found-vercel-nerfgptb2-oyueo.vercel.app/admin/utm
- 배포 ID: `dpl_7jhGY5F4TWacFbyyeXXCmTJ3uGSa`
- Production 배포는 수행하지 않았습니다. 변경은 로컬 작업 트리에 있으며 Preview 배포 이력에는 `gitDirty`로 기록됩니다.
- Vercel API에서 작업 전후 Production 배포 ID가 같고, Preview 별칭이 최종 READY 배포를 가리키는 것을 확인했습니다.

## 구현

- `/admin/utm`에서 기존 `UtmLinkBuilder`를 재사용합니다. 관리자 센터 카드와 메뉴에 **UTM 링크 생성**을 추가했습니다.
- 생성 페이지는 서버에서 `promotion.manage`를 검사합니다. 통계 데이터 접근은 기존 `stats.operations`, `stats.users`, `stats.admins`로 분리됩니다.
- 홍보 권한만 가진 계정의 기존 `/admin/stats` 및 권한 있는 계정의 `?tab=promo`는 독립 생성기로 이동합니다. 통계 데이터는 읽지 않습니다.
- 운영 통계의 유입 경로에 홍보 권한이 있는 경우 **UTM 링크 생성기** 바로가기를 표시합니다. 기존 출처·매체·캠페인별 표를 유지하고, 캠페인 세션 내림차순 비교를 접힌 상세 표 밖에 추가했습니다.
- 홈, 검색, 분실물/습득물 게시판, 분실물/습득물 등록의 여섯 목적지를 지원합니다. 잘못된 목적지는 홈으로 조용히 바꾸지 않고 오류로 처리합니다.
- URL 복사, 실시간 QR, PNG·SVG 다운로드를 유지합니다. 공용 `sanitizeUtm` 검증을 사용하므로 수집기가 받지 않는 값을 생성하지 않습니다.
- 등록 페이지의 검증된 UTM을 로그인 복귀 주소에 보존합니다. 동의·닉네임·실명/학과 확인 및 재로그인에서도 복귀 주소를 유지합니다.
- 상위 레이아웃이 페이지보다 먼저 동의/닉네임 게이트를 실행하는 경우도 처리합니다. Next.js `proxy`가 등록·실명 확인 경로에 한해 검증된 복귀 주소를 요청 헤더로 전달합니다. 클라이언트가 보낸 같은 이름의 헤더는 덮어씁니다.
- 첫 렌더링이 로그인/가입 화면인 경우 방문 비콘이 검증된 `callbackUrl` 안의 UTM도 읽습니다. 세션 시작 여부 판단, 중복 방지, 관리자·봇·통계 제외 설정은 기존 동작을 유지합니다.
- DB 스키마·마이그레이션·기존 카운터·집계 뷰는 변경하지 않았습니다. `utm_content`는 수집하지 않으며 장소와 용도를 기존 캠페인에 함께 넣습니다. 출처·매체·캠페인은 각각 독립 합계이며 교차 집계로 표시하지 않습니다.

## 포스터 설정과 파일

- 출처: `poster_qr`
- 매체: `offline`
- 인문캠퍼스 경비실 코드: `guard01`~`guard08`
- 분실물 찾기: `h_guard01_find` → `/found` (습득물 목록에서 잃어버린 물건 찾기)
- 습득물 등록: `h_guard01_register` → `/found/new`
- 게시판 예: 장소 코드 `board01` → `h_board01_find`, `h_board01_register`

경비실마다 위 두 용도로 총 16개 캠페인을 생성했습니다. 실제 생성기 UI를 통해 PNG 16개와 SVG 16개를 다운로드했습니다.

- 파일 묶음: `.vercel/utm-posters.zip`
- 개별 파일: `.vercel/utm-posters/`
- 16개 URL과 장소·용도 대응: `.vercel/utm-posters/links.json`

경비실의 실제 명칭과 게시판 설치 장소는 제공되지 않았으므로 임의로 만들지 않았습니다. `guard01`~`guard08`과 실제 경비실을 대응시키고, 게시판은 장소마다 고유 코드를 정해 사용하세요. 코드를 바꾸면 다른 캠페인으로 집계됩니다.

기존 수집기는 서버 인스턴스별로 UTM 종류마다 하루 30종까지 구분하고, 이후 처음 본 값은 `etc`로 묶습니다. 경비실만 16종이며 기존 홍보와 게시판 캠페인도 한도에 포함됩니다. 같은 세션에서 두 번째 QR을 열어도 최초 유입만 집계됩니다. 이 제한을 바꾸거나 별도 클릭 수로 의미를 변경하지 않았습니다.

생성 링크·QR의 목적지는 기존 정책대로 **Production 도메인**입니다. 이번 검증은 동일 경로·쿼리를 Preview에 적용해 수행했습니다. 개선한 가입 복귀 동작은 Production 배포 이후 실서비스 링크에 적용됩니다.

## 검증 결과

| 검사 | 결과 |
| --- | --- |
| 전체 테스트 `npm test -- --maxWorkers=2` | 233개 파일, 2,713개 테스트 통과 |
| 타입 검사 `npx tsc --noEmit` | 통과 |
| 로컬 빌드 `npm run build` | 통과 |
| 최종 Preview 빌드 | 통과, READY, `/admin/utm` 및 Proxy 포함 |
| 소스 린트 `npx eslint src scripts next.config.ts vitest.config.ts` | 통과 |
| 추가 레이아웃 회귀 테스트와 Proxy 개별 린트 | 통과 |
| 전체 `npm run lint` | 기존 `.vercel` 임시·생성 파일 때문에 실패: 17 errors, 882 warnings |
| Preview 홍보 전용 계정 | 생성기 접근·기존 통계 URL 이동 성공, 통계 바로가기 미노출 |
| Preview 통계 전용 계정 | 통계 접근 성공, 생성기 접근 거부·생성 바로가기 미노출 |
| Preview 전체 관리자 | 통계의 생성기 바로가기 표시 |
| 브라우저 QR | 실시간 변경·잘못된 값 차단·PNG/SVG 다운로드 성공 |
| 390px 모바일 / 1280px 데스크톱 | 화면 확인, 가로 넘침 없음 |
| 비로그인 등록 QR | 로그인 복귀 쿼리 보존 성공 |
| 로그인 후 닉네임 설정 | 실제 폼 제출 후 `/found/new` 도착 성공 |
| 실제 캠페인 집계 | `qa_register_mw8whpc2`가 Preview `OperationalMetricDaily`에서 1세션 |
| 중복·관리자 제외 | 로그인/등록 새로고침, 동일 캠페인 관리자 방문 후에도 위 값 1 유지 |
| 통계 조회 연동 | 실제 기록된 위 캠페인을 운영 통계에서 확인 |

전체 테스트의 최초 실행은 과도한 병렬 실행으로 메모리가 부족했습니다. 동시 실행을 2개로 제한한 전체 재실행은 통과했습니다. 기존 린트 오류를 없애기 위해 무관한 임시 파일을 삭제하거나 린트 설정을 변경하지 않았습니다.

브라우저 증거는 `.vercel/utm-browser-qa.json`, `.vercel/utm-generator-desktop.png`, `.vercel/utm-generator-mobile.png`에 있습니다. 배포·별칭·실집계 확인은 `.vercel/utm-preview-verification.json`에 기록합니다. 인증정보는 결과 문서와 증거 JSON에 포함하지 않습니다.

검증에 사용한 Preview 임시 계정 4개와 해당 권한·활동 기록은 정리했습니다. 검증 캠페인의 익명 합계는 Preview 통계에 남겨 확인할 수 있습니다.

## 변경 파일

관리자 도구·통계:

- `src/app/(main)/admin/utm/page.tsx` (신규)
- `src/app/(main)/admin/utm/page.test.tsx` (신규)
- `src/app/(main)/admin/page.tsx`
- `src/app/(main)/admin/stats/page.tsx`
- `src/components/admin/UtmLinkBuilder.tsx`
- `src/components/admin/InflowView.tsx`
- `src/lib/permissions/definitions.ts`
- `src/lib/metrics/utmLink.ts`, `utmLink.test.ts`

등록 복귀·유입 수집:

- `src/proxy.ts`, `src/proxy.test.ts` (신규)
- `src/lib/metrics/landing.ts`, `landing.test.ts` (신규)
- `src/lib/auth/onboardingUrl.ts` (신규)
- `src/app/(main)/layout.tsx`, `layout.test.tsx` (테스트 신규)
- `src/app/(main)/found/new/page.tsx`
- `src/app/(main)/lost/new/page.tsx`
- `src/app/(main)/me/identity/page.tsx`, `actions.ts`
- `src/app/(auth)/login/page.tsx`
- `src/app/(auth)/onboarding/page.tsx`, `NicknameForm.tsx`, `actions.ts`, `actions.test.ts`
- `src/lib/auth/session.ts`, `session.test.ts`
- `src/components/layout/VisitBeacon.tsx`
- `src/app/visitActions.test.ts`
- `docs/UTM_ADMIN_PREVIEW_REPORT.md` (이 문서)

## 남은 확인 사항

- Google OAuth 승인 화면은 자동 조작하지 않고 Preview 테스트 세션으로 대체했습니다. 실제 학교 계정의 OAuth 승인과 인쇄된 QR의 실기기 스캔은 미검증입니다.
- 경비실의 실제 명칭과 번호의 대응, 게시판의 설치 장소 코드는 운영 측에서 결정해야 합니다.
- 실서비스는 기존 버전입니다. Production 반영은 수행하지 않았습니다.
