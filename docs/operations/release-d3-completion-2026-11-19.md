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

## 5. Production 52번 방 canary (2026-11-19)

사용자가 본인 계정 2개로 만든 시험방 52번에서만 진행했다. 51번 방과 다른 방은 canary 밖이라 계속 polling이었다. 메시지 원문·사용자 ID·토큰은 기록하지 않았다.

- 배포: `dpl_2c2dVUwxKU6kGVq3E1Hpe1zxaZqN` (`b37e8be`, `--realtime-canary-room=52`). 프로브 16/16. 사전 `--dry-run`이 아무것도 배포하지 않는 것을 확인한 뒤 실제 배포했다.
- 17:25:39 KST `private` 전환. 열려 있던 탭은 배포 전 코드여서 사용자가 한 번 새로고침했다.
- **통과**
  - 두 참여자 grant 각 1개 발급(17:26:49, 17:27:04). 120초 수명을 넘겨 연장됨(갱신). 17:34:01 두 탭 갱신 토큰 200.
  - 비저장 확인 이벤트를 각 grant 토픽에 보냄(17:34:13). **두 브라우저 모두 자동 수신 확인**, 로그 다이제스트 일치.
  - 17:33:20 B→A 저장(201) 후 1초 안에 양쪽 탭이 인증 API로 동기화. 사용자가 양방향 즉시 표시 확인. DB 메시지 2건.
  - 숨김→복귀 시 grant 재활성화.
  - 비참여자·익명: 표본 비참여자 7/7 거부(`realtime-access-control.mjs`), 익명 비공개 가입 `authorization_denied`, 익명 공개 가입 `private_only`, 서버 대조군 수신(`realtime-transport-control.mjs`). 비로그인 토큰 401, 메시지 401, 다른 출처 토큰 403.
- **미검증: polling 강제 → 자동 복귀**
  - 18:36:24 polling(활성 grant 즉시 0), 18:40:26 private 재전환. 3분 30초 동안 새 grant 0개.
  - 로그(10분 창 46행, 잘림 없음)상 52번 방의 마지막 요청은 18:35:43이다. polling 전환 이전에 와야 할 18:36:43의 60초 안전 조회부터 없고, 18:38 이후에는 배포 전체 요청이 0건이었다. 앱은 어떤 상태에서도 10~60초마다 요청하므로, 두 탭이 숨김 상태(창이 가려짐·최소화·잠금)였다고 판단한다. 같은 현상이 17:35~17:40에도 있었다. 기능 실패의 증거는 아니지만 Production에서 복귀를 관측하지 못했다. 같은 동작은 Preview E2E에서 129.8초로 통과했다.
  - 지시에 따라 18:44:51 polling으로 복구했다. 모드 polling, 활성 grant 0, 대기 마이그레이션 0, 프로브 16/16, 최근 20분 error·5xx 0.
- 현재 Production: `dpl_2c2dVUwxKU6kGVq3E1Hpe1zxaZqN` + DB polling → 전 방 polling. 새 클라이언트는 polling 탭마다 120초에 한 번 토큰 API를 재확인한다(204). 앱 롤백 대상은 `dpl_HxSWo6BzrNfDTQDwg6NdMBMaYZKw`(`35168f0`).
- 도구 보완: `realtime-member-check.mjs send`가 1:1 방의 grant 2개에 각각 확인 이벤트를 보낸다. `realtime-receipt-logs.mjs`는 수신 확인 다이제스트를 건수로만 대조한다. `vercel logs` 조회는 약 50행 제한과 수 분의 반영 지연이 있어 짧은 창으로 반복 조회해야 한다.
- 시험 데이터: 52번 방(사용자 생성 글 1개, 방 1개, 메시지 2개). 정리 방법은 별도 승인 후 결정한다.

## 6. 재검증 준비 (2026-11-19 19:35 KST)

