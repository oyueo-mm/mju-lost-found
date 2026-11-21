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
- `origin/vercel`: Next.js 배포 계보. 2026-11-10 `9411288`에 멈춰 있다. `perf/function-storage-c2`(= 현재 Production 계보)의 조상이라 **fast-forward 가능**(110커밋, 충돌·손실·force 없음, dry-run 확인). 실제 push는 공유 브랜치 변경이라 권한 확인에서 보류됐다. 사용자 결정 대기.
- C-2 계보에 없는 원격 변경(모두 원격에 그대로 보존):
  - `hold/admin-identity-views`(보류 기능, 2커밋)
  - `hotfix/callback-url-backslash`(같은 검사가 이미 `src/lib/auth/callbackUrl.ts`에 있음)
  - `ops/backup`(백업 운영 worktree, 1커밋)
- 병합 전 검증(`2130c6b`): 단위 274파일 3,047개, 타입, 린트 통과.

## 3. 다음 단계: D-4 보안 헤더

- 계획: [release-d4-plan-2026-11-16.md](release-d4-plan-2026-11-16.md). 단계는 인벤토리 → 기본 헤더 → Permissions-Policy → CSP Report-Only → nonce/hash 비교 → 관측 후 강제 순서다.
- 현재 코드(`next.config.ts` `headers()`): 기본 헤더 4종(`X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, `Permissions-Policy: geolocation=(), microphone=(), payment=(), usb=()`)이 **Preview에만** 적용된다. `VERCEL_ENV === "production"`이면 빈 배열이다. 2026-11-19 Preview에서 프로브·헤더 4종·3개 뷰포트 검사를 통과했다.
- Production: 위 헤더 없음, Vercel HSTS만 있다. CSP(Report-Only 포함)는 미착수다.
- 남은 일:
  1. 기본 헤더 Production 적용 여부 결정(코드 한 줄 조건 제거와 배포 승인)
  2. CSP Report-Only 설계: 인라인 스크립트 3개, Supabase Storage/Realtime, Google OAuth, 이미지 최적화, 웹 푸시. 보고 수집은 개인정보 최소화 방식으로 한다.
  3. 강제 적용은 관측 뒤 별도 승인

## 4. 다음 단계: Production DB 잔여 권한 (읽기 전용 재감사 2026-11-21, `db-privilege-audit.mjs`)

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
