# 보안 강화 작업 (2026-11-22)

[종합 보안 감사(2026-11-21)](security-audit-comprehensive-2026-11-21.md) 후속 작업이다.

- 대상: A-1 Production 배포, P-5·A-4·A-3·A-5 구현과 격리 Preview 검증, A-2 판단, 운영 계정·백업 보안 설계, 11-22 예약 작업 확인
- 상태 요약: **A-1만 Production에 반영했다.** 나머지는 Preview까지만 반영했고, Production 마이그레이션·배포는 별도 승인을 기다린다.

## 0. 11월 22일 예약 작업

| 작업 | 예정 | 실제 | 결과 |
|---|---|---|---|
| Vercel cron `embedding-maintenance` | 02:00 | 02시대 `GET /api/posts` 1건, 오류 0 | 정상 |
| Vercel cron `/api/admin/settings`(보존 정리) | 03:00 | 03시대 `GET /api/admin/settings` 1건, 오류 0 | 정상 |
| PC 예약 백업 | 04:00 | **11:09 지연 실행**(작업 스케줄러가 svchost로 시작, 수동 아님) | 백업 57개 테이블, 사진 135개, 암호화·복원 검증 통과(`auto-2026-11-22.tar.enc`, 24.9MB) |

- cron 확인은 Production 읽기 전용 집계 1회로 했다(`read-scheduled-status.mjs 2026-11-22`, 승인 참조 `CRON-CHECK-2026-11-22`). 경로별 시간 집계만 조회했다.
- **04:00 누락 원인**
  - 03:21 덮개를 닫아 Modern Standby(S0 저전력 유휴)에 들어갔다.
  - 당시 AC 전원이 연결돼 있었고(23:16 연결 → 11:08 분리), AC 절전 타이머도 '사용'이었다.
  - 그런데도 04:00에 깨어나지 않았다. 11:08 덮개를 연 직후 '놓친 작업 실행'(StartWhenAvailable)으로 실행됐다.
  - 결론: **이 PC는 Modern Standby에서 WakeToRun이 동작하지 않는다(AC 연결 상태 포함).** 작업 스케줄러 Operational 로그가 꺼져 있어(관리자 권한 필요) 스케줄러 내부 기록은 확인하지 못했다.
  - 대응 후보
    - 오프사이트 백업(GitHub Actions)으로 PC 의존 제거: [backup-offsite-design-2026-11-21.md](backup-offsite-design-2026-11-21.md)
    - 또는 AC 연결 시 덮개를 닫아도 절전하지 않도록 설정
- 기존 백업은 7개 그대로 보존했다(삭제 없음).

## 1. A-1 Production 배포 (완료)

- **배포**: `dpl_FvfFRQppnqXaT7sdybBHknhjN9f9`(`fc947bb`), `--csp-mode=report-only`. 롤백 대상은 `dpl_GFjSiuYqn8TCsMz68ddQkCUh2g3q`(`8a67cdd`)다. DB 변경과 데이터 변경은 없다.
- **배포 전 추가 수정**(`fc947bb`)
  - '내 댓글'(`/me/comments`)과 관리자 회원 상세가 숨김·삭제된 글의 **제목**을 보여주던 문제를 고쳤다. 이제 볼 권한이 없으면 '숨김 또는 삭제된 게시글'로 표시하고 링크를 없앤다.
  - 같은 `canViewPost` 규칙을 쓴다.
- **점검한 댓글 경로**

| 경로 | 결과 |
|---|---|
| 댓글 API | 404 |
| 상세 페이지 | 숨김 화면 또는 404, 댓글 미조회 |
| 목록·검색·개수 | `PUBLIC_POST_WHERE`로 제외 |
| 정렬 `commentCount` | 공개 글만 대상 |
| 알림 링크 | 상세 페이지 게이트로 차단 |
| 신고 대상 확인 | 내용 반환 없음 |
| 캐시 | 응답에 공유 캐시 헤더 없음, 모든 경로 동적 |

