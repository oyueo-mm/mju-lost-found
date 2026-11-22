# 클라우드 자동 백업 구축 (2026-11-22)

**결정**(사용자, 2026-11-22)
- 운영자가 약 18개월 동안 부재할 수 있으므로, 개인 PC에 의존하지 않는 **GitHub Actions + Cloudflare R2** 백업을 구축한다.
- Supabase는 Free를 유지한다.
- [백업 구조 재검토](backup-strategy-review-2026-11-22.md)의 'A안 권장'과 [오프사이트 설계](backup-offsite-design-2026-11-21.md)의 보류는 이 결정으로 대체된다.

**구현 위치**
- 별도 비공개 저장소용 코드: 로컬 `C:\proj_claude\mju-find-backup-cloud`(커밋 `5eee5cf`). 원격 `oyueo-mm/mju-find-backup`은 사용자가 만든 뒤 push한다.
- 설정·운영·복구 절차: 그 저장소의 `docs/RUNBOOK.md`

## 1. 구성

| 요소 | 내용 |
|---|---|
| 예약 백업 | GitHub Actions `backup.yml`, 매일 04:23 KST, `ubuntu-24.04`, 서드파티 Action 없음 |
| DB 접근 | 새 역할 `backup_reader`: 읽기 전용 기본값, 쓰기 권한 없음, BYPASSRLS(RLS 테이블 7개 덤프용), Storage 목록 메타데이터 SELECT, `realtime` 스키마 USAGE(권한 메타데이터 확인용), 동시 접속 3. auth 등 내부 스키마 읽기 불가 |
| Storage 접근 | Supabase Storage S3 키(Storage 전용, service_role보다 좁음). 대체 수단은 service_role |
| 전송 보안 | DB 연결 TLS 강제. Supabase CA 인증서를 넣으면 서버 인증서까지 검증 |
| 검증 | 체크섬 확인 → 러너 안의 임시 PG18 + pgvector에 실제 복원 → 행 수·Realtime 권한·사진 참조 확인. **검증에 실패하면 업로드하지 않는다** |
| 암호화 | age X25519. 운영자와 공동 운영자의 공개키 2개를 수신자로 지정. 개인키는 GitHub·Cloudflare·PC 밖 오프라인 보관 |
| 저장 | R2 비공개 버킷. `daily/`·`weekly/`·`monthly/`(그 주·달의 첫 성공분 복사). 매번 새 키라 덮어쓰기 없음. 업로드 후 다시 읽어 해시 대조 |
| 보존 | 수명 주기 10/63/570일 + 보존 잠금 7/56/548일 → 일간 7개 이상, 주간 8개 이상, 월간 18개 이상 |
| 누락 감시 | Cloudflare Worker(매일 06:40 KST, Actions와 별도 환경): 30시간 넘게 백업이 없으면 워크플로 재실행 + GitHub 이슈(구독자 이메일). 정상화되면 이슈 종료. 자기 생존 신호도 기록 |
| 주간 점검 | `check.yml`(R2 읽기 전용 토큰): 보존 개수, 저장 데이터 해시, 용량(8GB 경고), Worker 생존 신호 → 실패 시 이메일 |
| 복구 도구 | `restore.mjs`(복호화·해시·체크섬·복원 검증), `restore-storage.mjs`(새 프로젝트 또는 같은 프로젝트에 사진 복원, 덮어쓰기 없음) |

## 2. 기존 노트북 백업과의 범위 비교

| 항목 | 노트북 | 클라우드 |
|---|---|---|
| `public` 스키마 덤프(같은 시점) | 있음 | 있음 |
| 행 수, 마이그레이션 목록 | 있음 | 있음 |
| Realtime 권한 메타데이터와 재구성 SQL | 있음 | 있음 |
| Storage 모든 버킷 실제 파일 + SHA-256 + eTag 대조 | 있음 | 있음 |
| 체크섬·복원 검증(`verify-restore.mjs`) | 같은 코드 | 같은 코드(`ops/backup@6274b3a`에서 가져옴) |
| `db/full.dump`(auth·storage 등 Supabase 내부 스키마 포함 전체) | 있음(`postgres` 권한) | **없음** |
| 실행 조건 | PC가 켜져 있어야 함 | PC와 무관 |

