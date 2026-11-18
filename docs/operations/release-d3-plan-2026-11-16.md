# D-3 Realtime 인증·비공개 채널 상세 계획

> 이 문서는 최초 분석 시점의 설계 기록이다. 이후 D-3 구현·추가형 Preview migration·사용자 등록 Standby 검증을 진행했으며 최신 실행 상태/배포/남은 게이트는 [2026-11-18 보고](release-d3-standby-2026-11-18.md)를 우선한다. Production은 D-2를 유지한다.

분석·설계만 수행했다. D-3 앱 코드·키·DB 역할/권한/RLS·Realtime 프로젝트 설정은 변경하지 않았다. D-2 이후 별도 구현·Preview·Production 승인이 필요하다. DB 잔여 권한 정리, CSP, Storage 정리는 별도 릴리스다.

## 확인한 현재 구조와 문제

- Auth.js Google 로그인은 자체 JWT/JWE 세션 쿠키다. `getCurrentUser()`가 매 요청 DB 사용자·탈퇴·외부 계정 승인·관리자 권한을 다시 확인한다. Supabase Auth 사용자/세션과 연결돼 있지 않다.
- `browserClient.ts`는 anon 키의 공유 Supabase 클라이언트다. `useChatRoomRealtime.ts`와 `realtimeAdmin.ts`가 공개 `chat-room-{숫자}` Broadcast를 사용한다. 채팅 본문은 기존 API 참여자 검사로 보호하지만, 공개 구독과 이벤트 위조는 막지 않는다. 채널 이름 난독화로 해결하지 않는다.
- `ChatThread.tsx`는 message/reaction마다 메시지를 다시 GET하고 post_status마다 router.refresh한다. read payload는 서버 재검증 없이 상대 읽음 cursor의 최댓값으로 반영한다. 반복 이벤트는 API 호출과 잘못된 읽음 UI를 만들 수 있다.
- `markChatRoomRead()`는 같은 cursor를 다시 읽어도 upsert와 read broadcast를 한다. 메시지 GET의 읽음 부수 효과까지 포함해 이벤트 증폭을 줄여야 한다.
- 개인 방은 initiator/counterpart, 기관 방은 initiator + 현재 OrganizationMember의 LEADER/ADMIN이다. 관리자 전체에게 채팅 구독 권한을 주지 않는다. 기관 역할 해제·게시글 삭제 후 남는 방·외부 승인 취소도 기존 서비스 판정과 맞춰야 한다.

## 인증 연결 방식

권고는 기존 Google/Auth.js 로그인을 유지하고, 검증된 사용자에게 **Realtime 수신 전용 단기 토큰**을 발급하는 연결 계층이다. Auth.js 암호화 쿠키를 Supabase에 전달하거나 anon/service_role 키를 사용자의 토큰으로 주지 않는다. Supabase가 신뢰하는 서명 키·issuer가 먼저 마련돼야 한다. 단순 setAuth 호출만으로 Auth.js 인증과 호환된다고 판단하지 않는다.

| 방식 | 판단 |
| --- | --- |
| 프로젝트가 신뢰하는 별도 imported signing key로 서버가 짧은 JWT 발급 | 우선 Preview 검증 후보. 키 등록·별도 비밀 저장·Supabase 검증 호환성 확인과 명시적 승인이 필요 |
| Custom OIDC/외부 IdP 연동 | Supabase 지원 경로이나 Auth.js는 자동으로 OIDC issuer가 되지 않는다. 별도 issuer/JWKS·비용·운영 범위가 커서 현 구조의 기본안으로 확정하지 않음 |
| 서버 SSE/주기적 API 동기화 | 서명 신뢰 연결이 불가능할 때 대안. Vercel 연결 시간·비용·지연·기존 UX를 비교한 뒤 선택하며 공개 채널을 임시 보안 대안으로 남기지 않음 |