- **Preview 검증**(`dpl_BcGvU7Ym…`): `hidden-post-comments.mjs` 3/3. 정상 상태에서는 API·페이지·목록에 나오고, 숨김·삭제 상태에서는 API 404, 페이지에 댓글 원문 없음, 목록 미노출, 공유 캐시 없음을 확인했다. 단위 테스트 3,159개.
- **Production 검증**: 프로브 16/16(버전 `fc947bb`, 인증 경계 401 포함), 보안 헤더 12/12(Report-Only 유지), CSRF 10/10, 익명 브라우저(Chromium·WebKit) 통과, 런타임 오류·5xx 0.
  - 익명 브라우저 검사의 처음 두 번은 WebKit의 RSC prefetch 'access control checks' 오류(6건)로 실패했다. 배포 약 10분 뒤 세 번째 실행에서 0건이었고, 직접 재현도 되지 않았다.
  - 배포 직후 캐시가 비어 있을 때, 다른 페이지로 이동하면서 중단된 prefetch로 판단한다(지난 배포 때와 같은 현상, 5xx 0).
- **배포 이력**: 이전 D-4 배포와 같이 Preview DB에만 기록했다. Production DB 쓰기는 하지 않았다.

## 2. 구현 (Preview 검증 완료, Production 미반영)

- 브랜치: `security/hardening-2026-11-22`(`b412ddb`, `905ba25`)
- Preview: `dpl_6JhJWXAi91fiHjTXd1Y9eRQApoW4`(`905ba25`)
- Preview DB 마이그레이션 적용: `20261125000000_user_sessions_valid_after`, `20261125010000_upload_intents`

### P-5 세션 서버 측 무효화

- **문제**: JWT 세션(30일)은 서버에 상태가 없어, 탈취된 쿠키를 로그아웃 뒤에도 쓸 수 있었다.
- **설계**: `getCurrentUser()`(모든 페이지·API·Server Action의 단일 관문)가 매 요청 두 가지를 확인한다.
  1. **이 기기 로그아웃**
     - 쿠키마다 로그인 때 정한 `realtimeSessionId`가 있다.
     - 로그아웃 시 Auth.js signOut 이벤트가 이미 `ChatRealtimeSession`에 폐기 기록을 남긴다. 이제 그 기록을 확인해 같은 쿠키의 복사본을 거부한다.
     - 새 테이블이 필요 없다.
  2. **모든 기기 로그아웃·관리자 강제 종료**
     - `User.sessions_valid_after`(새 nullable 컬럼)보다 먼저 로그인한 세션(`authTime`)을 거부한다.
     - 이번 배포 전에 발급된 쿠키는 `authTime`이 없어 0으로 취급하므로, 기준 시각이 생기면 함께 끊긴다.
     - Realtime 세션·grant도 즉시 폐기하고, 푸시 구독도 지운다.
- **화면**
  - `/me`: '모든 기기에서 로그아웃'(현재 기기 포함, 다시 로그인 필요)
  - 관리자 회원 상세: '로그인 강제 종료'
    - `users.sanction` 권한이 필요하다. 대상이 관리자면 전체 관리자만 할 수 있다.
    - 계정을 정지하지 않으며, 관리자 활동에 `user.sessions_revoke`로 기록한다.
    - Serverless 함수를 늘리지 않도록 기존 `PATCH /api/admin/users/[id]`에 `action: "revoke_sessions"`로 붙였다.
- **비용**: 요청마다 인덱스(PK) 조회 1회가 늘어난다. 권한 조회와 병렬로 실행한다.
- **한계**
  - 거부된 쿠키도 브라우저에는 남는다(서버가 비로그인으로 취급).
  - `AUTH_SECRET` 자체가 유출되면 이 장치로 막을 수 없다. 이때는 교체해야 한다(§5).

### A-4 익명 AI 검색

- **IPv6 묶음**: 익명 카운터를 IPv4 주소 또는 **IPv6 /64** 단위로 센다. 한 호스트가 /64 안에서 주소를 바꿔도 같은 한도가 적용된다.
- **서비스 전체 상한**(DB 카운터, 모든 인스턴스 공유)