- **`full.dump`를 뺀 근거**
  - 최소 권한 역할은 Supabase 내부 스키마를 읽을 수 없고, 읽어서도 안 된다.
  - MJU Find는 Auth.js로 로그인하므로 `auth.*`에 필요한 데이터가 없다(Preview 0건, Production 미확인).
  - 복원 검증과 복구에는 `public.dump`만 쓴다.

## 3. 검증 결과 (Preview, 시험 키)

- **단위 테스트 12/12**: 경로·주차 계산, 승격, 다시 읽기 불일치 거부, Preview 접두사 분리, 암호화 왕복(수신자 2명 / 제3자 거부), 공개키만 허용, 소유자 역할·다른 프로젝트·임의 호스트 거부, 보존·신선도 판정, 저장 데이터 변조 감지, 감시기 재실행·이슈 생성·종료(가짜 R2·GitHub)
- **종단 간 시험**(WSL PG18, `backup_reader`로 Preview, 로컬 폴더를 R2 대용으로 사용)
  - 58개 테이블, 3,628행, 사진 109개(채팅 20, 게시글 89)
  - 체크섬 116/116, 복원 검증 `RESTORE VERIFIED`
  - 암호문 3.9MB 업로드 → 다시 읽어 일치, 주간·월간 승격
- **공동 운영자 키로 복구**: 해시, 체크섬, 실제 복원 검증 모두 통과
- **`check.mjs`**: 무결성 3/3. 감시기가 없을 때 'watchdog silent'를 정상 감지
- **`restore-storage.mjs`**
  - 기존 109개는 덮어쓰지 않음
  - 새 이미지 1개 업로드, 다시 실행하면 건너뜀
  - 허용되지 않는 형식은 실패로 집계
  - 시험에서 '400을 중복으로 처리해 실패를 숨기던' 결함을 찾아 고쳤다. 시험 객체는 삭제했다.
- **Worker 번들 빌드**(wrangler dry-run): 5KB, R2 바인딩 확인
- **`backup_reader` 권한 검증**(Preview)

  | 시도 | 결과 |
  |---|---|
  | RLS 테이블 7개 읽기 | 7/7 가능 |
  | Storage 목록 읽기 | 가능 |
  | 스냅샷 내보내기 | 가능 |
  | 쓰기 | 25006(읽기 전용) |
  | 쓰기 모드로 바꾼 뒤 쓰기 | 42501(권한 없음) |
  | 테이블 생성 | 거부 |
  | `auth.users` 읽기 | 42501 |

- **정리**: 시험 중 만든 평문 복원본, 시험 키, 시험 저장소는 모두 삭제했다.
- **미실행**(사용자 설정 필요): 실제 R2 업로드, Actions 예약 실행, Worker 배포, Production 백업

## 4. 이번에 바꾼 것과 바꾸지 않은 것

- **Preview DB**: `backup_reader` 역할 생성. 접속 정보는 `.env.backup-preview.local`(git 제외)에만 있다. 되돌리기는 `db/backup-reader-drop.sql`.
- **Production**: 변경 없음(DB 권한, 설정, 비밀값 모두).
- **노트북 백업**: 그대로 실행 중이다. 기존 백업 파일은 삭제하지 않았다.
- 앱 저장소에 더한 것: `scripts/operations/backup-role-probe.mjs`, `backup-reader-preview.mjs`, `backup-reader-check.mjs`(Preview 전용)

## 5. 앱 DB 연결 TLS (2026-11-22 후속에서 실측 → 7절)

- **관찰**
  - Preview의 `DATABASE_URL`과 `DIRECT_URL`에 `sslmode` 같은 TLS 설정이 없다.
  - 앱은 `pg`(Prisma 어댑터)를 기본값으로 쓰고, `pg`의 기본값은 TLS를 쓰지 않는 것이다.
  - Preview 풀러는 암호화 없는 연결을 받아들였다(실측).
- **추정**: Production도 설정이 같다면, 앱(Vercel)과 Supabase 사이의 DB 통신(쿼리 결과·개인정보·DB 비밀번호)이 평문으로 오갈 수 있다. 둘 다 서울 AWS지만 공용 엔드포인트를 거친다.
- **미확인**: Production 연결 문자열의 실제 내용(출력하지 않음), Supabase 'Enforce SSL' 설정 상태.
- **조치안**(Production 환경 변수 변경 → 별도 승인)
  1. Preview에서 `pg`에 TLS를 켜고 CA 인증서로 검증하도록 설정한 뒤 회귀 검증한다.
  2. Production에 적용한다.
  3. Supabase에서 SSL 강제를 켠다.
