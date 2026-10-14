# 운영 가이드 (Production / Preview)

이 문서는 MJU 분실물 서비스를 운영·배포하는 사람을 위한 기본 절차다.
비밀값(DB 접속 문자열, OAuth secret, API key, 세션 secret)과 개인정보(이메일 등)는
이 문서와 저장소 어디에도 기록하지 않는다.

## 1. 환경

| 구분 | 주소 | DB / Storage | 용도 |
|---|---|---|---|
| Production | https://mju-find.vercel.app | Production Supabase 프로젝트 | 실제 서비스 |
| Preview | https://mju-lost-found-preview.vercel.app | Preview Supabase 프로젝트 | 개발·검증 |

- 두 환경은 **서로 다른 Supabase 프로젝트**(DB, Storage, Realtime)를 쓴다. 한쪽 작업이 다른 쪽 데이터에 닿으면 안 된다.
- 접속 정보는 Vercel 프로젝트의 Environment Variables에 환경별(Production / Preview)로 등록되어 있다.
  필요한 키: `DATABASE_URL`, `DIRECT_URL`, `AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
  `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `WITHDRAWN_IDENTITY_SECRET`(회원탈퇴 보류 식별값 HMAC 키, 32자 이상, 환경별로 다른 값, Sensitive).
  이 키를 바꾸거나 잃으면 기존 보류 식별값을 더 이상 대조할 수 없다. 키가 없으면 회원탈퇴 요청은 503으로 거부된다.
  `CRON_SECRET`(보유기간 정리 cron 인증, 환경별로 다른 값, Sensitive). Vercel Cron이 매일 03:00(KST) 무렵
  `GET /api/admin/settings`(CRON_SECRET 인증)을 호출해 탈퇴 계정의 보유기간이 지난 데이터를 정리한다(Production에서만 자동 실행).
  키가 없으면 정리는 실행되지 않는다(503). 실행 결과는 Vercel 로그의 `retention run` 줄에서 확인한다.
- 로컬에서 각 DB에 붙을 때는 로컬 전용 파일을 쓴다: Production은 `.env`, Preview는 `.env.preview.local`.
  스크립트는 대상 파일을 명시해서 실행한다(예: `npx tsx --env-file=.env.preview.local ...`).
  **어느 DB를 가리키는지 확인하지 않고 쓰기 작업을 하지 않는다.** 운영 스크립트는 대상 프로젝트를 검사하고
  다르면 실행을 거부하도록 만든다.

## 2. `.env`를 배포하지 않는 원칙

- Vercel CLI는 `.gitignore`를 따르지 않는다. 그래서 저장소 루트의 `.vercelignore`가 `.env`, `.env.*`
  (`.env.example` 제외)를 업로드 대상에서 뺀다. 이 파일을 지우거나 약화하지 않는다.
- 배포는 항상 Vercel Environment Variables만으로 동작해야 한다. 새 키가 필요하면 Vercel에 해당 환경으로
  등록한다(로컬 `.env`에만 두고 배포하지 않는다).
- 배포 후 확인: Vercel API `GET /v6/deployments/<deploymentId>/files` 결과에 `.env`가 없어야 한다
  (`.env.example`만 허용).

## 3. 배포 절차 (Preview 검증 후 Production 승격)

배포는 Vercel CLI로 한다(Git 연동 자동 배포 없음). 작업 트리가 깨끗하고 commit/push된 상태에서 진행한다.

1. 테스트: `npx vitest run`, `npx tsc --noEmit`, `npm run lint`
2. Preview 배포: `vercel deploy --yes` → 출력된 deployment URL 확인
3. Preview 주소 연결: `vercel alias set <preview deployment URL> mju-lost-found-preview.vercel.app`
4. Preview에서 기능 확인(변경한 기능 + 주요 페이지). DB schema가 바뀌었다면 Preview DB에 migration을 먼저 적용한다.
5. 같은 commit을 Production에 배포: `vercel deploy --prod --yes`
   (Production 주소 `mju-find.vercel.app`는 자동으로 새 배포를 가리킨다. 이전 주소 `mju-lost-found-vercel.vercel.app` 등은 308로 이 주소로 이동한다)
