# D-3 Preview Standby 실제 검증 — 2026-11-18

## 결론과 승인 경계

Preview `swqvlihgupranzfzjevb`의 **Standby ES256 키로 실제 Supabase Realtime 일반 회원 역할의 private 구독과 서버 이벤트 수신이 성공**했다. 활성 키를 회전·활성화·폐기할 필요가 없었다. 공개 kid는 `c0eb51e4-97b9-4d13-b042-1a820650d257`이며 private JWK/토큰은 로그·Git·채팅·평문 파일로 출력하지 않았다.

사용자가 대시보드의 Standby 상태와 기존 활성 키 불변을 확인했다. 에이전트는 로컬 Windows CurrentUser DPAPI 키와 공개 JWKS의 kid/alg/kty/crv/x/y 일치를 독립 확인했다. 관리 API 연결은 여전히 없으므로 키 목록의 전체 상태를 조회·수정하지 않았다. Vercel에는 **Preview에만** `MJU_REALTIME_PRIVATE_JWK`를 sensitive 변수로 stdin 등록했다. 기존 동명 변수는 없었으며 Preview-only 등록 기록을 `.vercel`에 보관했다.

Production은 공개 버전 GET으로 커밋 `8baa381605638ff7bde97446732083f47589c3b3`, 배포 `dpl_HTtxjZJDDgka3HjTkRH6ZKQzR7EX`가 그대로임을 확인했다. Production DB·서명키·환경 변수·Realtime·Data API 설정은 변경하지 않았다. Production 신규 키 추가는 아직 승인되지 않았다.

## 이번 구현·운영 변경

- `preview-realtime-manual-state.mjs`: 고정된 Preview DPAPI 파일만 메모리에서 복호화하고 대상 DB/Storage·승인 kid·JWKS를 검사한다. 다른 서명 설정의 덮어쓰기와 Production을 거부한다.
- `register-preview-realtime-environment.mjs`: 연결된 Vercel 팀의 Preview 민감 변수만 등록한다. 다른 환경/기존 변수 덮어쓰기/Supabase 키 관리는 지원하지 않는다.
- `realtime-private.mjs`: 실제 Preview의 회원·단체 담당자 정상 수신 및 부정 토큰·직접 송신·권한 회수를 신규 fixture로 검증한다.
- `realtime-private.py`와 기존 browser harness `--private`: 실제 Chromium/Preview 소켓, 다중 탭·재연결·실제 토큰 갱신을 검사한다. 실제 배포 Auth.js 키는 사용하지 않고 로컬 child server 전용 세션만 생성한다.
- 기존 16단계 검사 `--manual-preview-key`: 같은 DPAPI 키를 자식 서버에 메모리로만 전달한다. private JWT가 일반 채팅/관리자/신고 증거 HTTP API의 로그인 권한이 되지 않는지도 확인한다.
- `build-preview.mjs`: Preview 공개 설정을 빌드 시 주입하고 대상 가드를 검사한다. 개인 서명키는 빌드 환경에서 제외한다.
- Preview `ChatRealtimeConfig`만 polling→private, project/kid를 설정했다. 이 전환 전 grant는 0개였다. 신규 스키마 migration은 이번 회차에 추가하거나 적용하지 않았다. 공개 채널 허용 설정은 아직 끄지 않았으므로 전체 D-3 보안 전환 완료로 표시하지 않는다.

## 검증 결과

| 검사 | 결과/범위 |
| --- | --- |
| Standby 최소 정상 경로 | 4/4, 일반 회원 role의 실제 private join + 서버 gated HTTP 발행/수신 |
| 실제 Preview private 보안 | **41/41**: 익명·비참여자·다른 방·변조/만료/미래 token·다른 project/issuer·aud/scope·user/room/grant 변조 거부, 직접 WS/REST 송신 미수신과 서버 대조군 정상 수신 |
| 기존 16단계 통합 | **16/16**, 실제 모델 768차원 완료·키워드/의미/통합/이미지 검색·실제 private 수신·사진/알림·관리자 허용/거부. 마지막 재실행은 private JWT 단독의 채팅/관리자/증거 API 401도 포함 |
| 실제 Chromium private | **9/9**, 163초. token API 200 4회, private broadcast 8회, 여러 탭·네트워크/visibility 복귀·초안 보존·125초 실제 대기 후 재발급/수신·비참여자/인증 소멸 차단 |
| 전체 단위 | **268개 파일, 3,009/3,009** 재실행 통과 |
| 타입/린트/빌드 | 전체 lint·tsc 통과, Preview 설정을 포함한 로컬 Next build 통과. 후속 변경 스크립트 lint 재확인 |
| 이전 로컬 SQL | 전회 **44/44**, config 전환/발급 경합과 철회·재활성화 부활 차단 포함. 이번 hosted 검증과 구분 |
| Preview read-only health | Data API **503/OFF**, report-evidence private, 신고 snapshot 컬럼 3개, D-2 트리거 7개, 작업 실패 0, Realtime transport 정상 |