| 상한 | 분당 | 일 | 초과 시 |
|---|---|---|---|
| 익명 전체(`aiSearchAnonymousGlobal`) | 60 | 1,500 | 익명만 429 `AI_SEARCH_BUSY`("로그인하면 계속 이용") |
| 전체(`aiSearchGlobal`) | 200 | 8,000 | 모두 429 |
| 개인(기존) | 회원 20 / 익명 네트워크 10 | 회원 300 / 익명 200(100에서 상향) | 429 |

- **공동 네트워크 고려**
  - 학교 NAT 뒤 다수 학생은 같은 IPv4 주소를 쓴다. 그래서 네트워크별 일 한도는 공정성용으로만 두고(200), 비용 한도는 전체 상한이 맡는다.
  - 로그인 학생은 익명 상한에 포함되지 않아 익명 폭주에 막히지 않는다.
  - 통합 검색은 상한에 걸리면 키워드 결과로 자동 전환한다(기존 동작).
- **순서**: 개인 한도에 먼저 걸리면 공용 상한을 소모하지 않는다. 한 명이 공용 예산을 혼자 쓸 수 없다.
- **감시**
  - `MetricDaily`에 `ai_search.admitted.{anon|member}`, `ai_search.limited.{scope}.{self|anon_global|global}`, `ai_search.unavailable.*`를 기록한다.
  - 주소나 검색어는 남기지 않는다.

### A-3 미첨부 업로드

- **기록**: 업로드 서명을 발급할 때 `UploadIntent`(새 테이블)에 경로를 기록한다. 게시글 사진과 채팅 사진 모두 대상이다.
  - 클라이언트 역할 권한을 회수하고 RLS를 켰다(정책 0, 서버 전용).
- **상한**: 최근 24시간 안에 발급받고 아직 첨부하지 않은 업로드는 회원 **40개**, 직원 **300개**까지다. 넘으면 429를 반환한다. 기존 분·일 요청 제한도 그대로 적용된다.
- **첨부 표시**: 게시글 사진 설정·추가, 채팅 사진 전송 시 첨부로 표시한다. 표시에 실패해도 첨부는 성공하며, 정리 단계에서 참조를 다시 확인한다.
- **자동 정리**: 매일 03:00 cron(기존 보존 정리 경로)이 발급 후 24시간이 지나도 첨부되지 않은 파일을 지운다.
  - 지우기 직전에 게시글·갤러리·채팅(과거 URL 포함) 참조를 다시 확인하고, 참조가 있으면 첨부로 표시한다.
  - 앱 이름 규칙에 맞는 경로만 지우며, 한 번에 200개까지 처리한다.
  - Storage가 삭제를 확인한 경우에만 '삭제됨'으로 기록한다.
- **기존 고아 파일**(기록이 생기기 전 업로드)은 기존 수동 도구 `scripts/sweepPostImageOrphans.ts`로 처리한다(기본값은 dry-run).

### A-5 공개 조회 폭주

- **구현**: 목록·검색·상세 페이지와 공개 조회 API(`GET /api/posts`, `/api/posts/[id]`, `/api/posts/[id]/comments`)에 인스턴스 메모리 제한기를 둔다.
  - DB에 카운터를 쓰면 막으려는 부하가 두 배가 되므로 쓰지 않는다.
  - 같은 프로세스 안에서는 페이지와 API가 카운터를 공유한다.
- **한도**
  - 네트워크(IPv4 주소 / IPv6 /64)당 분당 600건. 로그인 여부와 관계없이 센다. 학교 NAT 사용을 고려해 넉넉히 잡았다.
  - 인스턴스당 비로그인 요청이 분당 3,000건을 넘으면 비로그인 요청부터 차단한다. 로그인 회원은 계속 쓸 수 있다.
  - 세션 쿠키를 위조하면 인스턴스 차단은 피할 수 있지만, 네트워크 한도는 피할 수 없다.
- **차단 시**: API는 429 `READ_BUSY`, 페이지는 DB 작업이 없는 정적 안내 페이지 `/busy`로 보낸다.
- **한계**
  - 인스턴스 단위라서 널리 분산된 공격은 막지 못한다. 이는 플랫폼에서 막아야 한다.
    - Vercel Firewall Attack Challenge Mode: 모든 플랜에서 대시보드로 켤 수 있다.
    - Hobby 플랜의 사용자 정의 규칙·속도 제한 범위: **확인 필요**
  - DB 연결 풀(인스턴스당 기본 최대 10)과 쿼리 시간 제한은 성능 회귀 위험 때문에 이번에 바꾸지 않았다. Production 부하 데이터를 본 뒤 조정을 권고한다.
