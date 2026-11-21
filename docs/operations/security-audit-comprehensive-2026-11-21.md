# MJU Find 종합 보안 감사 (2026-11-21)

- 기준: OWASP ASVS 5.0 · OWASP Top 10:2025 중 이 서비스에 해당하는 항목(접근 통제, 인증·세션, 입력 처리, 파일, 설정·공급망, 로깅·사고 대응, 자원 소비)
- 대상: 현재 Production `dpl_GFjSiuYqn8TCsMz68ddQkCUh2g3q`(`8a67cdd`)와 같은 코드, Supabase(Production·Preview), Vercel, 공개 GitHub 저장소 `oyueo-mm/mju-lost-found`
- 방법
  - 코드 전수 점검: API 라우트 35개, Server Action 약 55개, 관리자 페이지 20개
  - 공개 저장소 전체 이력 비밀정보 스캔(커밋 475개)
  - `npm audit`
  - 격리 Preview 재현: 전용 테스트 회원·글, 끝나면 정리
  - Production은 공개 설정 조회 1건(GET `/auth/v1/settings`)만 했다. Production에 공격 페이로드·부하·무차별 대입·쓰기는 하지 않았다.
- 이전 결과를 재사용했다(다시 검증하지 않음): Release A~C(정지·테스트 모드 세션, 신고 증거 보존), Release B(SSRF·매직 넘버), D-1(공유 요청 제한), D-3(private Realtime), DB 권한 2단계, Data API OFF, 백업 복원 검증, XSS·CSRF 1차 감사와 P-2·P-3([security-audit-xss-csrf-2026-11-21.md](security-audit-xss-csrf-2026-11-21.md))

> 결론은 "안전하다"가 아니다. 데이터에 직접 닿는 **실제 취약점 1건(댓글 노출)**은 Preview에서 수정·검증을 마쳤다. 그 밖에 **남용·마비 계열 위험 4건**과 **세션·계정 관리 공백**이 남아 있다. 가장 큰 잔여 위험은 코드가 아니라 **계정(Vercel·Supabase·GitHub·Google)과 운영 PC**에 집중돼 있다.

## 1. 공격 표면

| 영역 | 구성 | 인증 |
|---|---|---|
| 페이지 | 공개(목록, 상세, 검색, 정책, 프로필, 기관), 회원(글쓰기, 채팅, 내 정보), 관리자 20개 | Auth.js JWT 쿠키(HttpOnly, Secure, SameSite=Lax) |
| API | 35개: 게시글·댓글·검색(키워드/의미/사진/AI)·업로드 서명·채팅(메시지·읽음·사진·Realtime 토큰·업로드)·알림·신고·관리자·동의·탈퇴·CSP 보고·버전·Auth.js | 공개 GET, 회원, 관리자 권한키 19종, cron Bearer |
| Server Action | 약 55개(관리자, 기관, 키워드 알림, 감사 쪽지, 푸시, 실명, 피드백, 재가입, 방문·조회 통계) | 액션별 require* 게이트. 통계·재가입·공지 닫기는 의도적 무게이트 |
| 백그라운드 | Vercel cron 2개(02:00 임베딩 정리, 03:00 보존 정리), `after()` 작업 큐 | `CRON_SECRET`(timing-safe 비교) |
| Supabase | Postgres(앱은 `postgres` 역할로 직접 접속), Storage 3버킷(post-images 공개, chat-images·report-evidence 비공개), Realtime(private), Auth(앱 미사용) | 공개 anon 키, 서버 service_role 키 |
| 외부 | Google OAuth, 웹 푸시(VAPID, 현재 비활성), GitHub 공개 저장소 | - |
| 운영 | 운영자 PC(배포 CLI, `.env.operations-production`, 로컬 암호화 백업·복호화 암호), Vercel·Supabase·GitHub 대시보드 | 각 계정 |

## 2. 방어 현황 (구현·검증 완료)

