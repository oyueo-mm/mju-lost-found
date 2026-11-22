# 유지보수 현황 (2026-11-21)

## 1. 완료된 유지보수: Function Storage C-1·C-2

| 항목 | C-1 사진 경로 | C-2 텍스트 임베딩 큐 |
|---|---|---|
| 상태 | **완료**(사용자 확정 2026-11-21) | **완료**(사용자 확정 2026-11-21) |
| Production 배포 | `dpl_5r8gc7wQAmwriBH7Tz63n5gSLjgm`(`381b944`) | `dpl_3AgGm82bTYAQUV8bRJevsf8JquRX`(`253de8f`), **현재 Production** |
| 배포당 함수 번들 | 639.8MB → 539.4MB | 539.4MB → **308.8MB** |
| DB 변경 | 없음 | `TextEmbeddingJob` + 트리거(추가형), 새 테이블에서 비소유 역할 권한 회수 |
| 실사용 검증 | lost:142(사진 → 임베딩 3.6초) | lost:143(사진 3.9초, 수정 → 텍스트 작업 2.2초, 저장 벡터가 수정 후 텍스트와 일치) |
| 시험 데이터 | 삭제·정리 확인(`post-cleanup-check.mjs`) | 삭제·정리 확인(사진·이미지/텍스트 작업·Storage·연관 데이터 0) |
| 상세 | [function-storage-plan-2026-11-20.md](function-storage-plan-2026-11-20.md) | [function-storage-c2-plan-2026-11-20.md](function-storage-c2-plan-2026-11-20.md) |

- 롤백 대상(READY 보존):
  - C-2 → C-1 `dpl_5r8gc7wQ…`
  - C-1 → `dpl_AgwysDi…`(D-3 완료 배포)
  - C-2 DB 롤백은 앱 롤백 뒤 필요할 때만 `scripts/fixtures/text-job-rollback/rollback.sql`로 한다.
- Preview 보존 기간은 7일, Production은 30일이다. 보존 배포 합계는 약 5.4GB/10GB다.

## 2. Git 브랜치 현황 (읽기 전용 조사)

- **Vercel 자동 배포 없음.** 프로젝트에 Git 연결이 없고(`link: null`) GitHub Actions도 없다. 배포는 `scripts/deployments/deploy.mjs`(CLI)로만 일어난다. 브랜치 병합·push로 재배포되지 않는다.
- `origin/main`(GitHub 기본 브랜치): 2026-08월 Python Streamlit 초기 앱 10커밋. Next.js 앱과 **공통 조상이 없다**(`git merge-base` 없음). 병합하려면 `--allow-unrelated-histories`가 필요하고, 두 앱의 파일이 한 트리에 섞인다. "충돌·손실 없는 병합" 조건을 충족하지 못해 **병합하지 않았다.** `origin/deploy`(2커밋)·`origin/Railway`·`origin/hostinger`도 별도 이력이다.
- `origin/vercel`: Next.js 배포 계보이자 **GitHub 기본 브랜치**(공개 API 확인. `main`이 기본이라는 로컬 표시는 오래된 `origin/HEAD` 때문이었다). 사용자 승인 후 2026-11-21에 `9411288..fcb36c1`로 fast-forward했다. push 직전에 원격을 다시 조회해 FF 가능, 원격 전용 커밋 0, force 없음, 보류·백업 브랜치 보존, Vercel Git 연결 없음(재배포 없음)을 확인했다. 새 배포가 생기지 않은 것도 확인했다. 기본 브랜치는 이미 `vercel`이므로 따로 바꿀 필요가 없다(저장소 공개, fork 2, 열린 PR 0).
- C-2 계보에 없는 원격 변경(모두 원격에 그대로 보존):
  - `hold/admin-identity-views`(보류 기능, 2커밋)
  - `hotfix/callback-url-backslash`(같은 검사가 이미 `src/lib/auth/callbackUrl.ts`에 있음)
  - `ops/backup`(백업 운영 worktree, 1커밋)
- 병합 전 검증(`2130c6b`): 단위 274파일 3,047개, 타입, 린트 통과.

## 0-6. 2026-11-22 DB TLS Production 반영 (최신)

- **Production**: `dpl_ZNj7p6cLTuiKJESDE8ZYWiWf6znD`(`dede9ce`, 앱 DB 연결 검증된 TLS). 첫 배포 `dpl_HbJbyTZF…`는 잘못된 Prisma 클라이언트로 약 28분간 로그인 요청 일부가 실패해 롤백했다. 롤백 대상에서 제외한다([db-tls 2-1](db-tls-2026-11-22.md)).
  - 롤백 `dpl_FvfFRQpp…`(`fc947bb`). SSL 강제 전까지만 안전하다.
  - 회귀: 프로브 16/16, 헤더 12/12, CSRF 10/10, 브라우저 5/5, 로그 오류 0
