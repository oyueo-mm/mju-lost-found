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

- 백업 파일은 **저장소 밖**에 보관한다(개인정보 포함). 저장소, 이슈, 채팅 등에 올리지 않는다.
- 2026-10-03 운영 전환 직전 Production 백업이 운영자 로컬에 있다(DB 전체 행 + Storage 원본 + 복원 SQL + README).
- 기본 절차
  1. 파괴적 작업 전에 DB 전체 테이블과 `post-images` Storage 파일을 백업한다(행 수·파일 checksum 기록).
  2. 백업에 비밀값이 섞이지 않았는지 검사한다.
  3. 복원 SQL은 실제 데이터에 commit하지 말고 트랜잭션 안에서 실행 후 ROLLBACK 하는 방식으로 먼저 검증한다.
  4. 복원이 필요하면: 앱 데이터가 빈 상태에서 복원 SQL → 시퀀스 보정 SQL 순서로 실행하고, Storage 파일을 같은 경로로 다시 올린다.
- Supabase 대시보드의 자체 백업 기능(요금제에 따라 다름)도 함께 확인한다.

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
MJU Find의 이용약관, 운영정책과 게시글 작성 화면의 안내 문구를 「유실물법」에 맞게 보완했습니다.
새로운 의무나 제한이 추가된 것이 아니라 기존 법령의 내용을 알기 쉽게 안내하는 변경이며, 다시 동의하실 필요는 없습니다.

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