| 항목 | 근거 |
|---|---|
| 인증·인가 게이트 전수 | API 35개 모두 게이트 또는 의도된 공개. 관리자 페이지 20개 모두 `requirePermission`/`requireAdmin`. Server Action은 무게이트 5개만 의도된 익명(재가입은 서버 서명 쿠키의 신원만 사용) |
| IDOR/BOLA | 서버가 DB에서 소유·참여를 다시 확인한다: 알림(`userId`), 신고(신고자), 게시글 수정·삭제·재계산·업로드 서명(작성자), 채팅방·메시지·사진(참여자, 관리자는 신고 건 필요), 기관 관리(해당 기관 역할), 실명 열람(신고 당사자 + 사유 + 열람 기록) |
| 권한 상승 | `permissions.manage`는 부여 불가(전체 관리자 전용), 본인 권한 변경 금지, 관리자 대상 승격·강등·정지는 2인 승인 |
| 정지·탈퇴 회원 | 매 요청 DB 재확인(`deletedAt`, 외부 승인 취소). 정지 회원은 글·댓글·채팅·업로드·수정·재계산 차단(Release C) |
| SQL Injection | 모든 raw 쿼리가 Prisma 파라미터 바인딩이다. `Prisma.raw`는 코드 상수(테이블·컬럼명, 서버 계산 단위)만 쓴다 |
| XSS | 사용자 입력이 HTML로 들어가는 싱크 없음. React 이스케이프, `javascript:` 차단(React 19). CSP Report-Only(운영 위반 0) |
| CSRF | P-2 출처 검사 Production 적용(Production 익명 검사 10/10), SameSite=Lax, Server Action Origin 검사, Auth.js CSRF 토큰 |
| SSRF | 서버 fetch는 신뢰 Storage 허용 목록(`trustedImageFetch`), cron kick(고정 URL), 증거 사진(서버가 만든 서명 URL)뿐 |
| 파일 업로드 | 서명 발급 시 타입·소유 검사 → 첨부 시 매직 넘버, 확장자 대조, sharp 디코드(픽셀 상한), EXIF 제거. 사용자 파일은 Supabase 도메인에서 제공 |
| Supabase 직접 접근 | Data API OFF. client 역할 테이블 권한 0(2단계). anon의 Storage 목록 조회 3버킷 모두 빈 결과(Preview 실측). Realtime 수신 정책은 전용 역할 `mju_chat_realtime` + 서버 grant 행이 필요하다. Supabase Auth로 만든 `authenticated` 사용자는 통과하지 못한다(정책 SQL 확인) |
| 비밀정보 | 공개 저장소 전체 이력(커밋 475개)에서 실제 비밀값 0건. 테스트 파일의 DB 주소 비밀번호는 실제 값과 다름(해시 비교). `.env*`는 예시 파일만 커밋. Vercel Production 비밀값은 모두 Hidden |
| 요청 제한 | DB 공유 카운터라 여러 서버 인스턴스에서도 우회 불가. 익명 IP는 Vercel 헤더만 신뢰. 글·댓글·채팅·업로드·신고·피드백·키워드·감사 쪽지·AI 검색·임베딩 재계산에 적용 |
| 응답 헤더 | nosniff, Referrer-Policy, X-Frame-Options DENY, Permissions-Policy, HSTS |
| 백업 | 암호화(GCM), 체크섬, 실제 복원 검증(최근 `auto-2026-11-21` 테이블 57개 일치) |

## 3. 발견한 문제

### 3-1. 실제 취약점