6. Production 확인: 주요 페이지 응답, 변경 기능, Vercel 로그에 5xx·오류 없음, 배포 파일에 `.env` 없음.

Preview에서 실패하면 Production에 배포하지 않는다. 문제가 생긴 Production 배포는 Vercel 대시보드에서
이전 배포로 되돌릴 수 있다(Instant Rollback). DB migration은 자동으로 되돌려지지 않으므로 별도 판단이 필요하다.

## 4. Prisma migration

- migration은 손으로 작성한 SQL을 `prisma/migrations/`에 추가하는 방식이다.
- 적용 순서: **Preview DB → 검증 → Production DB**.
- 적용 명령: `npx prisma migrate deploy` (Prisma CLI는 `prisma7.config.ts`가 읽는 `DIRECT_URL`에 붙는다.
  실행 전에 대상이 Production/Preview 중 어디인지 확인한다.)
- 상태 확인: `npx prisma migrate status`
- **Production에서 `prisma migrate reset`, `prisma migrate dev`, `prisma db push`는 사용하지 않는다.** 데이터가 삭제되거나
  migration 이력이 어긋난다.
- migration이 실패하면 강제로 고치지 말고 원인(락, 타임아웃, SQL 오류)과 실제 반영 여부를 먼저 확인한다.
  아무 단계도 적용되지 않은 실패라면 `npx prisma migrate resolve --rolled-back <migration>` 후 다시 `migrate deploy` 한다.
  migration 직전에는 장시간 열린 트랜잭션이 테이블을 잡고 있지 않은지 확인한다.

## 5. 백업과 복원

Supabase Free에는 **자동 백업이 없다.** 백업은 운영자가 직접 만든다.

- 백업 파일은 **저장소 밖**, 암호화된 디스크에 보관한다(개인정보 포함). 저장소·이슈·채팅·클라우드 공유 폴더에 올리지 않는다.
- 주기: **매주 1회** + **migration·대량 작업 직전 1회**. 보관은 최근 4주분과 migration 직전본(다음 migration까지)만 남기고
  나머지는 삭제한다(개인정보 최소 보관).
- 필요한 도구: PostgreSQL 클라이언트(`pg_dump`, `pg_restore`, `psql`, 17 이상)와, 복원 검증용으로 pgvector가 설치된 로컬
  PostgreSQL. Windows는 MSYS2 `mingw-w64-ucrt-x86_64-postgresql` + pgvector 소스 빌드로 준비했다.
- 백업 (원본은 읽기만 한다. `--expect`에 Supabase 프로젝트 ref를 주면 다른 DB를 가리킬 때 실행을 거부한다):
  ```
  PG_BIN=<pg_dump 폴더> node --env-file=.env scripts/backup/backup.mjs <저장소 밖 폴더> --expect <Production ref>
  ```
  결과: DB 전체/앱 스키마 덤프, 테이블별 행 수와 적용된 migration 목록, Storage 전체 파일과 SHA-256, `SHA256SUMS`.
- 복원 검증 (빈 로컬 DB에만 동작한다. migration 리허설도 함께 할 수 있다):
  ```
  PG_BIN=<폴더> VERIFY_DATABASE_URL=postgresql://postgres@127.0.0.1:<port>/<빈 DB> \
    node scripts/backup/verify-restore.mjs <백업 폴더> [--migrations prisma/migrations/<새 migration> ...]
  ```
  `RESTORE VERIFIED`가 나와야 그 백업을 믿는다(행 수 일치, DB가 참조하는 사진이 모두 백업에 있음). 검증 후 로컬 DB는 지운다.
- 실제 복원: 새(빈) Supabase 프로젝트에 같은 migration을 적용하지 말고, `extensions` 스키마와 `vector` 확장을 만든 뒤
  `pg_restore --no-owner --no-privileges db/public.dump`, Storage 파일을 같은 경로·MIME으로 다시 올린다. **운영 중인 DB 위에
  덮어쓰지 않는다.**