- **CDN 캐시를 쓰지 않은 이유**: 숨김·삭제 직후 목록·상세가 캐시에서 계속 노출될 수 있다(A-1과 같은 종류의 위험). 또 로그인 사용자에게 익명용 캐시 응답이 섞일 수 있다.

### 검증

- **단위 테스트**: 285개 파일, 3,201개 통과. 타입 검사와 린트 통과.
  - 기존 테스트는 삭제하거나 약화하지 않았다.
  - 번역 키 개수 고정값 936→938은 새 키 2개를 추가한 데 따른 갱신이다.
  - `posts/route.test.ts`는 같은 의도의 검사를 새 진입점(`admitAiSearch`) 기준으로 유지했다.
- **`scripts/regression/hardening-local.mjs` 24/24**: 로컬 `next start`(일회용 AUTH_SECRET, `VERCEL=1`) + Preview DB·Storage에서 실행했고, 정리까지 확인했다.

| 범위 | 확인 내용 |
|---|---|
| P-5 (7) | 로그아웃한 세션 복사본 401, 다른 기기 유지 / 일반 회원의 강제 종료 403 / 제재 권한만 가진 관리자가 전체 관리자 대상으로 시도 시 403 / 교차 사이트 403(P-2 유지) / 거부된 시도 뒤 변화 없음 / 강제 종료 후 기존 세션과 배포 전 형식 쿠키 401, 새 로그인 200, 감사 기록 1건, 열린 Realtime 세션 0 / 관리자 본인 유지 |
| A-4 (5) | 같은 /64에서 주소를 바꿔도 429 / 익명 전체 상한에서 새 네트워크 429 `AI_SEARCH_BUSY` / 같은 상황에서 로그인 회원 200 / 통합 검색 200(키워드 전환) / 키워드 검색 영향 없음 |
| A-3 (5) | 발급 기록 / 상한 초과 429, 기록 추가 없음 / 남의 글 403 / 정리 시 미첨부 실제 객체 삭제, 갤러리가 쓰는 객체 보존·첨부 표시 / 24시간 미만은 유지 |
| A-5 (7) | 601번째 요청 429 `READ_BUSY` / 차단된 네트워크의 `/lost`는 `/busy`로 이동(목록 미노출) / `/busy` 200 / 다른 네트워크의 목록·상세·댓글 정상 |

- **공유 카운터**: 검증용으로 공유 카운터 값을 미리 채웠다가, 끝난 뒤 원래 값으로 되돌렸다.
- **기존 회귀**: `csrf-local.mjs` 20/20. 호스팅 Preview에서 `hidden-post-comments.mjs` 3/3, `csrf-hosted.mjs` 10/10.
- **호스팅 Preview** `hardening-hosted.mjs`: 익명 AI 검색 200, 공용 상한 카운터 생성·증가, 목록·`/lost`·`/busy` 200. 런타임 오류·5xx 0.
- **실제로 공격해 본 것**: 세션 복사본 재사용, 권한 없는 강제 종료, 교차 사이트 요청, IPv6 주소 회전, 공용 상한 소진, 업로드 상한 초과, 남의 글 업로드, 단일 네트워크 폭주. 모두 격리 Preview 데이터와 로컬 서버에서만 했다.
- **미검증**
  - 브라우저에서 `/me`의 '모든 기기에서 로그아웃' 버튼과 관리자 화면 버튼을 누르는 흐름(서버 함수는 같은 코드로 검증)
  - 실제 Google 로그인 후 `authTime` 기록
  - 여러 인스턴스로 분산된 폭주

## 3. Production 반영 계획 (승인 필요)

순서가 중요하다. 새 코드는 `User.sessions_valid_after`를 읽으므로, **마이그레이션 전에 배포하면 로그인 사용자 요청이 실패한다.**