| ID | 심각도 | 내용 | 전제조건 | 피해 범위 | 위치 | 근거 | 조치 |
|---|---|---|---|---|---|---|---|
| **A-1** | Medium | 임시 숨김(권리침해 신고)·삭제(탈퇴·관리자 삭제) 게시글의 **댓글이 계속 공개 조회됨**. 본문은 404인데 댓글 API는 글 상태를 확인하지 않았다 | 게시글 ID(순차 정수, 공개 목록에서 추정 가능) | 숨김·삭제 글의 댓글 본문과 작성자 닉네임. 권리침해 신고로 가린 내용이 댓글에 남아 있으면 그대로 노출 | `src/app/api/posts/[id]/comments/route.ts` GET·POST | Preview 재현: 숨김·삭제 모두 **200 + 댓글 원문**(`scripts/regression/hidden-post-comments.mjs`) | **수정 완료(Preview)**: `src/lib/posts/visibility.ts` 공통 규칙으로 GET·POST 404. 수정 후 Preview 3/3(정상 200, 숨김·삭제 404), 단위 6개 추가. 브랜치 `fix/audit-hidden-post-comments` `0293e03`. **Production 미배포** |
| **A-2** | Medium | **Supabase Auth 이메일 가입이 열려 있음**(Production·Preview `disable_signup=false`, email provider on). 앱은 Supabase Auth를 쓰지 않는다 | 공개 anon 키(사이트 번들에 포함) | 데이터 접근은 없음(위 2절 검증). 대신 `auth.users` 무제한 생성(DB 용량), Supabase 발송 메일 남용(가입 확인 메일), 쓰지 않는 인증 경로가 열려 있어 향후 정책 실수 시 위험 | Supabase 설정 | Production 공개 설정 GET 1회 | 대시보드: Authentication → 가입 허용 끄기, Email provider 끄기(앱 영향 없음, 사용자 실행) |
| **A-3** | Medium | **미첨부 업로드로 Storage 고갈 가능**. 회원 1명이 업로드 서명만 받아 하루 200장 × 10MB = 최대 약 2GB를 올릴 수 있고, 첨부하지 않은 파일은 정리되지 않는다(D-5 미구현) | 학교 계정 1개(또는 승인된 외부 계정) | Supabase Storage 한도 소진 → 모든 사용자의 사진 업로드 실패. 악용 계정은 식별·정지 가능 | `src/app/api/upload/route.ts`, `RATE_LIMITS.imageUpload` | 코드 확인(실행 안 함) | D-5 고아 파일 자동 정리(짧은 유예 뒤 미참조 객체 삭제), 사용자별 **미첨부 용량 상한**, 일일 업로드 합계 알림 |
| **A-4** | Medium | **익명 AI 검색 상한이 IP 단위뿐**이고 서비스 전체 상한이 없다. IPv6는 /64 대역 안에서 주소를 바꿀 수 있어 하루 100회 제한을 사실상 우회한다 | IPv6 대역을 가진 공격자 | 요청마다 임베딩 추론(CPU, 최대 120초 함수) → Vercel Hobby 사용량 소진. Hobby는 초과 요금이 아니라 **기능 제한·일시정지**가 될 수 있다(확인 필요) → 서비스 마비 | `src/app/api/posts/route.ts` `limitAiSearch`, `rateLimit/index.ts` `clientIpFrom` | 코드 확인 | IPv6는 /64로 묶어 해시, 익명 AI 검색에 **서비스 전체 분당·일일 상한**(초과 시 키워드 검색으로 대체) |
| **A-5** | Medium | **익명 목록·키워드 검색·상세 조회에 요청 제한 없음** | 봇·분산 요청 | DB(공유 소형 인스턴스)·pooler 연결 고갈 → 전체 장애. 요청마다 함수 호출 소모 | `GET /api/posts`, `/post/[id]`, `/search` | 코드 확인. 부하 시험은 금지 범위라 하지 않음 | Vercel Firewall(Attack Challenge Mode, 가능한 경우 rate-limit 규칙, 확인 필요), 목록 응답 짧은 CDN 캐시(`s-maxage`) 검토, 인스턴스 메모리 기반 익명 상한 |

### 3-2. 잠재 위험·예방적 개선