- **운영 도구**: 스크립트 41곳, `pg_dump`, Prisma 마이그레이션, 노트북 백업(ops `0ff6a70`), 클라우드 백업이 모두 검증된 TLS로 연결한다. 미지원 경로 0.
- **Preview**: `dpl_4kVKbF28…`(`bab5f8e`)
- **Supabase SSL 강제**: 미적용(승인 대기). 조건은 [db-tls-2026-11-22.md](db-tls-2026-11-22.md) 5절.
- **클라우드 백업**(push 전 `9ccd529`)
  - Production 실행은 `PRODUCTION_BACKUP_ENABLED` 변수로 막아 둔다.
  - CI에는 service_role 키를 넣지 않는다.
  - RUNBOOK 3절을 정리했다.


## 0-5. 2026-11-22 클라우드 백업

- GitHub Actions + R2 + Cloudflare Worker 감시로 구성한다. 코드와 Preview 종단 간 검증은 끝났다(`C:\proj_claude\mju-find-backup-cloud`).
- 실제 인프라 설정은 사용자 작업이다. Production `backup_reader` 생성은 승인 대기다.
- 앱 DB 연결에 TLS가 강제되지 않을 가능성을 새로 발견했다.
- 상세: [cloud-backup-2026-11-22.md](cloud-backup-2026-11-22.md)

## 0-4. 2026-11-22 보안 강화

- **현재 Production `dpl_FvfFRQppnqXaT7sdybBHknhjN9f9`(`fc947bb`)**: A-1 숨김·삭제 글 댓글 차단 + '내 댓글' 제목 가림. CSP Report-Only, P-2·P-3, private Realtime 유지. 롤백 대상 `dpl_GFjSiuYqn8TCsMz68ddQkCUh2g3q`(`8a67cdd`).
- **P-5·A-4·A-3·A-5**: 브랜치 `security/hardening-2026-11-22`. 격리 Preview `dpl_6JhJWXAi91fiHjTXd1Y9eRQApoW4`(`905ba25`)에서 검증했다. Preview DB 마이그레이션 2건 적용. **Production 마이그레이션·배포는 승인 대기이며, 마이그레이션을 먼저 해야 한다.**
- **11-22 예약 작업**: cron 02:00·03:00 정상. 백업은 04:00이 아니라 11:09에 지연 실행됐고 복원 검증은 통과했다. Modern Standby에서는 AC 연결 상태에서도 PC를 깨우지 못했다.
- **A-2**: Supabase Auth는 사용하지 않는 것으로 확인했다. 대시보드에서 끌 설정을 정리했다.
- 상세: [security-hardening-2026-11-22.md](security-hardening-2026-11-22.md)

## 0-3. 2026-11-21 23시 종합 보안 감사

- **현재 Production `dpl_GFjSiuYqn8TCsMz68ddQkCUh2g3q`(`8a67cdd`)**: P-2, P-3, polling 15초 제한, CSP Report-Only. 롤백 대상 `dpl_6rutg8AmJikkZPacLL5stQwRD8wE`.
- 종합 감사: [security-audit-comprehensive-2026-11-21.md](security-audit-comprehensive-2026-11-21.md)
  - 실제 취약점 5건(Medium): A-1 댓글 노출 **Preview 수정 완료**, Production 미배포(`fix/audit-hidden-post-comments` `0293e03`), A-2 Supabase Auth 가입 열림, A-3 Storage 고갈, A-4 익명 AI 검색 상한, A-5 익명 조회 무제한
  - 잠재 위험(세션 무효화 수단 없음 등)과 사용자 확인 항목(계정 2단계 인증 등)
- 11-22 새벽 cron·04:00 예약 백업 확인은 다음 세션에서 한다(대기 작업 중단, 예약은 유지). 11-21 22:16 기준 노트북은 배터리 상태였다.

## 0-2. 2026-11-21 21시 이후 갱신