- 암호화: `BACKUP_PASSPHRASE=... node scripts/backup/seal.mjs seal <백업 폴더> --remove-plain` → `<폴더>.tar.enc`
  (AES-256-GCM, scrypt 키, 만든 직후 복호화해 원본과 대조한 뒤에만 평문을 지운다). 복원할 때
  `seal.mjs unseal <파일> <폴더>`. 암호는 암호 관리자에만 두고 2명 이상이 안다(잃으면 복원 불가). Windows 11 Home에는
  EFS·BitLocker가 없어 이 방식을 쓴다.
- **자동 실행(주 1회)**: `scripts/backup/weekly.ps1`이 백업 → 암호화 → 평문 삭제 → `weekly-*.tar.enc` 최근 4개만 보존을 한다.
  이름이 다른 백업(예: migration 직전본)은 지우지 않는다. 실패하면 로그(`weekly-backup.log`)에 남기고 메시지 창을 띄우며
  종료 코드 1로 끝난다(작업 스케줄러의 "마지막 실행 결과"에도 표시). 등록(운영자 PC, 한 번만):
  ```
  [Environment]::SetEnvironmentVariable("BACKUP_PASSPHRASE", "<암호>", "User")
  schtasks /Create /TN "MJU Find weekly backup" /SC WEEKLY /D SUN /ST 04:00 /RL LIMITED /TR ^
    "powershell -NoProfile -ExecutionPolicy Bypass -File C:\proj_claude\mju-lost-found-vercel\scriptsackup\weekly.ps1"
  ```
  PC가 꺼져 있으면 실행되지 않는다(작업 스케줄러에서 "예약된 시작 시간을 놓친 경우 가능한 대로 빨리 실행" 설정 권장).
  매월 1회 로그와 최신 파일 날짜를 확인하고, 분기마다 1회 `unseal` + `verify-restore.mjs`로 복원 검증을 한다.
- 저장 위치와 권한: 운영자 PC의 `%USERPROFILE%\mju-lost-found-backups`(상속 해제, 본인·SYSTEM·Administrators만 접근).
  같은 디스크 고장에 대비해 월 1회 암호화본(`.tar.enc`)만 외장 저장장치 등 다른 매체에 복사한다. 평문 백업은 외부로 옮기지 않는다.
- 보존: 주간 암호화본 4개, migration 직전본은 다음 migration 검증까지. 기간이 지난 평문 폴더는 확인 후 삭제한다.
- 2026-10-14 이름·소속 배포 직전 백업: `production-2026-10-14-pre-identity` (복원 검증 완료, 평문 — 암호를 정한 뒤 seal 권장).

## 6. 관리자

- 관리자 권한은 DB의 사용자 `isAdmin` 값으로 정해지고, 모든 관리자 페이지·API·서버 액션이 요청마다 서버에서 다시 확인한다
  (UI 표시만으로 권한이 생기지 않는다).
- **첫 관리자 지정** (관리자가 한 명도 없을 때만 동작):
  1. 운영자가 Production에서 Google 로그인 → 개인정보·약관 동의 → 닉네임 등록을 마친다.
  2. dry run: `npx tsx --env-file=.env scripts/grantFirstAdmin.ts --email <운영자 이메일>`
  3. 대상 확인 후 적용: 같은 명령에 `--apply --confirm-production` 추가
  - 관리자가 이미 있으면 스크립트가 거부한다. 영구적인 우회 수단이 아니다.
- **이후 관리자 추가**: 앱의 관리자 화면에서 권한 부여 제안을 만들고 다른 관리자가 승인한다(AdminActionProposal).
  DB를 직접 수정해서 관리자를 늘리지 않는다.
- 2026-10-03에 첫 관리자가 지정되었다.

## 7. 로그인 정책

- Google OAuth. 로그인 허용 여부는 서버(`src/lib/auth/access.ts`)가 아래 순서로 판정한다.
  1. `@mju.ac.kr` 계정 → 항상 허용 (`userType` STUDENT)
  2. 관리자가 승인한 외부 관계자 이메일(`/admin/external-access`, 승인 상태) → 허용 (`userType` EXTERNAL_VERIFIED,
     "인증된 외부 관계자" 배지)
  3. 승인이 취소된 이메일 → 항상 거부(테스트 모드가 켜져 있어도). 이미 로그인한 세션도 다음 요청부터 차단된다.
  4. 그 외 Google 계정 → `AppSettings.googleTestModeEnabled`(관리자 대시보드의 Google 테스트 모드)가 켜져 있을 때만 허용
     (`userType` EXTERNAL_TEST). 현재 상태는 관리자 대시보드에서 확인한다.
