# 배포 검증 강화 (2026-11-22, TLS 첫 배포 사고 후속)

사고 경위는 [db-tls-2026-11-22.md](db-tls-2026-11-22.md) 2-1에 있다. 한 줄 요약: 다른 브랜치에서 생성된 Prisma 클라이언트가 업로드됐고, 이 클라이언트가 Production DB에 없는 컬럼을 조회해 로그인 요청이 실패했다.

## 1. 업로드 전 게이트 (`deploy.mjs`)

순서는 다음과 같다. 어느 단계든 실패하면 **아무것도 업로드하지 않는다**.

1. `prisma generate`: 현재 checkout의 스키마로 클라이언트를 생성한다.
2. **클라이언트 게이트**(`prisma-client-check.mjs client`)
   - 클라이언트에 내장된 스키마가 현재 checkout의 `prisma/schema.prisma`와 같은지 확인한다.
   - 클라이언트는 스키마를 `prisma format` 형태로 저장하므로, 임시 사본을 같은 CLI로 포맷한 뒤 줄 단위로 비교한다.
3. **DB 게이트**(`prisma-client-check.mjs database`)
   - 클라이언트가 쓰는 모든 테이블·컬럼·enum 값이 대상 DB에 있는지 확인한다.
   - 조회하는 것은 `information_schema.columns`와 `pg_enum` 메타데이터뿐이다. `BEGIN READ ONLY`로 실행하고, 검증된 TLS로 연결하며, 행 데이터는 읽지 않는다.
   - Production에서는 `--approval-reference <REF>`가 필수이고, 승인 실행기(`approved-operation.mjs`)를 거쳐 실행한다.
   - 경고만 하는 경우(실패 아님):
     - DB에 기본값 없는 NOT NULL 컬럼이 있는데 클라이언트가 모르는 경우 → 해당 테이블에 insert하면 실패한다.
     - DB에 클라이언트가 모르는 enum 값이 있는 경우.
4. 업로드
5. CSP 모드 확인(기존 동작)
6. **도메인 확인**
   - `mju-find.vercel.app/api/version`이 새 배포를 가리키는지 본다.
   - 롤백 직후에는 Vercel이 새 Production 배포를 도메인에 자동 연결하지 않는다. 이때 `vercel promote`를 안내하고 종료 코드 3을 반환한다.

사용 예: `node scripts/deployments/deploy.mjs production --csp-mode=report-only --approval-reference <REF>`

### 검증 결과 (2026-11-22)

| 시험 | 결과 |
|---|---|
| hardening 클라이언트 ↔ hardening 스키마 | 일치 |
| hardening 클라이언트 ↔ Production(fix/db-tls) 스키마 | **불일치**(338행) |
| hardening 클라이언트 ↔ Production DB | **실패**: `User.sessions_valid_after`, `UploadIntent` 누락 (사고 재현) |
| fix/db-tls 클라이언트 ↔ Production DB | 통과(테이블 56, 컬럼 513, enum 19, 경고 0) |
| hardening 클라이언트 ↔ Preview DB | 통과(57 / 520 / 19) |
| 단위 테스트 | 3,222개 통과. 사고 재현, 롤백 정책, 게이트 순서 포함 |

Production 조회는 메타데이터 읽기 전용이었다(승인 번호 `SCHEMA-COMPAT-CHECK-2026-11-22`).

참고: 다음 hardening 릴리스는 **마이그레이션을 먼저 적용해야** DB 게이트를 통과한다. 원래 계획대로의 순서이며, 이제는 이 순서를 어기면 게이트가 배포를 막는다.

## 2. 롤백 (`rollback.mjs`)

사용 예: `node scripts/deployments/rollback.mjs <dpl_… | URL> --confirm-production [--dry-run]`

- **대상 확인**: `vercel inspect`로 Production 배포인지, READY 상태인지 본다. 대상 배포의 `/api/version`에서 커밋을 읽어 TLS 코드 포함 여부도 확인한다.
- **금지 목록**(`rollbackPolicy.mjs`): `dpl_HbJbyTZFYnLLmBzLt7Bb1QCboNue`(잘못된 클라이언트)
- **SSL 강제 이후**: Supabase SSL 강제를 켜는 변경에서 `SUPABASE_SSL_ENFORCED`를 `true`로 바꾼다. 그러면 TLS 이전 배포(`0263e62` 이전)로의 롤백을 거부한다.
- **롤백 후**: 도메인이 대상 배포를 가리키는지 확인하고, 다음 배포는 `promote`가 필요하다고 안내한다.
- **확인 결과**:
  - `dpl_HbJbyTZF…` → 거부
  - `dpl_FvfFRQpp…` → 허용(`hasTlsCode=false` 표시)