- 클라우드 백업은 처음부터 TLS를 강제한다.

## 6. 남은 일 (승인·사용자 작업)

1. 사용자 작업(RUNBOOK §3)
   - 복구 키 2개
   - Cloudflare: R2 버킷·수명 주기·잠금·토큰 3개, 2단계 인증
   - GitHub: 비공개 저장소·Environments·Rulesets·PAT, 2단계 인증
   - Supabase: S3 키, CA 인증서, 2단계 인증
2. **승인 필요**
   - Production `backup_reader` 생성(DB 권한 변경)
   - §5의 TLS 적용
3. 이후: Preview 시험 실행 → Production 첫 실행 → 운영자 키로 실제 복원 검증 → 14일 연속 성공 후 노트북 백업을 보조 수단으로 전환

## 7. 후속 작업 (2026-11-22 오후)

### 7-1. 앱 DB 연결 TLS 실측

점검 도구 `scripts/operations/db-tls-status.mjs`는 앱과 같은 `pg` 8.23.0으로, 앱과 같은 방식(연결 문자열만 전달)으로 접속한 뒤 소켓 상태를 확인한다. `SELECT 1`만 실행한다.

| 대상 | 앱 방식으로 접속 | TLS 강제 시 | CA 검증 시 |
|---|---|---|---|
| Preview `DATABASE_URL`(6543), `DIRECT_URL`(5432) | **평문**(`encrypted:false`) | TLS 1.3 | 인증됨 |
| Production 운영용 사본 `DATABASE_URL`(6543, 파라미터 `pgbouncer`만), `DIRECT_URL` | **평문** | TLS 1.3 | 인증됨 |

- 서버 인증서: `*.pooler.supabase.com`, 발급자 `Supabase Intermediate 2021 CA`, 루트 `Supabase Root 2021 CA`(SHA-256 `80:70:25:AD:…:CA:FA`, 2031-04-26 만료).
- 다른 CA를 쓰면 `SELF_SIGNED_CERT_IN_CHAIN`, 다른 호스트 이름이면 `ERR_TLS_CERT_ALTNAME_INVALID`로 거부된다(검증이 실제로 작동함).
- **Vercel Production 값**
  - Sensitive라서 다시 읽을 수 없다(`vercel env pull` 결과가 빈 값). 그래서 운영용 사본과 같은지 확인하지 못했다.
  - Vercel에는 `PGSSLMODE`도 없다.
  - 앱 코드는 연결 문자열만 넘기므로, Vercel 값에 `sslmode`가 없다면 Production 앱도 평문이다. 운영용 사본 기준으로는 평문이다.
- **수정**(`fix/db-tls`, `0263e62`. 보안 강화 브랜치에도 `20a409d`로 반영)
  - `src/lib/db/tls.ts`: Supabase 호스트에는 항상 TLS를 쓰고, 고정한 루트 CA와 호스트 이름으로 검증한다. URL의 ssl 계열 파라미터는 무시한다. 로컬 DB는 변경 없다.
- **Preview 검증**(`dpl_GLedVyD6…`)
  - 단위 3,163(+4)
  - CSRF 로컬 20/20
  - 호스팅 A-1 3/3, CSRF 10/10, 로그 오류 0
  - 2인 채팅·Realtime 전환 13/13(보안 강화 + TLS 빌드)
- **Production 앱 반영은 보고 후 진행한다.** Supabase SSL enforcement(프로젝트 설정)는 별도 승인 대상이다.

### 7-2. Production `backup_reader` 생성 (원칙 승인에 따라 적용)

**사전 확인**
- 당일 예약 백업 `auto-2026-11-22` 복원 검증 완료(11:11).
- 소유자에게 BYPASSRLS·CREATEROLE·Storage 권한 위임이 가능하다.
- public·storage·realtime에서 PUBLIC 실행 가능한 SECURITY DEFINER 함수는 **0개**다. 읽기 전용 기본값을 끄더라도 함수를 통해 쓸 경로가 없다.
- 테이블 57개(RLS 6), 트리거 25개.

