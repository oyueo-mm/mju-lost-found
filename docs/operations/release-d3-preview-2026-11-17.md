# D-3 구현·Preview 진행 보고 — 2026-11-16~17 KST

## 결론과 배포 상태

**D-3는 아직 완료되지 않았다. Production은 D-2를 유지한다.** 구현·추가형 Preview migration·로컬/일부 실제 제공자 검증·일반 Push·Preview 배포를 진행했다. 정상 회원의 신규 서명키를 통한 private Realtime 검증과 필수 전환 게이트가 남아 있어 Production migration/배포/public OFF를 실행하지 않았다.

| 항목 | 확인 결과 |
| --- | --- |
| 시작 HEAD | `873247dcda297388dcf96c8ccc804b59ce5e90c8`, 당시 작업 트리 clean |
| Production 유지 | `8baa381605638ff7bde97446732083f47589c3b3` / `dpl_HTtxjZJDDgka3HjTkRH6ZKQzR7EX`, READY·실제 version 일치 |
| 새 Preview | `2857257cf24708be077ff462d3da1b6f53791f82` / `dpl_GxxGV28xc3GYkBshQMZGZmifB5PN`, READY |
| Preview URL | https://mju-lost-found-preview.vercel.app/ → https://mju-lost-found-vercel-7qhjpcwa2-oyueo.vercel.app/ |
| 작업 브랜치 | `fix/release-d3-private-realtime`, 일반 Push 완료. main 병합·강제 Push 없음 |
| 스키마·복구 커밋 | `dc0275f` |
| 앱·검증·전환 도구 | `498123e` |
| 발급 제한 순서 보완 | `2857257`, 제한을 권한/키/config 검사보다 먼저 적용하고 방 DTO 중복 조회 제거 |
| D-4 분석 문서 | `462150f` |
| 배포 실행기 scope 보완 | `1f028c6`, 서비스 코드 차이 없음 |
| 예약 백업 작업 트리 | `ops/backup`의 `89bec61`, 일반 Push 완료 |

백업 복구·A~D-2 변경·신고 증거·Auth.js/Google 인증·기존 Production 접근 가드를 유지했다. AGENTS/CLAUDE 정책은 이미 반영된 상태를 읽어 적용했으며 삭제/완화하지 않았다. Production·Preview Data API는 실제 HTTP 503으로 OFF를 재확인했다. 새 서명키·provider 신뢰·기존 세션 비밀·활성 키는 변경하지 않았다.

## 구현 내용과 파일