- **한계**: Vercel 대시보드의 Instant Rollback 버튼은 막을 수 없다. 대시보드에서도 위 목록을 지킨다.

## 3. 로그인 사용자 경로의 배포 후 스모크

### 3-1. 지금 운영 (새 Production 배포 필요 없음)

`scripts/operations/post-deploy-watch.mjs`

- **사용법**
  - `<dpl_…> --watch 8 5`: 배포 후 40분 동안 5분마다 확인한다. 사고 때 첫 로그인 오류는 배포 17분 뒤에 나왔다.
  - `<dpl_…> --around <ISO 시각> 10`: 운영자가 직접 검증한 시각 ±10분을 확인한다.
- **출력**(개수만): 요청 수, `loggedIn2xx`, 5xx 수, 오류 메시지 종류(앞 90자), 경로 분류별 개수
  - `loggedIn2xx`는 세션이 없으면 401을 주는 API나 회원 전용 페이지의 2xx 응답 수다. 로그인 요청이 실제로 성공했다는 직접 증거다.
- **제약**
  - Hobby 요금제는 런타임 로그를 **약 1시간**만 보관한다. 운영자 검증 결과는 1시간 안에 확인해야 한다.
  - CLI 조회는 한 번에 약 50행까지만 나온다(`possiblyTruncated` 표시).
- **완료 판정**: 배포 후 감시에서 `loggedIn2xx > 0`이고 오류가 0이어야 "로그인 경로 확인"으로 기록한다. 관측이 없으면 "미관측"으로 기록하고 운영자 확인을 요청한다.
- **2026-11-22 실측**: 현재 Production `dpl_ZNj7p6cL…`에서 최근 1시간 요청 50건 가운데 로그인 2xx 9건, 오류 0, 5xx 0.

### 3-2. 자동 로그인 스모크 (제안, 승인 필요)

운영자가 없어도 매 배포 직후 로그인 경로를 확인할 수 있게 하는 설계다.

1. **전용 스모크 계정**
   - Production에 개인정보 없는 일반 회원 1명을 승인된 일회성 작업으로 만든다(데이터 변경).
   - 채팅방·게시글을 만들지 않으므로 다른 사용자의 데이터와 엮이지 않는다.
   - 통계에서는 제외한다(기존 테스트 계정 제외 규칙에 추가).
2. **세션**
   - Auth.js JWT를 `AUTH_SECRET`으로 **10분짜리**만 발급한다. 비밀값 사용 승인이 필요하다.
   - 비밀은 Preview처럼 Windows DPAPI 보관 파일에서만 읽는다. 토큰과 비밀은 출력하거나 파일로 쓰지 않는다.
   - Google 로그인 화면은 자동화하지 않는다.
3. **요청**(GET만, 쓰기 없음)
   - 메인 페이지, `/api/me`, `/api/notifications`(1건), `/api/chat` 목록 → 모두 200이어야 한다.
   - 관리자 API → 403이어야 한다(권한 검사 경로 확인).
   - 이어서 `post-deploy-watch --around`로 같은 시각의 오류 0을 확인한다.
4. **사전 확인**(Preview): 이 GET들이 마지막 접속 시각 같은 쓰기를 남기는지 먼저 확인하고, 남긴다면 스모크 계정에서는 꺼지게 한다.
5. **필요한 승인**: Production 데이터 1행 생성, `AUTH_SECRET` 사용(보관 위치 포함). 앱 코드 변경은 필요 없을 것으로 본다.

### 3-3. 대안: 스키마 스모크 엔드포인트 (권장하지 않음)

`CRON_SECRET`으로 보호한 엔드포인트가 배포된 함수 안에서 모든 모델에 0건 조회를 실행하는 방식이다. 1절의 게이트가 업로드 전에 같은 문제를 막으므로 중복이다. 새 Production 배포와 비밀값 취급이 필요하다.

## 4. 유지 확인

- CSP Report-Only, CSRF, private Realtime, DB TLS는 그대로다. 배포 스크립트의 CSP 확인도 유지된다.
- 이번 변경은 배포·운영 도구뿐이다(`scripts/`). 앱 코드, Production DB 스키마, 사용자 데이터는 변경하지 않았다.
- **추가 Production 배포는 필요하지 않다.**
