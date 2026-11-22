# 보안 강화 릴리스(P-5·A-3·A-4·A-5) Production 적용 계획

상태(2026-11-22): **준비 완료, 실행하지 않음.** Production 마이그레이션·권한 변경·배포는 승인을 기다린다.

## 1. 대상과 차이

- **배포할 코드**: `security/hardening-2026-11-22`(`e74f6cc` 이후). 현재 Production은 `dpl_ZNj7p6cL…`(`dede9ce`)다.
- **앱 변경**(Production 대비): P-5, A-3, A-4, A-5와 번역 키, `accessPolicy`의 `backup_reader` 인식.
  - DB TLS 파일(`tls.ts`, `prisma.ts`, `certs/`)은 Production과 같다.
  - 패키지·`next.config`·`vercel.json` 변경은 없다.
- **Preview 전체 검증 이후의 변경**: 기능 코드는 `905ba25`(Preview 전체 검증) 이후 바뀌지 않았다. 앱 쪽 변경은 이미 Production에 있는 TLS와 `accessPolicy`뿐이므로 이전 검증 결과가 그대로 유효하다.
- **스키마**: 마이그레이션 2건(추가만 함)
  - `20261125000000_user_sessions_valid_after`: `User`에 nullable 컬럼 1개
  - `20261125010000_upload_intents`: 새 테이블 `UploadIntent`(RLS on, anon·authenticated 권한 회수, 하나의 트랜잭션)

## 2. 검증 결과 (이번 준비)

| 항목 | 결과 |
|---|---|
| Production 마이그레이션 상태(읽기 전용) | 대기 중 = 정확히 2건(순서 일치), 실패 기록 0, 모르는 이력 0 |
| Production 백업 복원본에 리허설(`auto-2026-11-22`, 04:00 백업) | 체크섬 144개 일치, 테이블 57 행 수 일치, 사진 135개, 2건 순서대로 적용, `RESTORE VERIFIED`. 복원본은 자동 삭제 |
| 하위 호환: 현재 Production 클라이언트 ↔ 마이그레이션 후 스키마(Preview) | 통과, 누락 0, 경고 0. 마이그레이션 후 앱 롤백 가능 |
| 새 클라이언트 ↔ 마이그레이션 후 스키마(Preview) | 통과(57 / 520 / 19) |
| 새 클라이언트 ↔ 현재 Production DB | **차단**(`UploadIntent`, `User.sessions_valid_after` 누락). 게이트 정상 동작 |
| 클라이언트 = checkout 스키마 | 통과 |
| `UploadIntent` 권한(Preview, 회수 후) | RLS on, 정책 0, anon·authenticated·authenticator 권한 없음, `backup_reader` SELECT만, service_role 없음 |
| Production 기본 권한(읽기 전용 감사) | 새 테이블 상속 = postgres 전체 + service_role `Dxtm` + `backup_reader` SELECT. Preview와 같음. anon·authenticated는 public 스키마 사용 권한도 없음 |
| P-5 기존 세션 영향(Production, 개수만) | 유효 세션 6개: 정상 1, 로그아웃 폐기 5(쿠키가 이미 삭제됨), 트리거 일괄 폐기 0. `sessions_valid_after`는 모두 NULL → **배포만으로 로그아웃되는 사용자 0** |
| A-3 dry-run | Production: 테이블 없음 → 대상 0. 기존 Storage 파일은 구조상 대상이 될 수 없음. 저장된 게시글 사진 URL 형식 불일치 0(참조 재확인이 빗나가지 않음) |
| A-5 탐색 실측(Preview, 익명) | 일반 탐색 22초에 한도 대상 27건(문서 4, RSC/프리페치 22, API 1) ≈ 분당 75건. 프리페치도 서버 함수로 실행돼 한도에 포함됨 |
| Preview 회귀(`dpl_4kVK…`) | 프로브 16/16, 헤더 12/12(Report-Only), CSRF 10/10, 로그 오류 0 |
| 단위 테스트 | 3,222개 통과 |

**이전 Preview 검증에서 그대로 인정한 것**(`hardening-local` 24/24, 기능 코드 변경 없음)

- P-5(7): 로그아웃한 세션 복사본 401, 다른 기기 유지, 강제 종료 권한(일반 회원 403 / 상위 관리자 대상 403), 강제 종료 후 기존 세션·배포 전 형식 쿠키 401, 새 로그인 200, 감사 기록, Realtime 세션 정리
- A-4(5): 같은 /64 묶음, 익명 전체 상한, **로그인 회원은 익명 상한에서 제외(200)**, 통합 검색은 키워드로 전환
- A-3(5): 발급 기록, 상한 429, 남의 글 403, 미첨부만 삭제하고 갤러리 참조는 보존, 24시간 미만은 유지
- A-5(7): 601번째 요청 429, `/busy` 이동, 다른 네트워크는 정상
- 2인 채팅·실시간 전환 13/13(hardening + TLS 빌드)

## 3. 판단이 필요한 항목: A-5 네트워크 한도

- **현재 동작**
  - 네트워크(IPv4 / IPv6 /64)당 **분당 600건**을 인스턴스 메모리로 센다. 로그인 여부와 관계없이 센다.
  - 프리페치도 포함된다.
  - 실측 속도(분당 약 75건)로 보면, 같은 공인 IP 뒤에서 **동시에 활발히 탐색하는 사람이 약 8명을 넘으면** 일부 요청이 `/busy` 또는 429로 간다.