| ID | 심각도 | 내용 | 조치 |
|---|---|---|---|
| **P-5** | Medium | **세션을 서버에서 무효화할 수단이 없다**. JWT 기본 수명 30일. 로그아웃해도 탈취된 쿠키는 계속 유효하고, "모든 기기에서 로그아웃"이 없다. 긴급 수단은 `AUTH_SECRET` 교체(전원 로그아웃)뿐이다. 정지·탈퇴·외부 승인 취소는 매 요청 DB 확인으로 즉시 반영된다 | `User.sessionVersion`을 토큰에 넣고 매 요청 비교(이미 매 요청 사용자 행을 읽으므로 추가 비용 거의 없음), 로그아웃·관리자 강제 로그아웃 시 증가, `session.maxAge` 7~14일로 단축 |
| P-6 | Low | 공개 API에 **내부 정수 회원 ID**(`userId`, `author.id`)가 노출된다. 공개용 `publicId`가 따로 있다 | 공개 DTO에서 내부 ID 제거(클라이언트 사용처 확인 후) |
| P-7 | Low | 이미지 fetch 허용 목록이 **모든 `*.public.blob.vercel-storage.com`**을 신뢰한다. 사용자가 `imageUrl`을 지정할 수 없어 현재는 도달 불가 | 기존 Vercel Blob 행이 없음을 확인하면 허용 목록에서 제거 |
| P-8 | Low | 기본 브랜치 `vercel`에 **브랜치 보호가 없다**(강제 push·삭제 가능). 배포는 CLI라 직접 피해는 없다 | 강제 push·삭제 금지 규칙 |
| P-9 | Low | `npm audit` 운영 의존성 High 6, Moderate 1. 모두 **Prisma CLI**(`@prisma/config`, `effect`, `deepmerge-ts`, `mysql2`, `fast-uri`)와 postcss의 `source-map-js`라 요청 경로에서 도달하지 않는다 | Prisma 수정판 출시 시 갱신, Prisma CLI를 devDependencies로 이동 검토 |
| P-10 | Low | 알림 수정·삭제가 남의 ID에 403, 없는 ID에 404를 답해 ID 존재 여부가 드러난다 | 둘 다 404 |
| P-11 | Low | 공개 저장소에 운영 문서(배포 ID, DB 프로젝트 ref, 운영 절차, 테스트 계정 번호)가 공개돼 있다. 비밀값은 없다 | 민감 운영 문서는 비공개 저장소로 분리 검토 |
| P-12 | Medium | CSP `'unsafe-inline'`(XSS 1차 감사 P-1). 현재 주입 경로가 없어 심층 방어 문제 | Report-Only 관측 → enforce → nonce 비교(별도 결정) |
| P-13 | Low | 숨김·삭제 게시글의 **사진 파일**은 공개 버킷 URL과 CDN 캐시에 남는다(SEC-CDN-DELETE-001, 기존 추적 항목) | 기존 계획대로 |
| P-14 | Low | 관리자 계정이 탈취되면 회원 이메일 전체 목록(`users.view`)을 볼 수 있다. 실명·학과는 신고 건 단위로만 열람되고 기록된다 | 관리자 목록 조회도 관리자 활동 기록에 남는지 확인, 관리자 Google 계정 2단계 인증 필수화 |

### 3-3. 검증 근거 부족 (사용자 확인 또는 추가 작업 필요)

| 항목 | 확인 방법 |
|---|---|
| GitHub·Vercel·Supabase·Google(관리자 계정) **2단계 인증**, 팀 구성원·권한 | 각 대시보드 보안 설정 화면(사용자 확인) |
| Vercel 비밀값이 "Sensitive" 유형인지(목록상 Hidden) | Vercel 환경 변수 화면 |
| Supabase 요금제 한도(DB 500MB, Storage, egress, Realtime 동시 연결)와 **관리형 백업·PITR 제공 여부** | Supabase Billing·Database Backups 화면 |
| Vercel Hobby 한도 초과 시 동작(일시정지 여부), Firewall 기능(Attack Challenge Mode, rate-limit 규칙) 사용 가능 범위 | Vercel 문서·Usage 화면 |
| Supabase Realtime 공개 채널 허용 설정. anon 키로 WebSocket을 많이 열어 동시 연결 한도를 소진하는 공격의 실제 한도 | Supabase Realtime 설정(앱은 polling fallback이 있어 기능 유지) |
| Production 로그인 흐름(채팅·관리자·사진 첨부) | 사용자 수동 확인 |
| 11-22 02:00·03:00 cron, 04:00 예약 백업(AC 미연결 상태였음) | 다음 세션 |