- **P-2 출처 검사·P-3 읽음 분리**: 브랜치 `fix/csrf-origin-chat-read`(`940cbf0` 이후). 격리 Preview `dpl_AF3mKwp3d9TdH3H1Bw5ztZWKj2kk`에서 검증했고, 고정 Preview 별칭은 바꾸지 않았다. **Production 미배포(별도 승인 대기).** 상세: [security-audit-xss-csrf-2026-11-21.md 5절](security-audit-xss-csrf-2026-11-21.md).
- **Production CSP**: Report-Only를 유지한다(변경 없음). 배포 스크립트가 이제 `--csp-mode`를 강제한다. 집계는 운영 위반 0건, 시험 보고 3건(분리)이다. 상세는 [release-d4-plan](release-d4-plan-2026-11-16.md) 마지막 절.
- **백업 예약 작업**: WakeToRun을 켰다(AC 전원에서만 효과). watchdog 기준 26시간, 실행 시작 기록 추가(`6274b3a`, `ops/backup`). 작업 스케줄러 운영 로그는 관리자 권한이 필요해 미적용이다. 장기 구조 설계: [backup-offsite-design-2026-11-21.md](backup-offsite-design-2026-11-21.md).
  - 수동 실행: 19:50 `Start-ScheduledTask`(스케줄러 경유) → `auto-2026-11-21` 생성·복원 검증. 20:14 재시작 확인(`by svchost`, 같은 날 백업이 있어 건너뜀).
  - **실제 예약 실행(11-22 04:00)은 아직 없음**. 11-22 13:00 watchdog과 `backup.log`의 `invoked ... by svchost` 04:0x 기록으로 확인한다.
- **P-4 정정**: 매직 넘버 검사는 이미 구현돼 있다(Release B). 남은 것은 미첨부 업로드 객체(D-5)뿐이다.

## 0-1. 2026-11-21 20시 갱신

- **Production CSP Report-Only 활성화 완료**: 현재 Production `dpl_6rutg8AmJikkZPacLL5stQwRD8wE`(`5711719`), 롤백 대상 `dpl_DvLnpG3ixQT6t1XAqV6Cru73hWCM`(`5db5350`). 헤더 12/12, 프로브 16/16, 브라우저 2종 통과. 상세: [release-d4-plan-2026-11-16.md](release-d4-plan-2026-11-16.md) 마지막 절. enforce는 관측 뒤 별도 승인.
- **XSS·CSRF 감사 완료**: 실제 취약점 0, 잠재 위험 4건. [security-audit-xss-csrf-2026-11-21.md](security-audit-xss-csrf-2026-11-21.md).
- **자동 백업**
  - 11-19·11-21 04:00 누락 원인: 04:00에 PC가 절전(Modern Standby)이었고 작업이 `WakeToRun=False`다. 11-21은 08:16:32 절전 해제 직후 보충 실행(08:16:38)이 시작됐지만 `0xC000013A`(외부 종료)로 끝나 로그·상태 기록 전에 멈췄다(정확한 종료 주체는 Task Scheduler 운영 로그가 꺼져 있어 확인 불가). 11-19는 보충 실행 흔적도 없다. watchdog 기준(36시간)에 걸리지 않아 알림도 없었다.
  - 권한 변경(17:28) 이후 확인: 같은 예약 작업을 19:50에 수동 시작 → `auto-2026-11-21.tar.enc`(24.9MB) 생성, 체크섬 144/144, WSL 복원 검증 통과(테이블 57, 행 수 불일치 0, 사진 135 누락 0).
  - 개선 제안(미적용, 사용자 결정): 작업에 `WakeToRun` 켜기 또는 04:00 대신 사용 시간대로 이동, watchdog 기준 36→26시간.
- **cron**: 02:00(`embedding-maintenance`)·03:00(`/api/admin/settings` 보존 정리) KST 첫 실행은 11-22 새벽이라 아직 확인 불가. cron은 서버 DB 역할을 쓰며 이번 권한 회수(PUBLIC·anon·authenticated) 대상이 아니다.

## 0. 2026-11-21 저녁 갱신