- **실제 상황 추정**
  - 지금 사용 규모(회원 약 20명)에서는 문제가 없다.
  - 수업·행사에서 여러 학생이 같은 교내 Wi-Fi로 동시에 들어오면 과도 차단이 생길 수 있다.
  - 교내 Wi-Fi가 공인 IP 하나로 나가는지는 **확인 필요**하다.
- **선택지**
  - **A(권장)**: 로그인 회원은 네트워크가 아니라 **회원별**로 센다(분당 600). 익명만 네트워크별로 센다. 익명 인스턴스 상한(분당 3,000)은 유지한다.
    - 효과: 로그인 학생은 공용 네트워크에서 서로 영향을 주지 않는다.
    - 비용: 코드 수정과 Preview 재검증(A-5 부분)이 필요하다.
  - **B**: 프리페치(`Next-Router-Prefetch: 1`)는 세지 않는다. 일반 탐색 비용이 약 1/5로 줄어 약 40명까지 여유가 생긴다. 다만 공격자가 이 헤더를 붙여 한도를 피할 수 있으므로 익명 인스턴스 상한에만 의존하게 된다.
  - **C**: 지금 값을 유지하고 반영한 뒤, `/busy`·429 로그를 감시한다. 문제가 보이면 A로 바꾼다.

## 4. 적용 순서 (승인 후, 같은 날 한 번에)

승인 번호를 `<REF>`라 하자. 하나라도 실패하면 그 자리에서 멈춘다.

1. **직전 백업과 복원 검증**: 기존 절차의 `release-…-pre` 백업과 `protect.ps1` 복원 검증. 마이그레이션 리허설을 포함한다(`-Rehearse`).
2. `release-hardening.mjs status`(읽기 전용): 대기 중 = 2건 확인
3. `release-hardening.mjs migrate --apply --confirm-production`: 2건만 적용. 다른 대기 항목이 있으면 거부한다.
4. `release-hardening.mjs revoke-inherited --apply --confirm-production`: `UploadIntent`에 상속된 service_role 권한을 회수한다(**Production 권한 변경**, `backup_reader` SELECT는 유지).
5. 적용 후 확인
   - `table-acl-check.mjs UploadIntent`
   - `backup-reader-check.mjs`(58/58 기대)
   - `db-privilege-audit.mjs`
   - `text-job-privileges.mjs`
6. 배포: `deploy.mjs production --csp-mode=report-only --approval-reference <REF>`
   - 배포 스크립트가 클라이언트 생성 → 클라이언트 게이트 → **Production DB 게이트** → 업로드 → CSP 확인 → 도메인 확인 순으로 진행한다.
7. 배포 후 확인
   - 프로브, 헤더, CSRF, 익명 브라우저
   - `post-deploy-watch.mjs --watch 8 5`(로그인 2xx 관측 확인)
8. 운영자 로그인 확인(사용자): 로그인 → `/me` → 채팅 → 관리자 화면. 가능하면 테스트 기기에서 '모든 기기에서 로그아웃' 1회. 시각을 알려 주면 **1시간 안에** `--around`로 로그를 확인한다.
9. 다음 날 03:00 cron 뒤 `upload-sweep-dry-run.mjs`(Production, 읽기 전용)로 처리 결과(`deleted`/`attached`/`open`)를 확인한다. 런타임 로그는 1시간만 보관되므로 DB 기록으로 확인한다.

**롤백**

- 앱: `rollback.mjs dpl_ZNj7p6cL… --confirm-production`. TLS가 있는 배포이고, 마이그레이션 후 스키마와 호환되는 것을 확인했다.
- 마이그레이션은 되돌리지 않는다. 추가만 하는 변경이라 이전 코드가 무시한다.
- 4단계 권한 회수는 되돌릴 필요가 없다(앱은 소유자 역할로 접근).

## 5. Supabase SSL 강제

이 릴리스 뒤에는 현재 배포와 롤백 대상(`dpl_ZNj7…`)이 모두 TLS를 갖는다. 그때 SSL 강제를 별도로 판단한다. 그 전까지 보류한다.

## 6. 미검증 / 남은 위험

- **미검증**
  - 실제 Google 로그인 흐름(Production·Preview 모두 실제 OAuth는 자동화하지 않음)
  - Production에서의 '모든 기기 로그아웃'·관리자 강제 종료 실제 동작(Preview 로컬 서버에서만 검증)
  - 실제 학교 네트워크 구조(공인 IP 공유 여부)
  - 여러 인스턴스 사이의 A-5 동작
  - A-3 첫 실제 정리(배포 후 첫 24시간 이후 03:00)
- **위험**
  - A-5 과도 차단 가능성(3절)
  - P-5로 요청마다 DB 조회가 1회 늘어난다(PK 조회, 권한 조회와 병렬)
  - 외부·테스트 사용자는 접근이 회수됐다가 다시 허용되면 다시 로그인해야 한다(현재 해당자 0)
  - A-5 차단은 DB에 기록하지 않으므로 1시간짜리 런타임 로그로만 보인다
  - `AUTH_SECRET` 유출은 P-5로 막을 수 없다(교체 필요)