## 4. 개인정보 대량 유출 경로 (가능성이 큰 순)

| 경로 | 필요한 것 | 얻는 것 | 현재 방어 | 남은 공백 |
|---|---|---|---|---|
| ① 운영자 PC 탈취 | 악성코드·분실 | `.env.operations-production`(Production DB 자격증명), 로컬 백업과 **복호화 암호(같은 PC의 자격 증명 관리자)**, Vercel·GitHub CLI 로그인 | 디스크 위 백업 암호화 | 암호화 키가 같은 PC에 있다. PC 전체 디스크 암호화·잠금·MFA 여부 미확인 |
| ② Vercel 계정 탈취 | 계정 비밀번호·세션 | 코드 배포 권한 → 모든 비밀값을 읽는 코드 배포 가능 → DB·Storage·세션 위조 | 비밀값 Hidden | MFA 미확인 |
| ③ Supabase 계정 탈취 | 계정 | DB·Storage 전체, 백업 다운로드 | - | MFA 미확인 |
| ④ `AUTH_SECRET` 유출 | 서버 환경 유출 | **임의 사용자·관리자 세션 위조** → 관리자 화면(회원 이메일 목록, 신고, 채팅 열람은 신고 건 필요) | Hidden | 세션 위조 탐지 없음(P-5) |
| ⑤ 관리자 Google 계정 탈취 | 피싱 | 관리자 권한 그대로(④와 같은 범위) | 관리자 대상 조치 2인 승인, 실명 열람 기록 | 2단계 인증 강제 없음 |
| ⑥ 앱 취약점 | - | 이번 감사에서 대량 조회 IDOR·SQLi 없음. A-1은 게시글 단위 | 2절 | - |

## 5. DB 전체 침해 시 피해 제한 수준

| 유출된 비밀 | 가능해지는 것 | 제한 요소 |
|---|---|---|
| `DATABASE_URL`/`DIRECT_URL`(`postgres`) | 앱 데이터 전부 읽기·쓰기·삭제(public 스키마 소유) | superuser 아님, `supabase_admin` 객체 변경 불가. 비밀번호 교체로 차단 가능 |
| `SUPABASE_SERVICE_ROLE_KEY` | Storage 전체(비공개 채팅 사진·신고 증거 포함), Auth 관리 API | Data API OFF라 REST로 테이블 접근 불가 |
| `AUTH_SECRET` | 모든 사용자·관리자 사칭 | 교체하면 전원 로그아웃 |
| `MJU_REALTIME_PRIVATE_JWK` | Realtime 토큰 서명 | 수신 정책이 DB grant 행도 요구해 단독으로는 수신 불가 |
| `CRON_SECRET` | 임베딩·보존 작업 호출 | 작업 자체가 제한·멱등 |
| `WITHDRAWN_IDENTITY_SECRET` | 탈퇴 회원 식별 해시 대조 | - |
| `GOOGLE_CLIENT_SECRET` | 앱 명의 OAuth 사칭(피싱) | 리디렉트 URI는 Google 콘솔 등록값만 허용 |

- 저장 데이터 중 가장 민감한 것: 실명·학과(동의 회원), 이메일, 채팅 원문·사진, 신고 증거. DB 수준 암호화는 없다(Supabase 저장 암호화만 있음).
- 교체 절차: Supabase DB 비밀번호 → Vercel env(`DATABASE_URL`, `DIRECT_URL`)와 `.env.operations-production` 갱신 → 재배포 → 백업 worktree 확인. service_role은 Supabase에서 키 재발급(JWT secret 교체는 anon 키도 바뀌어 재빌드 필요). `AUTH_SECRET` 교체 = 전원 재로그인. **실제 교체는 별도 승인.**

## 6. 서비스 마비·비용 폭증 위험