- `userType`은 로그인할 때마다 서버가 다시 계산한다. 어떤 경우에도 관리자 권한은 자동으로 주어지지 않는다.
- 외부 관계자는 한 사람당 한 계정으로 등록한다(공용 계정 금지). 경비실처럼 여러 사람이 한 이름으로 활동해야 하면
  단체를 만들고 각자의 계정을 운영진으로 지정해 단체 명의 기능을 쓴다.
- 가입해도 동의·닉네임 등록 전에는 서비스를 이용할 수 없다.
- Google Cloud Console의 Production OAuth 클라이언트에는 JavaScript origin `https://mju-find.vercel.app`과
  redirect URI `https://mju-find.vercel.app/api/auth/callback/google`이 등록되어 있어야 한다
  (주소를 바꾸면 이 값도 함께 바꾼다). `AUTH_URL`은 설정하지 않는다. Auth.js가 요청 주소로 콜백 URL을 만든다.

## 8. 장애 대응 기본 순서

1. 범위 확인: Production만인지, Preview도인지 / 특정 기능인지 전체인지.
2. Vercel 대시보드 → 프로젝트 → **Logs**(런타임 로그, 5xx, `console.error`)와 **Observability**(함수 오류율·지연).
   CLI: `vercel logs <deployment URL>`
3. 최근 배포 확인: 문제 시점 직전에 배포가 있었다면 이전 배포로 Instant Rollback을 우선 검토한다.
4. DB: `npx prisma migrate status`로 migration 상태 확인, Supabase 대시보드에서 DB 상태·연결 수·장시간 트랜잭션 확인.
5. Storage / Realtime: Supabase 대시보드에서 상태 확인. 채팅 실시간 반영 문제는 로그의
   `Failed to broadcast chat realtime event` 메시지를 확인한다(서버는 `after()`로 응답 후에도 전송을 마친다).
6. 로그인 문제: OAuth redirect URI, Vercel의 `GOOGLE_*`/`AUTH_SECRET` 값, 테스트 모드 설정을 확인한다.

## 8-1. Storage bucket

| bucket | 공개 | 용도 | 제한 |
|---|---|---|---|
| `post-images` | 공개 | 게시글 이미지(누구나 보는 게시글에 붙는 사진) | 10MB, jpeg/png/webp |
| `chat-images` | **비공개** | 1:1 채팅·단체 문의 채팅 이미지 | 10MB, jpeg/png/webp |

- `chat-images`는 공개로 바꾸지 않는다. 앱은 공개 URL을 만들지 않고, DB(`Message.image_url` 컬럼, 코드에서는 `imagePath`)에
  object path(`chat/{roomId}/{uuid}.{ext}`)만 저장한다.
- 채팅 이미지는 `GET /api/chat/{roomId}/messages/{messageId}/image`로만 제공된다. 서버가 로그인(401)과 채팅방 참여자·관리자 여부(403)를
  확인한 뒤 60초짜리 signed URL로 redirect한다. 응답은 `Cache-Control: private, no-store`. 업로드할 때 object의 cache 수명도 60초로 둔다.
- 화면에서는 `next/image`의 `unoptimized`로 표시한다(`/_next/image` 공용 캐시에 남지 않게).
- **bucket 생성/확인** (새 Supabase 프로젝트를 만들 때도 같은 방법):
  1. dry run: `npx tsx --env-file=.env.preview.local scripts/ensureChatImagesBucket.ts`
  2. 생성: 같은 명령에 `--apply` (Production은 `--env-file=.env ... --apply --confirm-production`)
  - 이미 있으면 설정만 검사한다(비공개, 10MB, 이미지 타입). 다르면 실패로 끝나고 기존 bucket은 바꾸지 않는다.