- `src/lib/chat/realtimeToken.ts`, `realtimeGrants.ts`, `realtimeSession.ts`, 신규 `/api/chat/[id]/realtime`: ES256 120초 수신 전용 JWT, 실제 Auth.js cookie exp 상한, room/user/session/project/issuer/audience/scope 고정, same-origin·fail-closed 발급 제한, 모든 응답 private/no-store.
- `src/lib/auth/auth.ts`, `src/types/next-auth.d.ts`: 서버가 선택한 안정적인 session UUID, 구형 cookie의 정상 session endpoint bootstrap, 클라이언트 session-update 주입 거부, 로그아웃 회수. Google provider·Auth.js JWT/JWE 방식은 유지한다. Auth.js가 기록하는 실패에 DB 민감 진단을 넘기지 않는다.
- `src/lib/supabase/realtimeBrowser.ts`: Storage 공유 클라이언트와 분리한 메모리 전용 transport. 공개 anon/publishable API 키만 생성 옵션에 넣고 private JWT는 발급 뒤 setAuth한다. private-only이며 public fallback이 없다.
- `src/lib/chat/realtimeAdmin.ts`: grant별 private topic, 서버-only 발행, eventId, 발행 직전 현재 세션/참여자/설정 확인. Config→Session→Grant의 잠금 순서를 사용하고 HTTP는 1.5초 제한·동시 4개씩 처리한다. 구독 시 정책 캐시만으로 철회가 즉각 반영된다고 가정하지 않는다.
- `src/lib/chat/service.ts`, messages API: 실제 최신 메시지를 기준으로 read cursor를 DB에서 원자적으로 전진시킨다. 동일/오래된 읽음은 쓰기·Broadcast를 생략한다. 기관 방의 현재 상대 참여자 cursor를 한 번에 조회한다. API에 readState/postStatus를 추가하되 기존 필드는 유지한다.
- `src/components/chat/synchronizer.ts`, `useChatRoomRealtime.ts`, `ChatThread.tsx`: 300ms 병합·single-flight·dirty 1회·nonce 중복 제거, 서버 확인 cursor만 UI에 반영, token 갱신 실패 시 소켓 종료, 숨김 중 정리·복귀 동기화. GET/POST 순서 역전의 메시지 중복과 편집 후 늦은 GET 덮어쓰기를 보완했다. 방/계정 변경은 keyed component와 AbortController로 격리한다.
- `scripts/operations/release-d3*.mjs`, `register-preview-realtime-key.mjs`, `scripts/regression/*`: checksum/DDL 범위 검증, 새 메타데이터만 변경하는 polling/private 전환, Preview-only standby 등록 준비, 재사용 가능한 보안/브라우저 검사. 실행 방법은 [회귀 검사 문서](../../scripts/regression/README.md)에 있다.
- `scripts/backup/*`, Prisma schema 및 D-3 migration 6개: 새 권한 메타데이터의 암호화 백업·실제 복원과 역할/정책/ACL 재구축. [복구 문서](realtime-backup-recovery.md) 참조.

## 인증·권한 구조와 DB 상태

사용자에게 service_role/Auth.js secret/서명 private key를 전달하지 않는다. 토큰의 별도 NOLOGIN/NOINHERIT/NOBYPASSRLS 역할 `mju_chat_realtime`에는 realtime schema USAGE, messages SELECT, 자체 receive 함수 EXECUTE만 부여한다. 앱·Storage 테이블의 유효 SELECT/INSERT/UPDATE/DELETE 권한은 **0**으로 조회했다. 관리자라도 현재 채팅 참여자가 아니면 일반 채팅 구독을 허용하지 않는다. 기존 신고 연계 관리자 열람/감사 경로는 유지한다.

Preview에는 `ChatRealtimeSession`, `ChatRealtimeGrant`, `ChatRealtimeConfig`와 자체 RLS/함수/권한 회수 트리거를 적용했다. 신규 세 테이블은 RLS ON, 클라이언트 정책 0개다. realtime.messages의 자체 SELECT 정책은 **검사 행 topic·요청 topic·서명 claim·현재 grant/session·현재 참여 권한**을 함께 제한한다. INSERT/Presence 권한은 없다. 사용자 탈퇴, 기관 담당자 역할 해제, 외부 승인 회수·이메일 변경, 테스트 모드 해제가 새 grant를 회수한다. 기존 DB 잔여 권한 정리와 섞지 않았다.

초기 예약 역할에 새 역할을 GRANT하려던 진단 DDL은 보호 장치로 거부돼 전체 rollback됐다. Prisma의 실패/rolled-back 이력을 보존하고, 예약 역할을 수정하지 않는 최소 grant/policy 경로로 다시 적용했다. 이후 SQL 검증에서 lowercase Prisma enum 라벨, 정책 행 topic 범위, 외부 승인 이메일 변경의 이전 계정 철회를 보완한 추가 migration을 적용했다. Production에는 6개 모두 **미적용**임을 승인 실행기의 읽기 전용 preflight로 확인했다.

Preview runtime은 **polling**, project/kid NULL, active grant 0이다. public 접근 설정도 아직 OFF로 전환하지 않았다. 이는 D-3 보안 완료 상태가 아니다.

## 검증 결과와 한계