| 위험 | 가능성 | 영향 | 현재 대응 | 개선 |
|---|---|---|---|---|
| 익명 AI 검색 대량 호출(A-4) | 중 | Vercel 사용량 소진 → 제한·정지 가능 | IP별 10/분·100/일 | IPv6 /64 묶기, 전체 상한 |
| 익명 조회 폭주(A-5) | 중 | DB·연결 고갈 → 전면 장애 | 없음 | Firewall, 캐시 |
| Storage 고갈(A-3) | 중(내부자) | 업로드 전면 실패 | 회원 업로드 30/10분·200/일 | D-5 정리, 미첨부 상한 |
| 이미지 변환 한도(5,000/월, 11월 초 초과 경험) | 중 | 사진 최적화 중단(원본 표시로 대체되는지 확인 필요) | 폭 4종 제한, 31일 TTL | 사용량 모니터링 |
| Realtime 동시 연결 소진 | 하 | 실시간 대신 polling(기능 유지) | polling fallback, 15초 제한 | - |
| Supabase Auth 가입 남용(A-2) | 하 | `auth.users` 증가 | 메일 발송 제한(Supabase 기본) | 가입 끄기 |
| 임베딩 작업 폭주 | 하 | CPU | 사용자·게시글별 예산, 작업 큐 임대, 런타임 중지 플래그 | - |

- 기능별 긴급 차단 수단(있음): 이미지 임베딩 런타임 중지(`ImageEmbeddingRuntime.enabled`), Realtime private↔polling 전환(`release-d3.mjs`), 테스트 모드 끄기, Vercel 즉시 롤백.
- **없음**: 회원가입·글쓰기·업로드·AI 검색·채팅 송신을 개별로 끄는 스위치, 사이트 전체 점검 모드. 제안: `AppSettings`에 기능 플래그(관리자 화면에서 전환), 점검 모드 페이지.

## 7. 백업·사고 대응

- **RPO(데이터 손실 허용)**: 일일 로컬 백업이지만 PC 상태에 좌우된다. 최근 간격은 최대 약 42시간이었다(11-18 10:15 → 11-20 04:01). WakeToRun은 **AC 전원일 때만** 효과가 있다(11-21 22:16에는 배터리 상태 확인). 실효 RPO는 24~48시간이다. Supabase 관리형 백업·PITR 여부는 미확인(3-3). 오프사이트 설계: [backup-offsite-design-2026-11-21.md](backup-offsite-design-2026-11-21.md).
- **RTO(복구 시간)**: 복원 검증은 WSL에서 수십 초(25MB). 실제 복구는 새 Supabase 프로젝트 또는 기존 DB 복원 → 비밀값 교체 → 재배포까지 **추정 1~3시간**(훈련 기록 없음). 제안: 반기 1회 복구 훈련으로 실측.
- **DB 파괴·변조 시**: 최근 검증 백업으로 복원 → 이후 변경은 손실(RPO만큼). 변조 탐지 수단이 없다(제안: 일일 백업 행 수·해시 추이 비교 알림).
- **보안 로그**
  - Vercel 런타임 로그는 Hobby에서 짧게 보존된다(CLI로 약 50행씩 조회, 보존 기간 확인 필요).
  - DB 감사 기록은 오래 남는다: `IdentityAccessLog`, 관리자 활동, 관리자 조치 제안·승인, 제재.
  - 거부 로그도 있다: `cross-origin request refused`, `csp-violation`.
  - **이상 징후 자동 탐지·알림은 없다.**
- **사고 대응 절차(초안)**
  1. 탐지·보존: 로그와 DB 감사 기록을 즉시 내보낸다.
  2. 차단: 의심 계정 정지(관리자), 필요하면 `AUTH_SECRET` 교체(전원 로그아웃), DB 비밀번호·service_role 교체, Vercel 롤백·Firewall.
  3. 범위 확인: 감사 기록과 백업 대조.
  4. 통지·신고 판단(아래)
  5. 복구·재발 방지
