# D-3 비공개 실시간 채팅 완성 — 원인 조사와 Preview 검증 (2026-11-19)

브랜치 `fix/d3-private-realtime-completion`. Production은 UI 릴리스 `dpl_HxSWo6BzrNfDTQDwg6NdMBMaYZKw`(`35168f0`)이며 채팅은 인증 API polling이다(문서 기준. 이번 작업에서 Production DB 읽기 전용 조회는 권한 정책상 실행하지 못했다).

## 1. canary에서 회원 연결이 관측되지 않은 원인

근거는 코드, 기존 운영 기록([D-3 준비 기록](release-d3-production-preparation-2026-11-18.md)), 이번 Preview 재현이다. 2026-11-19 13:47 당시의 Vercel 로그는 Hobby 보관 기간(1시간)이 지나 남아 있지 않아 요청 단위로 확정하지는 못했다.

- **연결 시도 자체가 없었던 경로가 코드로 확인된다.** `cd123bf` 이후 토큰 API가 의도된 polling을 HTTP 204로 알리면 클라이언트가 `retryAt=Infinity`로 두어, 그 탭은 화면 숨김→표시나 오프라인→온라인 전까지 **토큰을 다시 요청하지 않았다**. 모드가 polling일 때 열린 방 탭은 이후 `private`로 바꾸거나 canary를 켜도 새 grant를 만들 수 없다. 13:47 canary 관찰 10회 동안 활성 grant 0개, 복구 후 51번 방 토큰 경로 204 1건이라는 기록과 일치한다.
- **연결 실패가 원인이라는 증거는 없다.** 2026-11-18 20:44 기록에서 Production 실제 회원 브라우저의 토큰 HTTP 200과 비공개 가입 성공을 이미 확인했다. 서버 대조군 수신, 익명 비공개 가입 거부, 공개 가입 `PrivateOnly`도 확인됐다.
- **반복 실패의 운영상 원인**: 검증이 "실제 회원이 그 시간에 51번 방을 열어 둘 것"에 의존했고, 브라우저 수신은 수동 DevTools 확인에 기대었다. 통제 가능한 2인 테스트 조건이 없었다.
- feature flag 조건: `MJU_REALTIME_CANARY_ROOM_ID`(배포 환경변수)가 있으면 그 방만 토큰을 받고 나머지 방은 204다. 실제 발급은 DB의 `ChatRealtimeConfig.mode='private'`와 서명키 `kid`·프로젝트가 일치해야 한다. 토픽은 grant별 `mju-chat:<grantId>`로 서버 발송 토픽과 같은 함수(`realtimeTopic`)에서 만든다.

## 2. 수정 (`0bfe9a0`)

| 항목 | 내용 |
|---|---|
| polling 탭 재확인 | 토큰 API 204에 `Retry-After: 120`. 클라이언트가 30초~10분 범위에서 따른다(기존 무기한 정지 제거). 열린 탭은 약 2분 안에 새로고침 없이 private에 가입한다. polling 중 추가 비용은 전면 탭당 시간당 토큰 POST 약 30회다(메시지 GET은 기존과 같이 약 10초 주기). |
| PC 채팅 목록 | lg 이상에서 상대 메시지가 새로 동기화되면 옆 목록(서버 컴포넌트)을 최대 10초에 한 번 갱신한다. 휴대폰은 목록이 별도 화면이라 이동 시 갱신된다. |
| `deploy.mjs --dry-run` | 이전에는 recorder에만 전달되어 **실제 배포**를 했다. 이제 Vercel·DB 호출 없이 계획만 출력한다. 이력 쓰기 생략은 `--record-dry-run`이다. 알 수 없는 옵션은 거부한다. 실행으로 확인했다. |
| CSP 호환성 | 현재 CSP는 없다(D-4 기본 헤더 4종만 Preview에 적용). 향후 CSP 또는 Report-Only에 `connect-src`로 `wss://<project>.supabase.co`·`https://<project>.supabase.co`가 없으면 실패하는 가드 테스트 `src/lib/security/cspRealtime.test.ts`를 추가했다. |

서버 DB와 인증 메시지 API가 원본이다. 브로드캐스트는 내용 없는 힌트(eventId·messageId)이며, 수신하면 인증된 GET으로 다시 가져온다. 권한 변경·세션 소멸 시 polling은 같은 인증 API를 쓰므로 우회할 수 없다(401/403/404면 화면을 비우고 중단한다).

## 3. Preview 검증

- 단위 271파일 3,021개, 타입 검사, eslint 통과.
- 로컬 빌드 + Preview DB/호스팅 Preview Realtime(공개 접근 OFF, private 모드):
  - `--two-member` 9/9: 열린 polling 탭의 새로고침 없는 private 전환(129.8초), A→B 3.84초·B→A 3.78초, 중복 없음, 읽음 반영, 연결 중 25초간 메시지 GET 0회, 앱 내 이동 시 소켓 종료·재진입 재구독, 오프라인 복구 후 누락분 1.4초, PC 목록 반영, 비참여자 차단.
  - `--private` 12/12(재실행): 125초 이후 실제 토큰 갱신 수신, 다중 탭, 재연결, 장애 안내·자동 복귀, 비참여자 거부, 인증 소멸 시 화면 정리. 첫 실행 1회는 실패했고 출력이 잘려 원인을 특정하지 못했다. 재실행에서 재현되지 않았다.
  - 기본 fallback 11/11(서명키 부재 fail-closed, polling 유지), `realtime-private.mjs --expect-public-off` 47/47(변조·만료·타 환경 claims·권한 회수 거부, 공개 가입 PrivateOnly), `realtime-denials.mjs` 5/5(익명·미신뢰 키 가입 거부, 익명 발행 미수신).
  - 생성한 테스트 회원 572–592와 방 240–248은 모두 정리됐다(`cleanupOk: true`).
- 호스팅 Preview `dpl_BMcQvpkRinbgMMejEBDZ7nTkp3Hw`(`0bfe9a0`, 고정 URL) 프로브 16/16.

## 4. Production 단계(미실행 — 사용자 결정 필요)

1. 읽기 전용 상태 확인(`release-d3.mjs status`): 이번 세션에서 권한 정책으로 거부됐다.
2. 제한 canary: `deploy.mjs production --realtime-canary-room=<시험 방>`으로 배포하고, 승인 실행기로 `release-d3.mjs private --kid <Production kid> --apply --confirm-production`.
3. 증거 수집(DevTools 불필요): 승인 실행기 `realtime-member-check.mjs inspect/send`로 두 참여자의 grant와 갱신을 확인하고, 비저장 수신 확인 이벤트를 보낸다. 브라우저가 자동으로 보내는 수신 확인의 SHA-256 다이제스트를 Production 로그에서 대조한다. 메시지 POST 직후 상대 탭의 인증 GET 시각(60초 안전 조회와 구분)도 로그로 확인한다.
4. fallback 확인: `release-d3.mjs polling --apply`로 두 탭이 polling으로 내려가고, `private` 재적용 후 2분 안에 새로고침 없이 복귀하는지 확인한다.
5. 전체 전환: canary 환경변수 없이 같은 커밋을 재배포한다. 즉시 복귀 수단은 `release-d3.mjs polling --apply`(배포 불필요)이고, 앱 롤백 대상은 직전 Production이다.