| 검사 | 결과 |
| --- | --- |
| 전체 단위 | **268개 파일, 3,009/3,009** |
| 타입·빌드 | tsc 및 최신 로컬 Next build 통과, 실제 Vercel Preview build READY |
| 전체 린트 | `npm run lint` 통과. Git 관리 소스 검사도 오류·경고 0. `.vercel`의 Git-ignored 배포 번들/임시 브라우저 산출물만 정식 ignore에 추가했으며 소스·재사용 검사는 제외하지 않음 |
| 실제 로컬 SQL/RLS | **38개 assertion 통과**: 역할·채널 행·claim·기관/외부 계정·동시 철회·재승인 후 구 토큰·계정/세션 철회·권한 재구축 |
| 실제 Chromium | **10/10**: 독립 세션, 키 장애 503/대체 API, 송수신, 두 탭, 응답 순서 역전·편집, visibility 복귀/초안, network 복구, 비참여자, 세션 소멸 |
| Preview 실제 제공자 | **5/5**: 익명 private join 거부, 미신뢰 self-signed/embedded JWK 거부, 서버 관리자 대조군의 private 송수신, 익명 Batch 미수신, 새 REST private 발행 403 |
| 배포된 토큰 API | 올바른 실제 Origin의 익명 POST 401, private/no-store·Vary Cookie 확인 |
| Preview 비파괴 프로브 | **16/16**, 버전·로그인 경로·인증·사진·검색. 아래 기존 16단계 통합 회귀와 별개 |
| Preview 오류 로그 | 조회 시 최근 20분 error 0·5xx 0, 조회 한도 각각 200 |
| 업로드 검사 | 1,169개 파일 중 비밀/env/로컬 진단 등 금지 파일 0 |
| 기존 16단계 통합 회귀 | **D-3 최종 실행 미완료**. 11단계는 실제 회원 private JWT 수신을 요구하도록 강화했으며 키 미등록으로 아직 실행할 수 없음. D-2의 과거 16/16을 D-3 결과로 재사용하지 않음 |