- storage RLS 정책은 두지 않는다. 비공개 bucket은 service role(서버)만 접근하고, 업로드는 서버가 발급한 signed upload URL로만 한다.
- **고아 채팅 이미지 점검** (업로드만 하고 전송하지 않은 파일, Storage 삭제 실패):
  `npx tsx --env-file=.env scripts/reportChatImageOrphans.ts` — 읽기 전용. 24시간 넘게 어떤 메시지도 참조하지 않는 파일과,
  메시지가 가리키는데 실제로는 없는 파일을 보고한다. 자동 삭제는 하지 않는다. 지워야 하면 보고서의 path를 확인한 뒤 그 path만 삭제한다.

## 9. 데이터 삭제 시 주의사항

- Production 데이터 초기화는 2026-10-03 운영 시작 시 1회 수행했다. **이후 Production 데이터 일괄 삭제·초기화는 하지 않는다.**
- 개별 데이터 정리가 꼭 필요하면: 백업 → 대상 행을 ID로 한정 → 트랜잭션 안에서 삭제 → 결과 확인 순서로 한다.
  실제 사용자의 데이터가 섞여 있지 않은지 먼저 확인한다.
- DB 행을 지우면 Storage(`post-images`) 파일도 함께 정리해야 한다(고아 파일 방지). 반대로 DB가 참조 중인 파일은 지우지 않는다.
- `_prisma_migrations`, `AppSettings`, schema·extension(pgvector)·인덱스는 삭제 대상이 아니다.
- Preview DB를 정리할 때도 같은 원칙을 따른다(테스트로 만든 행만 ID로 한정해 삭제).

## 10. 버전 tag

| tag | commit | 의미 |
|---|---|---|
| `v1.0-competition-final` | `00fd0ee` | 대회 당시 Preview에서 서비스하던 최종 버전 |
| `v1.0-production-launch` | `22657ee` | 실제 운영을 시작한 Production 버전(데이터 초기화, `.env` 배포 차단, Vercel 환경변수 사용, 첫 관리자 지정, 채팅 실시간·화면 오류 수정 포함) |

## 11. 약관·정책 문구 변경 공지

- 이용자에게 새 의무를 지우지 않고 기존 법령 안내만 명확히 하는 문구 보완은 `CURRENT_TERMS_VERSION`을 올리지
  않는다(올리면 전원이 재동의 화면을 거친다). 대신 Production 반영 직후 관리자 화면 `/admin/announcements`에서
  공지를 등록한다. 공지는 모든 활성 이용자에게 "공지사항" 알림으로 전달되고 `/announcements/<id>`에서 볼 수 있다.
- 공지는 한 언어(한국어)로만 등록된다. 다국어 화면 문구는 각 언어 메시지 파일에 이미 반영되어 있다.

### 2026-10 유실물법 안내 보완 공지 문안

제목: 이용약관·운영정책 안내 문구 보완 안내 (유실물법 관련)

내용:

```
MJU Find의 이용약관, 운영정책과 게시글 작성 화면의 안내 문구를 보완했습니다.
이번 변경은 「유실물법」 등 기존 법령에 따른 내용을 이용자가 더 명확하게 알 수 있도록 안내하기 위한 것입니다.

주요 내용
- MJU Find에 글을 올리는 것은 경찰 신고나 습득물 제출을 대신하지 않습니다. 주운 물건은 소유자에게 돌려주거나
  경찰서·지구대·파출소에 제출해야 하며, 학교 건물처럼 관리자가 있는 곳에서 주웠다면 경비실 등 건물 관리자에게
  인계해야 합니다.
- 경찰관서나 학교 내 보관 부서에 맡겨진 물건은 해당 기관의 정식 반환 절차(본인 확인, 보상금 협의 등)를 따릅니다.
- 게시글의 사례는 작성자가 자율적으로 정하는 것이며, 「유실물법」에 따른 보상금(물건가액의 5~20%)과는 다릅니다.
  법정 보상금을 정해진 범위와 절차에 따라 청구·협의하는 것은 운영정책상 금지행위가 아닙니다.
- 신분증·학생증·카드 등 개인정보가 담긴 물건은 이름·학번·주민등록번호·카드번호·얼굴 사진 등을 가린 뒤 사진을
  올려 주세요.

자세한 내용은 이용약관(/policy/terms)과 운영정책(/policy/community)에서 확인할 수 있습니다.
```