- 진단 보강(`96e8a73`): canary 방 탭만 고정 단어(`subscribed`, `polling-mode|token|transport|error`, `hidden-*`, `visible-*`)를 기존 토큰 경로로 보고한다. 서버는 해당 방 참여자일 때만 세션 다이제스트 8자리와 함께 기록한다(메시지·사용자 ID 없음). 요청 0건이 "숨김"인지 "실패"인지 로그로 구분된다. `realtime-diag-logs.mjs`로 조회한다.
- Production 브라우저 자동 E2E는 Production 로그인 세션(Production 인증 비밀 또는 실제 계정)이 필요해 수행하지 않았다. 같은 시나리오를 Preview에서 자동 재현했다. `--two-member` 12/12: canary 방, DB 모드 private→polling→private(`release-d3.mjs`), 양쪽 polling 전환 82.6초, polling 중 전달 10.8초, 새로고침 없는 private 복귀 108.8초, 복귀 후 1.52초, 진단 `subscribed→polling-mode→subscribed`.
- `realtime-canary-cycle.mjs`: 승인 실행기 아래에서 A 연결 대기 → B 확인 이벤트 → C polling(150초) → D private 복귀 대기(4분) → E 확인 이벤트 순서로 진행하고 항상 polling으로 끝낸다. Preview에서 실패 경로(즉시 polling 복구)를 확인했다.
- 배포: Preview `dpl_8QFiNCRzAc8mKTAuGDe2Vns1fH46`, Production `dpl_7wsj3uWVS3zXy3NayjJFTQMgtDMy`(둘 다 `8dd45c6`, Production canary=52, DB polling). 프로브 16/16. 브랜치 HEAD = Production 커밋이므로 전체 전환 시 누락되는 수정이 없다.

## 7. Production 재검증 결과 (2026-11-19, 52번 방)

### 19:45–19:50 일괄 사이클 (`realtime-canary-cycle.mjs`)
A 자동 연결(grant 2), B 두 브라우저 수신 확인 일치, C polling 150초간 발급 0·두 탭 `polling-mode`, D 복귀 24초·두 탭 `subscribed`, E 수신 확인 일치, 종료 polling. D 복귀 직전 두 탭에 `hidden-polling`(19:50:37)→`visible-polling`(19:50:43)이 기록됐다. 이 복귀는 **화면 복귀에 의한 자동 재연결**로 기록한다(사용자가 다른 작업을 병행했다).

### 20:10–20:17 타이머 복귀·메시지 정합성 (`realtime-canary-timer.mjs`, exit 0)
로그는 `--since/--until` 구간 조회(구간별 14~35행, 잘림 없음)로 대조했다.

| 확인 | 결과 | 근거 |
|---|---|---|
| 120초 타이머 복귀 | **통과** | 20:11:02 private 전환 후 두 탭이 20:12:58에 `subscribed`(약 116초). 그 사이 hidden/visible 진단이 없고, 두 탭 모두 10초 polling 조회를 끊김 없이 계속했다(화면 표시 상태). DB 새 grant 2개. |
| private 중 메시지 | **통과** | 20:13:09 POST 201 → 0.5초 뒤 상대 탭 GET. 20:13:22 POST 201 → 0.5초 뒤 GET. |
| 연결 중 polling 억제 | 통과 | 20:12:58~20:14:25 사이 조회는 60초 안전 조회(20:13:58)뿐이었다. |
| polling 강제 → fallback | 통과 | 20:13:25 polling. 20:14:25 두 탭 갱신 시 204와 `polling-mode` 이후 10초 주기 조회. 20:16:25 두 탭 120초 재확인 204. |
| polling 중 메시지 | 통과 | 20:16:55 POST 201 → 다음 10초 조회(20:17:05)에 두 탭 동기화. |
| 저장 정합성 | 통과 | DB 2 → 5(private 2 + polling 1). 로그의 POST 201 3건과 일치. |
| 종료 상태 | 통과 | 모드 polling, 활성 grant 0, 대기 마이그레이션 0. |

미확인: 기기 화면의 중복 표시 여부(Production 화면은 보지 않았다. Preview E2E에서 검증), 20:12:55 이후 두 번째 참여자의 토큰 200 로그 1건(로그에 없음. DB grant 2개와 두 참여자의 `subscribed` 진단으로 대체 확인).