**새 테이블 상속**
- `postgres`의 기본 권한으로 SELECT만 상속된다(Preview에서 임시 테이블로 확인 후 롤백).
- 앱 권한 점검 2곳(`text-job-privileges`, 감사 보고서)은 'backup_reader SELECT만 예외'로 좁게 갱신했다. 그 외 항목은 여전히 실패로 판정한다.

**적용**: `backup-reader-apply.mjs`(승인 참조 `BACKUP-READER-CREATE-2026-11-22`, SQL sha256 `efeb4183…`)
- 접속 문자열은 `.env.backup-production.local`(git 제외)에만 기록했다. GitHub에 입력한 뒤 삭제한다.

**적용 후 접근 테스트**: `backup-reader-check.mjs` 통과

| 항목 | 결과 |
|---|---|
| 연결 | TLS 검증 |
| 기본값 | 읽기 전용 |
| 테이블 | 57개 모두 소유자와 같은 행 수 |
| Storage 목록 | 135 = 135 |
| Realtime 메타데이터 | 읽기 가능 |
| 쓰기·테이블 생성·auth·vault | 42501(모든 시도는 롤백되는 트랜잭션 안에서 실행) |

**기존 권한 회귀**
- DB 권한 2단계 검증 7/7
- 작업 큐 권한 12/12
- 실행 가능한 SECURITY DEFINER 함수 0, 쓰기 가능 테이블 0
- 접근 가능한 스키마는 public·storage·realtime뿐

**덤프 시험**: `backup_reader`로 public 전체 `pg_dump`(TLS verify-full) 성공. 데이터 약 0.99MB(압축), 스키마 0.19MB. 출력은 해시만 계산하고 버렸다.

**앱 기존 계정·권한**: 변경 없음.

**되돌리기**
- 계정만 막기: `ALTER ROLE backup_reader NOLOGIN PASSWORD NULL`
- 완전 제거: `db/backup-reader-drop.sql`
- 비밀번호 재발급: `backup-reader-apply.mjs` 재실행(이전 비밀번호는 즉시 무효). 풀러가 잠시 이전 인증을 캐시할 수 있다.

### 7-3. 클라우드 백업 최종 점검

| 항목 | 결론 |
|---|---|
| 필수 데이터 포함 | public 전 테이블(행 수 일치) + Storage 전 객체 + Realtime 메타데이터. Production 덤프 시험 성공 |
| 내부 스키마 없이 새 프로젝트 복원 | public.dump는 빈 PG18에 복원 검증됨(Preview). **실제 새 Supabase 프로젝트 복원은 미시험**(Free 2개 한도). 새 프로젝트는 Data API ON·anon 기본 권한이 열려 있어 복원 직후 노출 방지 단계를 RUNBOOK 6-3에 추가함 |
| Storage S3 키 범위 | Supabase 문서 기준 모든 버킷 읽기·쓰기·삭제, RLS 우회(읽기 전용 키 없음). DB·Auth 권한은 없음. 유출 시 사진 삭제가 가능하지만 R2 잠금 백업으로 복구 가능 |
| Bucket Lock과 자동 삭제 충돌 | 잠금이 우선한다. 삭제 일수(10/63/570)가 잠금 일수(7/56/548)보다 길어 충돌이 없다. `status/`는 덮어써야 하므로 잠그지 않는다 |
| 예약 누락·자격 증명 만료 | Worker가 30시간 기준으로 재실행·알림. 모든 토큰과 키는 만료 없음, PAT는 매일 사용 |
| GitHub 장애 시 알림 | 백업과 알림이 함께 멈춘다(R2 기존 백업은 안전). Worker가 매일 재시도. GitHub 밖 알림 수단은 없음(남은 위험) |
| 중복 실행·재시도 | 실행 그룹 직렬화. 감시기 재실행은 20시간 안에 성공분이 있으면 생략(이번에 추가). 재실행은 새 경로에 써서 손상 없음 |
| 비용 | Production 덤프 약 1MB + 사진 22MB → 백업 1개 약 25MB. 18개월 후 R2 약 5GB(무료 10GB). Actions 실행당 약 5분 → 월 약 150분(무료 약 2,000분). 무료 한도를 넘기면 Actions는 결제 수단이 없을 때 멈춘다(과금 없음, 백업 중단 → 알림). R2는 8GB에서 경고 |