- **Production DB 잔여 권한 정리 완료**(사용자 승인, 17:28 KST).
  - 클라이언트 역할(PUBLIC·anon·authenticated) 6문을 적용했다. service_role, postgres, Realtime receive, 트리거, SECURITY DEFINER는 유지했다.
  - 전후 비교와 검증: [db-privileges-step2-2026-11-21.md 7절](db-privileges-step2-2026-11-21.md#7-production-적용-결과-2026-11-21).
- **D-4 기본 헤더 4종 Production 반영 완료**
  - **현재 Production `dpl_DvLnpG3ixQT6t1XAqV6Cru73hWCM`(`5db5350`)**, 롤백 대상 `dpl_3AgGm82bTYAQUV8bRJevsf8JquRX`(C-2). CSP는 꺼져 있다.
- **CSP 위반 보고 수집**(`/api/csp-report`, report-uri만)
  - 구현하고 로컬과 Preview에서 검증했다.
  - **현재 Preview 고정 URL은 Report-Only 빌드 `dpl_9ZeEuVWpFkNe5w7K55NWya178GJ9`(`da92170`)**다.
  - Production Report-Only와 enforce는 미결정이다. 상세: [release-d4-plan-2026-11-16.md](release-d4-plan-2026-11-16.md) 마지막 두 절.
- 남은 확인
  - 오늘 밤 cron(02:00·03:00 KST)과 04:00 자동 백업. 11-21 04:00 자동 백업은 기록이 없다.
  - 로그인 사용자 흐름(채팅 실시간, 관리자, 글쓰기·사진) 사용자 확인.

## 3. 다음 단계: D-4 보안 헤더 (→ 2026-11-21 기본 헤더 Production 반영 완료, CSP 보고 수집 Preview 검증 완료: release-d4-plan 마지막 절)

- 계획: [release-d4-plan-2026-11-16.md](release-d4-plan-2026-11-16.md). 단계는 인벤토리 → 기본 헤더 → Permissions-Policy → CSP Report-Only → nonce/hash 비교 → 관측 후 강제 순서다.
- 현재 코드(`next.config.ts` `headers()`): 기본 헤더 4종(`X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, `Permissions-Policy: geolocation=(), microphone=(), payment=(), usb=()`)이 **Preview에만** 적용된다. `VERCEL_ENV === "production"`이면 빈 배열이다. 2026-11-19 Preview에서 프로브·헤더 4종·3개 뷰포트 검사를 통과했다.
- Production: 위 헤더 없음, Vercel HSTS만 있다. CSP(Report-Only 포함)는 미착수다.
- 남은 일:
  1. 기본 헤더 Production 적용 여부 결정(코드 한 줄 조건 제거와 배포 승인)
  2. CSP Report-Only 설계: 인라인 스크립트 3개, Supabase Storage/Realtime, Google OAuth, 이미지 최적화, 웹 푸시. 보고 수집은 개인정보 최소화 방식으로 한다.
  3. 강제 적용은 관측 뒤 별도 승인

## 4. Production DB 잔여 권한 (→ 2026-11-21 **Production 적용 완료**: [db-privileges-step2-2026-11-21.md](db-privileges-step2-2026-11-21.md). 아래 표는 적용 전 감사 기록) (읽기 전용 재감사 2026-11-21, `db-privilege-audit.mjs`)

| 항목 | Production | Preview |
|---|---|---|
| public 테이블 | 57(RLS ON 6) | 57(RLS ON 6) |
| anon/authenticated 읽기·쓰기(SELECT/INSERT/UPDATE/DELETE) | **0** | 0 |
| anon/authenticated `TRUNCATE/REFERENCES/TRIGGER/MAINTAIN` | **56개 테이블**(새 `TextEmbeddingJob`만 제외) | 0 |
| schema public USAGE(anon/authenticated) | **있음** | 없음 |
| anon이 실행 가능한 public 함수 | 15(PUBLIC 경유) | 15 |
| public default ACL | postgres 소유 새 테이블에 anon·authenticated·service_role `Dxtm`. supabase_admin 소유 객체에는 전체 권한 | 없음 |
| Data API | OFF(503, 2026-11-12 사용자 비활성화) | OFF |

- 위험: Data API가 꺼져 있고 PostgREST는 TRUNCATE를 노출하지 않으므로 현재 외부 경로는 없다. 다만 설정이 바뀌거나 다른 경로가 생기면 쓰일 수 있는 잠재 권한이다. 2026-11-12 감사 이후 새 테이블이 생길 때마다 상속되는 구조다(C-2 테이블은 회수함).
- 2단계 정리(미승인, 계획만)
  - 56개 테이블에서 anon·authenticated의 `TRUNCATE/REFERENCES/TRIGGER/MAINTAIN`을 REVOKE한다.
  - postgres 소유 default ACL에서 anon·authenticated(필요하면 service_role) 상속을 제거한다(`ALTER DEFAULT PRIVILEGES ... REVOKE`).
  - public schema의 PUBLIC/anon USAGE는 Storage·Realtime·Auth 영향 확인 뒤 별도로 결정한다(Preview는 USAGE 없이 정상 동작).
  - 함수 EXECUTE(PUBLIC 경유)는 `REVOKE ... FROM PUBLIC` 영향(트리거·RLS 함수)을 검토한 뒤 결정한다.
  - supabase_admin 소유 default ACL은 postgres 권한으로 바꿀 수 없다(멤버 아님). Supabase 지원 범위를 확인한다.
- 진행 시 절차: 백업과 복원 검증 → 복원본 리허설 → Production 적용(별도 승인: 권한 변경) → `db-privilege-audit.mjs`와 앱 회귀(로그인·사진·채팅·Realtime·관리자) 확인 → 롤백 SQL(GRANT 복원) 준비.