현재 Production `dpl_7wsj3uWVS3zXy3NayjJFTQMgtDMy`(`8dd45c6`, canary=52) + DB polling이다. 전체 전환은 사용자 결정을 기다린다.

## 8. 전체 private 전환과 D-3 종료 (2026-11-19 20:32 ~ 11-20 04:09 KST)

- Function Storage 확인: 보존 배포 14개, 함수 번들 합산 약 8.96GB(배포당 약 0.64GB, 팀의 다른 프로젝트 배포 0개). 새 배포 1개 후 약 9.6GB / 10GB로 판단해 진행했다(Hobby는 대시보드 수치를 API로 읽을 수 없다).
- Production `dpl_AgwysDi1MrMCFVh1AaGccih1dn5C` (`931864c`, 앱 코드 = `8dd45c6`), canary 환경변수 없음, polling 상태에서 프로브 16/16, error·5xx 0.
- 사전 확인: 공개 Realtime `private_only`, 익명 비공개 가입 거부, Data API 503(OFF).
- 20:35:28 KST 전체 `private`(kid 일치, Realtime 역할 콘텐츠 권한 0). 직후 5분은 채팅 트래픽이 없었다.
- 최종 확인(11-20 04:05–04:09, 52번 방, 사용자 PC+휴대폰): 저장 후 0.45~0.55초 안에 상대 동기화, 비행기 모드 중 저장된 메시지를 재연결(토큰 200) 직후 동기화, 복구 후 60초 안전 조회만 남음(실시간 상태), DB 5→8. 최근 1시간 error·5xx·토큰 실패 0. 사용자 화면 확인 4개 항목(양방향 즉시 수신, 비행기 모드 후 동기화, PC 목록 미리보기) 모두 정상.
- **D-3 완료.** 운영 모드는 전체 private이고, polling fallback은 클라이언트에 유지된다. 즉시 복귀: `release-d3.mjs polling --apply`(배포 불필요). 앱 롤백: `dpl_7wsj3uWVS3zXy3NayjJFTQMgtDMy` → `dpl_HxSWo6BzrNfDTQDwg6NdMBMaYZKw`.
- 52번 시험 데이터 정리: `cleanup-test-chat-room.mjs`(기본은 점검만, `--apply` 시 한 트랜잭션). 연결된 글 `lost:140`의 제목에 시험 표식이 없어 가드가 중단했다. 사용자가 글을 확인한 뒤 `--post=lost:140`으로 실행한다. 삭제 전 백업은 복원 검증된 `auto-2026-11-20`(04:01)이다.

## 9. 52번 시험 데이터 정리 (2026-11-20 04:53 KST, 사용자 승인 C안)

- 사용자가 분실물 140번이 본인 시험 글임을 확인했다. `cleanup-test-chat-room.mjs --confirm-production 52 8 --post=lost:140`로 점검한 뒤 `--apply`로 실행했다. 삭제 트랜잭션 안에서 같은 조건을 다시 확인했다.
- 점검 결과: 1:1 방, 메시지 8건 모두 두 참여자, 채팅·글 사진 0, 다른 사람 댓글 0, 같은 글을 쓰는 다른 방 0, 감사 쪽지·반환·신고 0, 처리하지 않는 외래키 참조 0.
- 삭제: 알림 8건(두 계정의 해당 메시지 알림), 채팅방 52(메시지 8건과 읽음·grant 등 cascade), 분실물 140(파생 조회·상태·추천 캐시 포함). 확인: 방 0, 메시지 0, 글 0, grant 0, `/post/140` 404.
- 삭제 전 백업은 복원 검증된 `auto-2026-11-20`(04:01)이다.
- 정리 후 운영 상태: Production `dpl_AgwysDi1MrMCFVh1AaGccih1dn5C` 그대로, 전체 private, 공개 Realtime `private_only`, 익명 비공개 가입 거부, Data API 503, 프로브 16/16, error·5xx 0. 재배포는 하지 않았다.