Storage 검사는 합성 prefix의 비공개 목록/오류와 별도의 16단계 정상 사진 업로드/열람·비참여자 거부다. 실제 Production으로 잘못된 토큰을 보내는 교차 프로젝트 공격 검사는 하지 않았다. 다른 project/issuer claims의 Preview 거부를 직접 확인했다. private JWT 단독의 DB 접근은 Data API OFF 및 전용 role의 public/storage 실효 테이블 권한 0과 실제 로컬 SQL 거부 검증을 함께 사용한다. Data API를 켜서 시험하지 않는다.

Realtime는 이미 연결된 소켓의 join RLS를 캐시할 수 있다. 따라서 철회 시 소켓이 즉시 사라졌다고 주장하지 않는다. 현재 서버 dispatch가 세션/현재 참여자/grant를 잠금 아래 다시 검사하며, 철회 commit 뒤 실제 발행 콜백이 실행되지 않고 reconnect도 거부됨을 확인했다. 재승인 시 기존 토큰은 거부되고 새 grant/topic이 필요하다. 네트워크에 이미 보낸 패킷의 회수는 보장하지 않는다.

## 발견·수정한 검증 환경 문제

최초 private Chromium 실행은 공개 키가 없는 기존 로컬 build 때문에 token 발급 200 이후 socket 0이었다. Preview 공개 키가 포함되도록 빌드를 수정했다. 직접 `node --env-file=... next build`는 현재 Next worker가 해당 옵션을 NODE_OPTIONS로 넘겨 exit 9로 실패했다. 전용 실행기가 환경을 메모리에서 읽고 plain Node 자식으로 빌드해 해결했다. 테스트 통과 기준을 낮추지 않았다.

첫 브라우저 계측은 Phoenix JSON 배열과 realtime-js 2.115의 binary kind=4 broadcast를 해석하지 못했다. 설치된 실제 SDK serializer에 맞춰 종류/건수만 해석하도록 수정했다. raw frame·JWT는 저장하지 않는다. 실패 실행의 fixture도 각각 정리했으며 최종 실제 수신/갱신 기준을 통과했다. 서비스 런타임 코드나 기존 테스트 기대값을 변경한 것은 아니다.

## 테스트 데이터와 성능

이번 생성 계정 **411~434**, 채팅방 **170~179**, 게시글 **312·313** 및 해당 글/채팅 원본 사진은 각 실행 UUID 명세·실제 소유자/참여자/경로를 확인하여 정리했다. 자체 테스트 기관/멤버십도 정리했다. 기존 사용자·시드·운영 감사·신고 증거는 삭제하지 않았다. 실패한 브라우저 검증의 계정/방도 정리 결과가 true였다. 정상 요청이 남기는 집계 통계는 삭제하지 않았다.

이미지 원본 Storage의 부재는 확인했지만 공개 CDN GET은 삭제 후에도 200이었다. 기존 별도 보안 개선 항목으로 유지하며, 원본 삭제 실패로 오인하거나 캐시 잔존을 해결했다고 표시하지 않는다.

마지막 로컬 16단계의 검색 4종 합계는 약 3.8초, 실제 private 메시지·추가 HTTP 권한 거부를 포함한 11단계는 약 6.2초였다. 통제하지 않은 단일 로컬 표본으로 Production 지연/비용을 예측하지 않는다. 163초 browser의 token 4회에는 초기 연결·visibility/네트워크 재연결·갱신이 함께 포함돼 정상 시간당 발급량으로 환산하지 않는다. 다중 grant 부하/잠금 지연, 수시간 연결, OS 실제 background는 여전히 미측정이다.

## 백업과 남은 배포 게이트

다음 정기 백업 `auto-2026-11-18.tar.enc`의 실제 복원 검증 표식과 최신 성공 **2026-11-18 10:15:49 KST**를 확인했다. lastError는 없고 전일 lastFailureAt는 보존됐다. daily task LastResult 0, `ops/backup@89bec61`은 깨끗하며 backup/watchdog 실행 경로가 전용 worktree를 가리킨다. 다음 watchdog 11월 18일 13:00은 확인 시점에 아직 도래하지 않았다. 백업·예약·보존·접근 가드는 변경하지 않았다. 신규 D-3 역할/정책 복구와 Preview 테이블 56개 복원은 전회 완료 결과이며 이번 Production 정기 백업에는 아직 배포하지 않은 D-3 테이블이 없음을 구분한다.

Preview 재배포/비파괴 probe/로그 결과는 실제 완료 후 아래에 추가한다. Production 배포는 하지 않는다. 남은 조건은 Production 독립 신규 키의 별도 승인·등록, 구 D-2 장시간 탭의 초안 보존 전환 리허설, 권한 회수 부하/장시간·장애 시나리오, 최종 public OFF 검증이다. 신뢰 키가 검증됐다는 이유만으로 이 조건들을 통과로 간주하지 않는다.

문제 시 Preview는 기존 `release-d3.mjs polling --apply --confirm-preview`로 인증 API polling에 복귀할 수 있다. 기존 키를 회전하거나 공개 통신으로 우회하지 않는다. Production의 현 D-2 배포는 그대로 보존한다. [전환/롤백 절차](release-d3-transition.md), [D-4 분석 계획](release-d4-plan-2026-11-16.md)을 계속 사용하며 D-4 구현은 하지 않는다.