구형 Batch REST가 202를 반환해 처음 작성한 HTTP 코드 기반 검사는 실패했다. [Supabase 실제 소스](https://github.com/supabase/realtime/blob/main/lib/realtime/tenants/batch_broadcast.ex)는 private 메시지를 버린 경우에도 성공 코드를 반환한다. 기준을 단순 완화하지 않고 정상 전달 대조군과 위조 nonce의 실제 미수신을 함께 검사하여 확인했다. 이 대조군은 Node 서버 전용 자격증명만 사용하며 브라우저에 전달하지 않는다. **새 일반 회원 역할의 정상 JWT 수용을 대신하지 않는다.**

최신 Chromium 검사는 현재 빌드+Preview DB를 사용한 로컬 격리 서버다. 로컬 전용 새 Auth.js 키를 사용했으며 배포/실제 사용자 인증 비밀을 사용하지 않았다. visibility는 headless에서 명시적 이벤트로 전환했다. OS 실제 background·장시간 private 연결·배포된 Google 로그인은 아직 미검증이다.

## 백업·복원·예약 환경

- Preview `preview-d3-2026-11-16-185037.tar.enc`: 암호화 왕복·117개 checksum 일치, **56개 테이블 행 수 불일치 0**, 게시글 사진 89개/채팅 사진 19개 참조 누락 0, 새 역할/정책/ACL 재구축 원본 일치. 이 snapshot의 신고 증거 참조는 0개다. 평문·복호화 임시본은 기존 절차로 정리했다.
- Production의 기존 정상 `release-d2-post-2026-11-16-070018.tar.enc`를 실제 격리 복원하고 D-3 6개 migration rehearsal 및 receive-only 권한 검사를 통과했다. 기존 원본·실패 이력·검증 표식은 보존했다. **새 Production 배포 직전 최신 백업은 아직 생성하지 않았다.** 배포 게이트 통과 후 별도로 해야 한다.
- `ops/backup@89bec61`에 복구 코드를 반영하고 그 실제 경로에서 위 Preview 암호화 파일의 재복원을 통과했다. ops에는 개발용 Vitest가 설치돼 있지 않아 그 경로의 단위 실행은 불가했지만, 일치하는 백업 소스의 루트 테스트와 실제 ops 복원을 완료했다. runtime 의존성/예약 계정/실행 경로는 바꾸지 않았다.
- 최근 정기 성공은 11월 16일 04:16 KST이며 당시 실패 시각 04:01 기록도 보존돼 있다. 백업·감시 Task LastResult는 각각 0이다. 다음 backup 11월 17일 04:00, watchdog 13:00, D-2 maintenance cron 02:00/기존 retention 03:00은 이 보고 시점에 아직 도래하지 않았다. 자연 실행 성공으로 임의 기록하지 않으며 Production cron을 수동으로 호출하지 않았다.
- Production 읽기 전용 health는 D-2 트리거 7개·새 작업 테이블 RLS·작업 실패 0·report-evidence private·Data API OFF·Realtime transport를 통과했다.

## 성능·제한 수치와 판단 근거

| 항목 | 수치/근거 |
| --- | --- |
| 수신 JWT | 120초, 실제 cookie exp 이내. 통상 만료 30초 전 갱신. 긴 연결의 권한 캐시를 제한하고 갱신 여유 확보 |
| 토큰 API | 일반 30/분·1,000/시간, staff 60/분·3,000/시간. 정상 visible 탭 약 40회/시간의 갱신에 충분한 여유. staff 정책 유지 |
| 메시지 동기화 API | 일반 240/분, staff 720/분. 조회 병합·정상 탭 수를 지원하면서 무한 재조회 제한 |
| topic 수 | 사용자/방별 활성 signed browser session 10개. 같은 세션의 여러 탭은 grant/topic 재사용, 클라이언트 임의 ID로 상한 우회 불가 |
| 조회/재연결 | 이벤트 300ms single-flight·dirty 1회·최근 eventId 128개. 정상 연결 safety poll 60초, 장애 10초→최대 30초, hidden 중 정리. transport reconnect 5초→최대 30초 |
| 서버 송신 | 현재 권한 grant별 발행, 동시 4개·개별 HTTP 1.5초. 방에 대한 1회 public 송신보다 권한 조회/발행 수가 늘어남. 다중 grant의 철회 lock 지연 실측은 남음 |

정상 visible 탭의 추가 요청은 대략 토큰 40회/시간+안전 조회 60회/시간이다. 여러 탭/네트워크/활동 이벤트에 따라 달라지는 **추정**이며 실제 Production 비용 측정값이 아니다. 현재 Preview의 키 미등록 상태는 10초 polling이므로 정상 private 지연/비용으로 비교하지 않는다. 최종 점검에서 키 미설정/polling/비참여자 경로가 요청 제한 전에 반환되는 문제를 보완했다. 유효 세션의 요청 제한을 먼저 적용하고 방 DTO 조회를 제거했으며 최소 권한 SQL을 발급 트랜잭션 안에서도 재검증한다. 검색 모델·768차원 벡터·검색 점수 코드는 변경하지 않았다.

Preview 검색 단일 프로브는 keyword 184ms, semantic 966ms, unified 183ms, image 879ms였다. cold/warm 통제 없는 단일 표본으로 성능 개선/악화를 단정하지 않는다. 함수 메타데이터는 D-2와 동일한 artifact 참조 7개/고유 경로 6개다. 채팅 token/messages의 로컬 모델 파일은 0이며 client chunk에 서명 변수 식별자가 없다. 모델 trace 격리는 유지됐다. Vercel API는 함수 압축 byte 크기를 제공하지 않아 정확한 byte/요금 차이는 미측정이다.

## 데이터 정리와 발견한 운영 문제

Preview 사용자 **393~410**과 채팅방 **164~169**는 이번 실행의 UUID/소유자/참여자를 기록한 신규 fixture다. 일부 초기 로컬 Origin 정규화 검사 실패 실행도 포함하며 실패를 통과로 숨기지 않았다. 관련 메시지·읽음·알림·카운터·신원·세션을 자기 데이터에 한해 정리했다. 최종 조회에서 해당 User/ChatRoom/Message/Notification/RealtimeSession 잔여 0을 확인했다. 기존 사용자·시드·운영 감사 기록·신고 증거·Storage 원본은 삭제하지 않았다. 이 회차에서 실제 Storage 테스트 사진이나 신고를 새로 만들지 않았다. 로컬 SQL의 1~5 사용자 ID는 별도 throwaway DB에만 존재했다.

기본 Vercel CLI scope로 배포가 `Not authorized`로 거부됐지만 로그인·프로젝트 읽기·기존 Git 작성자는 정상이었다. 연결된 팀을 명시한 재시도는 성공했다. `deploy.mjs`가 검증된 `.vercel/project.json`의 orgId를 항상 넘기도록 보완했고 팀 ID 형태의 읽기 전용 실행과 린트를 통과했다. 계정/권한/자격증명/보호 정책을 변경하지 않았다. 이 운영 도구 수정과 후속 보고는 Preview 서비스 코드와 차이가 없다.

## 남은 필수 게이트·재개 방법·롤백

1. **Preview 신규 키 추가 승인은 이미 받았다.** 다만 사용 가능한 Supabase 관리 연결/CLI 로그인이 없어 실제 등록을 수행하지 못했다. 관리 연결 안내를 보냈고 비밀값을 채팅으로 요청하지 않았다. [등록 도구/승인 경계](realtime-signing-registration.md)의 실제 관리 API 실행과 민감 변수 등록부터 계속한다. Production 신규 키 승인은 아직 없다.
2. Preview의 standby 서명키가 실제 Realtime에서 수용되는지, 전용 역할 전환과 현재 참여자의 정상 수신/다른 방·Storage/DB/관리자 접근 거부를 검증한다. 기존 활성 키 교체나 예약 역할 추가 grant가 필요하면 그 부분은 별도 승인 없이 진행하지 않는다.
3. 장시간 연결·토큰 만료/교차 환경·직접 회원 Broadcast 거부·권한 회수 후 실제 수신·다중 탭/OS background·부하/lock 비용·필수 16단계 전체를 마친다. DB 장애로 로그아웃 철회가 commit되지 못하는 경우의 남은 TTL 위험도 별도 검증한다.
4. D-2의 이미 열린 탭에는 새 private/polling 코드가 없다. 기존 탭을 강제 reload해 초안을 잃게 하거나 무중단 업그레이드를 임의로 통과시키지 않는다. 구/신 클라이언트 전환과 안전한 polling Production 롤백 대상을 확보하는 게이트가 남는다.
5. 모든 조건과 Production 키의 별도 승인을 충족한 후 최신 Production 백업·실제 복원·rehearsal→승인 실행기 migration→앱 배포→private 확인→public OFF→비파괴/로그 확인 순서로 이어간다. 지금은 Production을 변경하지 않는다.

현재 Production 롤백 대상은 기존 D-2 배포 그대로다. public OFF 이후에는 이를 무조건 재배포해 공개 통신을 복원하지 않는다. D-3 polling 호환 배포와 mode 전환을 먼저 확보하며 새 테이블·메시지·증거를 drop하지 않는다. 구체 명령과 실패 처리 한계는 [전환 절차](release-d3-transition.md)에 있다. [D-4 상세 계획](release-d4-plan-2026-11-16.md)은 작성했으며 구현하지 않았다.

## 대시보드 등록 준비와 후속 운영 확인

사용자가 관리 연동 대신 대시보드 직접 등록 절차를 선택했다. [수동 절차](realtime-dashboard-registration.md)와 Preview-only PowerShell 도구를 추가했다. 로컬 키의 공개 kid는 `c0eb51e4-97b9-4d13-b042-1a820650d257`이다. DPAPI 암호화·복호화·private/public 서명 쌍·기존 파일 재사용·구문·clipboard 제외 형식을 확인했다. 실제 clipboard에는 아직 키를 복사하지 않았다. 공개 JWKS에는 아직 이 키가 없으며 클라우드 설정·배포·기존 키는 변경하지 않았다. 단말의 수동 붙여넣기 이후 실제 등록 검증을 계속한다.

11월 17일 정기 백업은 최초 `ENOTFOUND` DNS 오류로 실패했고, 읽기 전용 재시도에서도 `pg_dump` 실패가 기록됐다. 두 번째 실패의 세부 원인은 기존 stderr 억제 로그만으로 확정할 수 없다. 현재 DNS/포트와 공유 snapshot 스키마 진단은 정상이며, 기존 `ops/backup@89bec61` 실행기를 통한 다음 재시도는 **`auto-2026-11-17.tar.enc` 24.7MB 암호화·141개 checksum·53개 테이블 행 수 불일치 0·이미지 참조 134개 누락 0·실제 복원**을 통과했다. 최신 성공은 23:38 KST, lastError는 NULL이며 lastFailureAt와 실패 로그는 보존했다. 정상 백업은 삭제하지 않았고 복구 재실행에서는 retention 삭제를 생략했다. 기존 예약 작업 자체도 당일 검증 파일을 재인식해 skip/종료 코드 0으로 확인했으며 원래 실패 실행 이력은 남겼다. 가드·standing 승인·백업/보존 코드는 변경하지 않았다.

정기 API의 집계 조회에는 11월 17일 03시 KST retention 경로 1회/오류 0과 이미지 작업 잔여 0이 있었다. D-2 maintenance는 기존 normalizeRoute의 허용 정규식 때문에 일반 `GET /api/posts`에 합산된다. 집계만으로 특정 cron의 실행 여부·호출자·결과를 단정하지 않으며 별도 provider 로그 확인을 미검증으로 남긴다. 확인을 위해 Production cron을 수동 호출하지 않았다.

## Standby 절차 재확인과 독립 동시성 보강

사용자는 Preview 신규 Standby 가져오기만 재확인했으며 기존 활성 키 교체·회전·폐기와 Production 설정 변경은 승인하지 않았다. 공식 Studio의 현재 메뉴 이름은 Project Settings → JWT Keys → JWT Signing Keys이고 생성 창의 ES256 (ECC) / Import an existing private key를 확인해 수동 문서를 보완했다. 준비한 같은 로컬 암호화 키를 재사용하며 추가 키를 생성하거나 실제 클립보드를 변경하지 않았다. Standby 키 수용 실패 시 인증 API polling을 유지하고 별도 신뢰 구조를 검토하며 기존 키를 임의 활성화·회전하지 않는다.

독립적으로 수행 가능한 로컬 SQL 검사를 38개에서 **44개 assertion**으로 추가했다. 발급 연결의 config 공유 잠금을 유지한 채 다른 연결의 polling 전환 UPDATE가 `pg_stat_activity`에서 실제 Lock 대기인지 확인하고, 그 대기 도중 새 세션/grant를 생성·commit했다. 전환이 이어서 commit되면 새 grant도 철회되고 수신이 차단되며 private 재활성화에도 되살아나지 않는 것을 통과했다. 에러 시 모든 연결 rollback 후 종료하도록 정리했다. 격리 PostgreSQL 실제 실행 44/44와 변경 스크립트 ESLint가 통과했다. 기존 assertion은 유지했다. 이번 추가는 테스트·문서만 변경했으므로 서비스 재배포·클라우드 DB/설정 변경은 하지 않았고 기존 전체 단위 3,009/3,009 결과와 구분한다. 실제 Standby 서명 토큰 수용과 최종 통합 회귀는 여전히 등록 후 검증 대상이다.