1. 배포 전 암호화 백업과 복원 검증(당일 예약 백업 재사용 가능)
2. Production 마이그레이션 2건(추가 전용): `node scripts/db/approved-operation.mjs --confirm-production --approval-reference <승인ID> -- …`. 기존 Production 마이그레이션 절차를 따른다.
3. `node scripts/deployments/deploy.mjs production --csp-mode=report-only`
4. 배포 후 프로브, 헤더, CSRF, 익명 브라우저 검사, 로그 확인
5. 다음 날 03:00 cron 로그에서 `unattachedUploads` 결과 확인

- **롤백**: 이전 배포로 즉시 롤백할 수 있다. 추가된 컬럼과 테이블은 이전 코드가 무시하므로 되돌릴 필요가 없다.
- **사용자 영향**: 배포 직후에는 아무도 로그아웃되지 않는다(기준 시각이 비어 있음).

## 4. A-2 Supabase Auth 판단

**결론: MJU Find의 어떤 기능도 Supabase Auth(이메일 가입)를 쓰지 않는다. 꺼도 된다.**

| 영역 | 확인 |
|---|---|
| 로그인 | Auth.js v5 + Google(`src/lib/auth/auth.ts`). `auth.users`를 읽거나 쓰는 코드 없음 |
| Realtime 수신 토큰 | 앱이 자체 ES256 키(`MJU_REALTIME_PRIVATE_JWK`)로 직접 서명(`realtimeToken.ts`). Supabase에는 **JWT 서명 키(JWKS)로 등록**돼 있을 뿐, Auth 가입·로그인과 무관 |
| Storage | 서버의 service_role과 업로드 서명 토큰만 사용. 브라우저 클라이언트는 anon 키로 서명 URL 업로드만 함 |
| 운영 자동화·백업 | DB 직접 연결과 service_role만 사용. Auth API 호출 없음(JWKS 공개 조회만 있음) |
| Preview 실측 | `auth.users` 0, `auth.identities` 0, 세션 0, refresh token 0(`supabase-auth-usage.mjs`, 개수만) |
| Production 실측 | **미확인**. `auth` 스키마 조회가 이번 승인 범위 밖이라 실행하지 않음 |

**대시보드에서 바꿀 설정**(Production·Preview 프로젝트 각각)

1. Authentication → **Sign In / Providers** → **User Signups**
   - **Allow new users to sign up**: 끔
   - **Allow anonymous sign-ins**: 끔(이미 꺼져 있다면 그대로)
   - **Allow manual linking**: 끔(이미 꺼져 있다면 그대로)
2. 같은 화면 **Auth Providers** 목록
   - **Email**: 끔(Enable Email provider 해제)
   - **Phone**: 끔
   - 나머지 소셜 공급자: 모두 꺼진 상태 유지

**절대 건드리지 말 것**
- Authentication → **JWT Keys(Signing Keys)**: Realtime 수신 토큰 검증에 쓴다. 키를 폐기·교체하면 채팅 실시간 수신이 끊긴다(polling으로는 계속 동작).
- API 키(anon/publishable, service_role)

**끈 뒤 확인**
- 채팅 실시간 수신(Preview 2인 회귀 `realtime-two-member.py`)
- 사진 업로드
- 다음 날 백업 결과

**선택 확인**: Production `auth.users` 개수가 0이 아니면 누군가 가입한 것이다. 개수만 확인하려면 `supabase-auth-usage.mjs`를 승인된 실행기로 1회 실행한다(별도 승인).

## 5. 운영 계정·자격증명·백업 보안

### 5-1. 관리자 계정 MFA 점검표

이메일이나 비밀번호 원문은 기록하지 않는다.

| 계정 | 확인 항목 | 권장 |
|---|---|---|
| Google(관리자로 쓰는 학교 계정 전부) | 2단계 인증 켜짐, 복구 수단 최신, 낯선 기기 세션 없음 | 패스키 또는 보안 키 |
| Vercel | 2FA 켜짐, 팀 구성원·토큰 목록(쓰지 않는 CLI 토큰 폐기), 로그인 방식 | 패스키 |
| Supabase(조직 소유자) | MFA 켜짐(조직 설정에서 MFA 강제 가능 여부), 조직 구성원, Access Tokens 목록 | TOTP 이상 |
| GitHub | 2FA 켜짐, PAT·SSH 키·Deploy key·OAuth 앱 목록, `vercel` 브랜치 보호 규칙 | 패스키 |
| Cloudflare(오프사이트 도입 시) | 2FA, R2 토큰 범위 | - |
| 운영 PC Windows 계정 | 로그인 암호 또는 PIN, BitLocker(장치 암호화) 켜짐, 화면 잠금 | - |