Supabase는 외부 JWT를 third-party auth 또는 imported signing key로 검증하는 방식을 문서화한다. 일반 third-party 연동은 비대칭 키/issuer가 필요하며, 서비스 키는 사용자별 토큰 발급용 서명 키가 아니다. [JWT 지원](https://supabase.com/docs/guides/auth/jwts), [서명 키](https://supabase.com/docs/guides/auth/signing-keys), [Third-party auth](https://supabase.com/docs/guides/auth/third-party/overview).

초기 토큰 수명은 120초, 만료 30초 전 갱신을 제안한다. 토큰에는 최소 식별자·iss/aud/iat/exp/jti·Realtime 전용 role만 담고 이메일·이름·학과·채팅 본문은 담지 않는다. 앱 사용자 ID는 정수이므로 UUID를 전제하는 auth.uid()에 그대로 넣지 않는다. 전용 claim을 엄격하게 검증해 사용한다. 토큰은 메모리에만 두고 응답은 private,no-store, 로그·URL·localStorage에 남기지 않는다.

발급 API는 `getCurrentUser()`의 현재 접근 판정과 동일 출처·요청 제한을 적용한다. 탈퇴/외부 승인 회수는 갱신을 차단한다. 정지 계정의 읽기는 기존 API 정책을 그대로 따르고 쓰기 차단과 구분한다. 갱신 실패·만료 시 private 구독을 닫고 재인증하며 공개 fallback은 사용하지 않는다. `realtime.setAuth`는 설치된 SDK의 실제 동작을 검사하고 공유 Storage 클라이언트의 인증 헤더를 변경하지 않는다. [SDK setAuth](https://supabase.com/docs/reference/javascript/setauth).

## DB·Realtime 접근 제어

1. 신규 Realtime 수신 전용 NOLOGIN 역할을 검토한다. 기존 authenticated 역할의 잔여 권한을 그대로 가진 토큰 발급은 피한다. 새 역할을 Realtime이 실제로 전환할 수 있는지 Preview에서 확인하고 필요한 최소 USAGE/SELECT만 설계한다.
   NOINHERIT 역할도 PUBLIC에 부여한 권한은 적용받는다. 따라서 역할 이름만으로 Realtime 전용이라고 판단하지 않고 PUBLIC/함수 EXECUTE를 포함한 유효 권한과 Storage 등 다른 API에서 토큰의 권한을 읽기 전용으로 조사한다. 기존 권한 변경이 필요하면 잔여 DB 권한 정리의 별도 승인 범위와 조율하고 임의 REVOKE하지 않는다. [PostgreSQL GRANT](https://www.postgresql.org/docs/current/sql-grant.html).
2. `realtime.messages` SELECT 정책은 정확한 topic 파싱·Broadcast extension·현재 참여자 판정으로 제한한다. 참가자 표를 직접 광범위하게 노출하지 않는다. 필요하면 고정 search_path·제한된 EXECUTE의 SECURITY DEFINER membership 함수로 기관 역할을 확인한다. anonymous/다른 사용자/기관 일반 MEMBER/권한 해제자를 거부한다.
3. 클라이언트의 INSERT/Broadcast 송신과 Presence 쓰기는 허용하지 않는다. 실제 메시지·반응·읽음 변경은 기존 인증 API/Server Action에서 저장하고 서버만 private Broadcast한다. 서버 `httpSend`와 브라우저 `private:true` 양쪽이 일치해야 한다.
4. 새/기존 topic이 공개로 다시 구독되거나 forged public 이벤트가 private 구독에 도착하지 않는지 검사한다. 전체 전환 후 프로젝트의 Allow public access를 OFF로 바꾸는 것을 계획하되, 기존 클라이언트가 끊기는 영향과 타 Realtime 용도를 먼저 조사한다. 이 설정 변경도 D-3 승인 범위에 명시한다.

Realtime 정책은 매 이벤트마다 DB를 확인하는 방식이 아니며 연결/새 토큰 시 재검증한다. 권한 회수 후 남는 최대 수신 시간을 토큰 TTL로 제한하고 실제 만료·재연결을 테스트한다. 즉시 철회를 주장하지 않는다. [Realtime Authorization](https://supabase.com/docs/guides/realtime/authorization), [설정](https://supabase.com/docs/guides/realtime/settings), [private/public Broadcast](https://supabase.com/docs/guides/realtime/broadcast).

## 읽음 상태와 이벤트 증폭

- 이벤트는 동기화 힌트로만 쓴다. 읽음 값은 참여자 검사를 통과한 서버 상태 조회로 확인한 뒤 UI에 반영한다. sender/user/cursor를 임의 payload만으로 확정하지 않는다.
- 메시지·반응·읽음·게시글 상태 갱신을 방 단위 single-flight로 합친다. 진행 중 이벤트는 dirty 표시 하나로 모으고 완료 뒤 한 번만 더 조회한다. 연속 burst는 초기 250~500ms 범위로 합치되 정상 메시지 지연을 측정해 조정한다. 반복 실패는 backoff, 화면 비활성 상태는 제한된 재연결 후 복구한다.
- 서버 cursor 갱신은 실제로 전진한 경우에만 쓰기·Broadcast한다. 더 작은 ID로 되돌리지 않는다. 상태 조회 API가 다시 read 이벤트를 무조건 생성하지 않도록 읽음 부수 효과를 분리하거나 조건부 갱신한다.
- 방 전환·언마운트·로그아웃의 subscription/요청/timer를 정리하고 느린 이전 방 응답이 새 방 상태를 덮어쓰지 못하도록 generation/AbortController를 사용한다.

## 수정 대상

| 파일/영역 | 예정 변경 |
| --- | --- |
| `src/lib/auth/session.ts` | 기존 판정 재사용. Auth.js 로그인·쿠키 형식 유지 |
| 신규 `src/lib/chat/realtimeToken.ts` 및 토큰 API | 단기 수신 토큰·same-origin·fail-closed 발급 제한 |
| `src/lib/supabase/browserClient.ts` | Realtime 전용 토큰 연결 수명, Storage 업로드 인증과의 간섭 방지 |
| `src/components/chat/useChatRoomRealtime.ts` | private 구독·토큰 갱신·재연결·cleanup |
| `src/components/chat/ChatThread.tsx` | 서버 상태 동기화·읽음 검증·single-flight/burst 합치기 |
| `src/lib/chat/realtimeAdmin.ts` | private 서버 Broadcast, 실패/재연결 관측 |
| `src/lib/chat/service.ts`, 채팅 API/Action | 참여자 판정 공유·단조 read cursor·실제 변경 때만 이벤트 |
| `prisma/migrations/<D3>` | 최소 전용 role/함수/Realtime SELECT 정책. 기존 사용자 테이블의 잔여 권한 정리는 제외 |
| `scripts/regression/preview.mjs`, 새 Realtime 보안 검사 | private 참여자·위조/반복·만료·기관 역할·기존 16단계 |
| 운영/롤백 문서 | 키/역할 설정·백업/복원·전환·관측 기준 |

## 필수 검사와 배포 게이트

- Auth.js 로그인 유지, 익명·다른 회원·기관 MEMBER 구독 거부, 현재 기관 LEADER/ADMIN 수신 허용, 역할 해제/외부 승인 회수/탈퇴 후 만료·갱신 거부. 정지 계정은 기존 읽기 정책과 일치.
- 유효/만료/위조·잘못된 issuer/audience/role 토큰, 다른 topic, 클라이언트 broadcast/Presence/REST 송신 우회, 공개 topic 재사용 거부. 공격 시나리오는 Preview 독립 데이터로만 수행한다.
- 실제 메시지·반응·읽음·상태의 브라우저 2개 수신, 토큰 만료·탭 복귀·네트워크 단절·여러 방·로그아웃, Storage 서명 업로드와의 호환성.
- 100개 반복 이벤트에서 HTTP 호출 수의 상한·최종 상태 일치를 검사하고 read→GET→read loop가 없음을 검증한다. join/refresh 때 RLS DB 조회 수·토큰 API 비용·정상 메시지 지연을 비교한다.
- 전체 단위·타입·린트·빌드·기존 16단계, 실제 Preview 브라우저, 새 역할/정책/함수의 백업·복원 검증. Data API는 OFF를 유지한다.
- 안전한 전환: 먼저 private 경로와 브라우저 재연결/서버 조회 fallback을 Preview에서 검증하고 공개 채널을 닫는 순간의 기존 탭 동작을 리허설한다. Production에서 public/private 이중 송신을 보안 완료 상태로 취급하지 않는다.
  현재 구형 hook에는 PrivateOnly 거부 후 자동 조회 fallback이 없으므로 오래 열린 기존 탭의 무중단 호환을 보장할 수 없다. 호환 클라이언트를 먼저 배포하고, 작성 중 내용 보존·재접속/업데이트 안내·전환 시 새로고침 필요성을 검증한 뒤 공개 접근을 닫는 시점을 정한다. 보안을 이유로 확인 없이 임시 공개 fallback을 추가하지 않는다.
- 롤백: private 지원 직전 호환 앱을 확보한다. 문제가 생겨도 공개 접근·클라이언트 송신 권한을 다시 여는 방식으로 복구하지 않는다. 안전한 서버 상태 조회 fallback으로 수신 기능을 유지하며 토큰·메시지·신고 증거를 삭제하지 않는다.

다음 구현 승인을 받을 때 키 등록·환경 비밀 추가·Realtime 전용 역할/정책·Allow public access OFF·안전한 호환 배포를 구체적인 변경 목록으로 함께 검토해야 한다. 현재는 이 설정들을 실행하거나 새로운 유료 서비스를 도입하지 않았다.
