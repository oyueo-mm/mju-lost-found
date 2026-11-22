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

## 5. 새로 발견한 문제: 앱의 DB 연결에 TLS가 강제되지 않음

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