- 확인 주기: 분기 1회, 그리고 관리자를 추가하거나 바꿀 때.
- 결과는 날짜와 '예/아니오'만 운영 문서에 기록한다.

### 5-2. 운영 PC의 DB 자격증명과 백업 복호화 암호 분리

**현재 상태**

| 자격증명 | 위치 | 권한 |
|---|---|---|
| Production DB `postgres` 계정 | `.env.operations-production`(파일) | 소유자. 백업·마이그레이션·운영 공용 |
| 백업 암호(대칭) | Windows 자격 증명 관리자 | 백업 암호화·복호화 모두 |

PC 하나만 탈취돼도 DB 전체 쓰기와 모든 과거 백업 복호화가 함께 가능하다.

**설계**(실제 변경은 승인 후)

1. **백업 암호화를 비대칭으로 전환(age)**
   - PC에는 수신자 **공개키**만 둔다. 공개키로는 암호화만 된다.
   - **개인키**는 PC 밖에 둔다: 비밀번호 관리자와 오프라인 인쇄본.
   - 일일 복원 검증은 암호화 직전의 평문으로 PC에서 하고, 암호문 무결성은 해시로 확인한다.
   - 월 1회 운영자가 개인키로 실제 복호화·복원을 훈련한다.
   - 효과: PC가 탈취돼도 **과거 백업**은 열리지 않는다.
2. **백업 전용 읽기 계정 `backup_reader`**
   - `SELECT`만 주고 `default_transaction_read_only`로 쓰기를 막는다. 예약 백업은 이 계정만 쓴다.
   - RLS 테이블 처리(`BYPASSRLS` 가능 여부)는 오프사이트 설계 §4 그대로 Preview에서 먼저 확인한다.
   - **Production 역할·권한 변경이므로 별도 승인이 필요하다.**
3. **`postgres` 계정을 평소 디스크에서 치움**
   - `.env.operations-production`을 마이그레이션·승인 작업 때만 비밀번호 관리자에서 꺼내 쓰고, 끝나면 지운다.
   - 대안: DPAPI로 보호된 자격 증명 관리자에 저장하고, `approved-operation.mjs`가 실행 시점에만 읽는다. 이 방식은 코드 변경이 필요하다.
4. PC 디스크 암호화(BitLocker)와 화면 잠금을 확인한다(§5-1).

### 5-3. 오프사이트 암호화 백업 자격증명 분리

[backup-offsite-design-2026-11-21.md](backup-offsite-design-2026-11-21.md) §4 표를 따른다. 이번에 더한 원칙은 다음과 같다.

- **세 자격증명을 서로 다른 곳에 둔다**
  - CI(GitHub Actions Environment): DB 읽기 + R2 **쓰기 전용**
  - 운영자 PC: R2 **읽기 전용**
  - 오프라인: age 개인키
- 어느 한 곳이 탈취돼도 '읽기 + 복호화 + 삭제'가 한꺼번에 가능해지지 않는다.
- R2 버킷은 보존 잠금(Bucket Lock) 또는 수명 주기 규칙을 쓰고, 쓰기 토큰에서 삭제 권한을 뺀다. 랜섬웨어나 계정 탈취로 기존 백업을 지우는 것을 막는다.
- GitHub Environment 보호
  - 실행 브랜치는 `ops/backup`으로 제한한다.
  - 필수 검토자를 두거나, 예약 실행만 허용한다.
  - secret은 해당 Environment에만 둔다.
- 복원 절차
  1. R2 읽기 토큰으로 암호문을 내려받는다.
  2. 오프라인 개인키로 복호화한다.
  3. 기존 `verify-restore.mjs`로 격리 복원 검증을 한다.
  4. 결과 해시를 기록한다.