## 12. 운영 통계와 모니터링

- 관리자 화면 `/admin/stats`(관리자만): 일·주·월 단위 신규 가입, 활성 이용자, 분실/습득 등록, 키워드·자연어·이미지 검색,
  AI 추천 노출, 채팅방·메시지, 반환 완료, 홍보 전후 비교, API 응답 시간(p50/p95)·오류율, AI 추론·DB 지연, DB·Storage 용량.
- 기존 테이블로 셀 수 있는 지표는 그 테이블에서 센다. 나머지만 `MetricDaily`(검색·추천 일별 카운터, 검색어 원문 없음),
  `ActivityDay`(회원 id의 HMAC으로 하루 1행), `ApiMetricHourly`(시간대·경로별 요청 수·오류 수·지연 분포)에 기록한다.
  기록은 응답 뒤에 하고 실패해도 요청에 영향이 없다. API 지연은 인스턴스 메모리에 모았다가 최대 1분에 한 번 쓴다.
- 보관: 활성 기록 400일, API 지연 90일(매일 정리 cron). 일별 카운터는 하루 몇 행이라 유지한다.
- 용량: 매일 정리 cron이 DB·Storage 크기를 기록하고 대시보드가 무료 한도 대비 %로 보여 준다(60% 주의, 80% 조치).
- 매월 1회 확인: Vercel 대시보드 → Usage(함수 호출, Active CPU, 이미지 변환, 데이터 전송)와 Supabase 대시보드 → Usage.
  Hobby에서는 CLI·API로 사용량을 조회할 수 없다(Observability Plus 필요). 한도 근접 알림 메일도 함께 확인한다.
- 런타임 로그는 Hobby에서 1시간만 남는다. 오류 추이는 대시보드의 오류율로 보고, 원인은 재현 직후 `vercel logs`로 본다.
  이름·소속 수집 진단은 `node scripts/identity-signin-log.mjs <배포 URL> 1h`(값 없음).

## 13. 무료 한도와 확장 시점

현재 요금제: Vercel Hobby, Supabase Free (2026-10 기준 공식 문서).

| 자원 | 무료 한도 | 2026-10-15 사용량 | 먼저 닿는 조건 |
|---|---|---|---|
| Vercel 함수 호출 | 월 100만 | 대시보드 확인 | 페이지 조회·prefetch |
| Vercel Active CPU | 월 4시간 | 대시보드 확인 | 페이지 렌더링, AI 추론 |
| Vercel 이미지 변환 | 월 5,000 | 대시보드 확인 | 새 사진 × 화면 크기, 캐시 만료(기본 4시간) |
| Vercel 함수 수 | 배포당 12개에 걸린 이력(next.config.ts 주석) | 한도 근접 | 새 API 라우트·라우트별 설정 대신 서버 액션·기존 라우트 사용 |
| Supabase DB | 500MB | 16MB | 게시글·임베딩·채팅 누적 |
| Supabase Storage | 1GB | 13MB(사진 84장, 장당 약 160KB) | **사진 약 6,000장** |
| Supabase Realtime | 동시 200 연결, 월 200만 메시지 | 소량 | 채팅방을 연 사람 수 |
| Supabase 비활성 | 1주 비활성 시 일시정지 | 매일 cron이 접근 | Preview는 cron이 없어 멈출 수 있음 |

측정값(로컬 프로덕션 빌드, 2026-10-15): 비로그인 목록 화면 1회 조회 시 서버 요청이 prefetch 정리 전 65개 → 정리 후 25개
(문서 1 + 메뉴 prefetch 약 13 + 사진 변환 요청 11, 사진 변환은 캐시 후 재사용). 게시글 상세 29 → 17.

확장 판단(근거는 위 측정과 대시보드 Usage):
- Vercel Pro(개발자 1인 월 $20): 월 함수 호출·Active CPU·이미지 변환 중 하나가 70%를 넘는 달이 생길 때, 로그 보관(1일)과
  관측 지표가 필요할 때, 또는 광고·후원 등 상업적 성격이 생길 때(Hobby는 비상업 개인 용도만 허용).