- **개인정보 유출 시 법적 의무(법률 검토 필요)**
  - 개인정보 보호법상 유출을 알게 되면 원칙적으로 **72시간 이내 정보주체 통지** 의무가 있다.
  - 일정 기준(예: 1천 명 이상, 민감정보·고유식별정보, 외부의 불법 접근에 의한 유출)에 해당하면 **개인정보보호위원회 또는 KISA 신고** 의무가 있다.
  - 실명·학과·이메일·채팅 원문이 대상이다. 정확한 기준과 서식은 공식 안내로 확인하고, 신고 연락 체계를 미리 정한다.

## 8. 우선 수정 항목

| 순위 | 항목 | 이유 | 배포·승인 |
|---|---|---|---|
| 1 | A-1 댓글 노출 수정 **Production 배포** | 유일한 실제 데이터 노출. Preview 검증 완료 | Production 배포 승인 필요 |
| 2 | A-2 Supabase Auth 가입 끄기 | 쓰지 않는 공격면, 설정 2개 | 사용자 대시보드 작업 |
| 3 | 계정 2단계 인증 점검(Vercel·Supabase·GitHub·관리자 Google), 브랜치 보호(P-8) | 대량 유출 경로 ②③⑤ | 사용자 작업 |
| 4 | A-4 익명 AI 검색 IPv6 /64 묶기 + 서비스 전체 상한 | 비용·마비 | 코드, Production 승인 |
| 5 | A-3 D-5 미첨부 업로드 정리 + 사용자별 상한 | Storage 고갈 | 코드(+보존 정책), Production 승인 |
| 6 | P-5 세션 버전·수명 단축 | 탈취 쿠키 무효화 | 코드 + **DB 마이그레이션**(컬럼 추가), 인증 변경 승인 |
| 7 | A-5 Firewall·캐시 설계 | 조회 폭주 | Vercel 설정 확인 후 |
| 8 | 기능별 긴급 스위치 | 장애 시 부분 차단 | 코드 + DB |
| 9 | P-6·P-7·P-10 정리, Prisma 갱신 | Low | 다음 정기 배포 |

## 9. 추가 배포가 필요한 변경

- **준비 완료**: `fix/audit-hidden-post-comments`(`0293e03`, A-1). `vercel` 계보의 현재 Production `8a67cdd` 위에 커밋 1개. DB 변경 없음. 배포 명령: `deploy.mjs production --csp-mode=report-only`.
- 설계·구현 필요: A-3, A-4, A-5, P-5, 긴급 스위치(각각 별도 승인).

## 10. 정기 점검·모니터링 계획

| 주기 | 내용 | 도구 |
|---|---|---|
| 매일(자동) | 백업 성공·복원 검증, watchdog 26시간 | 기존 예약 작업 |
| 매주 | CSP 집계(운영 위반), 거부 로그 추이, 5xx, `RateLimitCounter` 상위 주체(익명 해시 포함), Storage 사용량 | `csp-metrics.mjs`, `vercel logs`, (추가) 사용량 조회 스크립트 |
| 매월 | `npm audit`(운영 의존성), Next.js·Auth.js 보안 공지, Vercel·Supabase 사용량 대비 한도, 관리자 권한 보유자 검토, 오프사이트 백업 복구 훈련(도입 후) | npm, 대시보드 |
| 분기 | 이번 감사 체크리스트 재실행: API·Server Action 게이트 인벤토리(자동화된 라우트 인벤토리 테스트 확장), 이력 비밀정보 스캔, 공개 설정 확인(Auth 가입, Storage 목록, Data API) | 이 문서 1~3절 명령 |
| 반기 | 사고 대응·복구 훈련(RTO 실측), 비밀값 교체 | 절차서 |
| 배포마다 | 헤더·프로브·CSRF·익명 브라우저 검사, CSP 모드 확인 | 기존 스크립트 |

## 부록: 이번 감사에서 추가·사용한 검증 스크립트
- `scripts/regression/hidden-post-comments.mjs` — A-1 재현·회귀(Preview 전용, 자체 데이터 생성·정리)
- 이력 비밀정보 스캔과 Supabase 공개 설정 확인은 1회성 명령으로 실행했다(값 미출력). 정기 점검 자동화 대상이다.