- **실제 R2·GitHub 연결, 저장 위치 변경은 별도 승인이 필요하다.**

### 5-4. 비밀값 교체·계정 탈취 대응 절차

**공통 원칙**
- 교체 전 백업을 확인한다.
- Preview를 먼저 바꾸고 검증한다.
- Production 교체는 승인을 받은 뒤 한다.
- 교체 후 프로브·로그로 확인한다.
- 원문은 출력·저장하지 않는다.

| 비밀값 | 교체 방법 | 영향 | 교체 후 확인 |
|---|---|---|---|
| `AUTH_SECRET` | Vercel env 교체 → 재배포 | **전원 로그아웃**, 익명 요청 제한 카운터 키 초기화 | 로그인, 관리자 화면 |
| DB 비밀번호(`postgres`) | Supabase에서 재설정 → Vercel `DATABASE_URL`·`DIRECT_URL`, `.env.operations-production`, 백업 worktree 설정 갱신 → 재배포 | 교체~재배포 사이 DB 오류 | 프로브, 다음 백업 |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase API 키 재발급(새 secret key 방식이면 개별 폐기 가능) → Vercel env, 백업 설정 갱신 → 재배포 | Storage 업로드·삭제, 증거 열람 | 사진 업로드, 백업 Storage 단계 |
| `MJU_REALTIME_PRIVATE_JWK` | 새 키를 대기 키로 Supabase JWKS에 등록 → env 교체 → 이전 키 폐기(기존 `release-d3.mjs`·standby 절차) | 전환 중 polling | `realtime-two-member` |
| `CRON_SECRET` | Vercel env 교체 → 재배포 | 없음 | 다음 날 cron |
| `GOOGLE_CLIENT_SECRET` | Google Cloud 콘솔에서 새 secret 발급 → env → 재배포 → 이전 것 삭제 | 짧은 로그인 실패 | Google 로그인 |
| `WITHDRAWN_IDENTITY_SECRET` | **교체 금지**(기존 탈퇴 해시와 대조가 끊김). 유출 시 영향 평가 후 이중 키 이행 설계 | - | - |
| 백업 암호 | 새 암호로 이후 백업 생성. 과거 백업은 기존 암호 보관(삭제 금지) | 없음 | 다음 백업 복원 검증 |

**계정 탈취가 의심될 때**

1. **보존**
   - Vercel 로그(약 50행씩 수집)와 관리자 활동·제재·실명 열람 기록을 내보낸다.
   - Supabase·Vercel·GitHub 감사 로그 화면을 캡처한다.
2. **차단**(범위에 따라)
   - 회원 1명: 관리자 화면 '로그인 강제 종료'(P-5 배포 후), 필요하면 정지
   - 관리자 계정: 권한 회수(권한 관리), 강제 종료, Google 계정 비밀번호·세션 초기화
   - Vercel·Supabase·GitHub 계정: 비밀번호·MFA 재설정, 토큰 전부 폐기, 의심 배포 롤백
   - 서명 키 유출 의심: `AUTH_SECRET` 교체(전원 로그아웃)
3. **범위 확인**
   - 감사 기록과 최근 검증 백업을 비교한다.
   - 의심 배포의 코드 차이를 확인한다.
4. **통지 판단**: 감사 보고서 §7의 72시간 원칙에 따른다(법률 확인 필요).
5. **복구·재발 방지**: 원인 기록, 점검표 갱신.

## 6. 남은 위험

- **백업**: PC가 덮개를 닫은 상태에서는 예약 백업이 실행되지 않는다(실효 RPO 최대 하루 이상). 오프사이트 전환 전까지 계속되는 위험이다.
- **A-5**: 분산 폭주는 플랫폼 기능(Firewall)에 의존한다. Hobby 플랜 범위는 미확인이다.
- **P-5 / A-3 / A-4 / A-5**: Production 미반영. 반영 전까지 감사 시점의 위험이 그대로 남는다.
- **A-2**: 사용자가 대시보드에서 끄기 전까지 가입이 열려 있다. 데이터 접근은 차단된 상태다.
- **계정 MFA, Supabase 관리형 백업·PITR**: 미확인.