- Supabase Pro(월 $25부터): Storage 70%(약 700MB) 또는 DB 70%(350MB)에 닿을 때, 자동 일일 백업이 필요할 때, 일시정지를
  피해야 할 때. 사진 용량이 가장 먼저 닿을 가능성이 크다.
- 비용 없이 먼저 할 일: 이미지 변환 캐시 기간 결정(4시간 → 7일 등, 삭제된 사진이 변환 캐시에 남는 기간과의 균형), 업로드 시
  목록용 작은 사진 생성 검토, 반환 완료 후 오래된 사진 보관 기준 결정, 쓰지 않는 `imageEmbeddingDino` 컬럼·인덱스 제거.

## 14. 장애 체크리스트

| 증상 | 먼저 볼 곳 | 조치 |
|---|---|---|
| 사이트 전체 5xx / 느림 | `/admin/stats` 오류율·p95, Vercel Logs | 직전 배포가 있으면 Instant Rollback, 아니면 DB 상태 확인 |
| DB 연결 실패 | `db:ping` 지연·기록 중단, Supabase 대시보드(상태, 일시정지, 연결 수) | 일시정지면 대시보드에서 Restore, 연결 초과면 장시간 트랜잭션 확인 |
| 무료 한도 초과 | Vercel·Supabase Usage, 안내 메일 | Vercel Hobby는 초과 기능이 최대 30일 멈춘다 → 즉시 원인(급증 경로) 확인 후 요금제 결정 |
| 로그인 실패 | Vercel Logs `AccessDenied`·`Configuration`, `Identity sign-in check` | OAuth redirect URI, `AUTH_SECRET`/`GOOGLE_*` 값, 테스트 모드 설정 |
| 사진 업로드 실패 | 화면의 업로드 오류·429, 로그 `Failed to clean up orphaned` | Storage 용량·bucket 설정 확인, 고아 파일 점검 스크립트 |
| 채팅 실시간 미반영 | 로그 `Failed to broadcast chat realtime event`, Realtime 연결 수 | 새로고침으로는 동작(서버 저장), Realtime 한도 확인 |
| AI 검색·추천 없음 | `ai:*` 지연·오류, 로그 `Failed to generate embedding` | 모델 파일 배포 여부(`models/`), 함수 메모리 확인 |

복구 후 기록: 시각·원인·영향 범위·조치를 이 문서 끝 "장애 기록"에 짧게 남긴다(개인정보 없이).

## 15. 인수인계

담당자가 졸업·입대 등으로 바뀌어도 서비스가 멈추지 않도록 한다.

- 계정·권한: Vercel 팀 `oyueo`, Supabase 프로젝트(Production·Preview), Google Cloud OAuth 클라이언트, GitHub 저장소,
  운영 메일함. 각각 **최소 2명**이 소유자·관리자 권한을 갖는다. 개인 계정 하나에만 묶인 자원을 만들지 않는다.
- 비밀값: Vercel Environment Variables가 원본이다. 로컬 `.env` 사본은 개인 기기에만 두고, 넘길 때는 암호 관리자 공유로 넘긴다.
  인계 후 `AUTH_SECRET`(전원 재로그인), `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, Google client secret을 교체한다.
  `WITHDRAWN_IDENTITY_SECRET`는 바꾸면 기존 탈퇴 보류 대조가 불가능하므로 교체하지 않고 그대로 넘긴다.
- 서비스 관리자: 앱의 관리자 권한도 최소 2명. 추가는 관리자 화면의 권한 부여 제안·승인(6장)으로 한다.
- 인계 체크리스트: ① 위 계정 권한 이전 ② 이 문서와 `README` 정독 ③ 로컬 환경 구성 후 `npx vitest run`·Preview 배포 1회
  ④ 백업 1회와 복원 검증 1회 직접 수행 ⑤ `/admin/stats`·Usage 확인 방법 숙지 ⑥ 이전 담당자 계정 권한 회수, 비밀값 교체.
- 정기 일정: 매주 백업, 매월 Usage·용량 확인, 학기 시작·축제 전 한도 점검과 공지(접속 집중 대비), 연 1회 정책·약관 점검.
