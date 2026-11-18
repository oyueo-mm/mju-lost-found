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
| 실제 Preview private 보안 | **43/43**: 익명·비참여자·다른 방·변조/만료/미래 token·다른 project/issuer·aud/scope·user/room/grant 변조 거부, 직접 WS/REST 송신 미수신과 서버 대조군 정상 수신. 동일 이름의 익명 public 채널이 private 이벤트를 받지 못함도 정상 private 대조군과 확인 |
| 기존 16단계 통합 | **16/16**, 실제 모델 768차원 완료·키워드/의미/통합/이미지 검색·실제 private 수신·사진/알림·관리자 허용/거부. 마지막 재실행은 private JWT 단독의 채팅/관리자/증거 API 401도 포함 |
| 실제 Chromium private | 처음 **9/9**, 163초. 구형 Auth.js cookie의 409→세션 cookie 갱신→200을 추가한 후 **10/10**, 145.7초. 각 실행 token API 200 4회, private broadcast 8회. 여러 탭·네트워크/visibility 복귀·초안 보존·125초 실제 대기 후 재발급/수신·비참여자/인증 소멸 차단 |
| 서명키 장애 대체 경로 | **10/10** 재실행. missing signer 503/fail-closed, 인증 API polling 수신, 두 탭·응답 역전/중복 방지·초안·네트워크·비참여자/세션 소멸 차단 |
| 전체 단위 | **268개 파일, 3,009/3,009** 재실행 통과 |
| 타입/린트/빌드 | 전체 lint·tsc 통과, Preview 설정을 포함한 로컬 Next build 통과. 후속 변경 스크립트 lint 재확인 |
| 이전 로컬 SQL | 전회 **44/44**, config 전환/발급 경합과 철회·재활성화 부활 차단 포함. 이번 hosted 검증과 구분 |
| Preview read-only health | Data API **503/OFF**, report-evidence private, 신고 snapshot 컬럼 3개, D-2 트리거 7개, 작업 실패 0, Realtime transport 정상 |

Storage 검사는 합성 prefix의 비공개 목록/오류와 별도의 16단계 정상 사진 업로드/열람·비참여자 거부다. 실제 Production으로 잘못된 토큰을 보내는 교차 프로젝트 공격 검사는 하지 않았다. 다른 project/issuer claims의 Preview 거부를 직접 확인했다. private JWT 단독의 DB 접근은 Data API OFF 및 전용 role의 public/storage 실효 테이블 권한 0과 실제 로컬 SQL 거부 검증을 함께 사용한다. Data API를 켜서 시험하지 않는다.

Production의 공개 JWKS만 읽어 Preview kid와 공개 좌표가 어느 쪽도 포함되지 않음을 확인했다. Production으로 JWT를 보내거나 신뢰 설정을 바꾸지 않았다. 이 메타데이터 비교를 전체 Production 검증기/외부 provider 설정의 공격 검사로 과장하지 않는다. 개인 서명키의 보관/복구는 DB dump와 별개이며 현재 로컬 DPAPI는 Windows CurrentUser에 묶인다. Production 신규 키 준비 시 별도 승인된 비밀 복구 절차가 필요하고 현재 파일을 평문으로 내보내거나 키를 임의 교체하지 않는다.

Realtime는 이미 연결된 소켓의 join RLS를 캐시할 수 있다. 따라서 철회 시 소켓이 즉시 사라졌다고 주장하지 않는다. 현재 서버 dispatch가 세션/현재 참여자/grant를 잠금 아래 다시 검사하며, 철회 commit 뒤 실제 발행 콜백이 실행되지 않고 reconnect도 거부됨을 확인했다. 재승인 시 기존 토큰은 거부되고 새 grant/topic이 필요하다. 네트워크에 이미 보낸 패킷의 회수는 보장하지 않는다.

## 발견·수정한 검증 환경 문제

최초 private Chromium 실행은 공개 키가 없는 기존 로컬 build 때문에 token 발급 200 이후 socket 0이었다. Preview 공개 키가 포함되도록 빌드를 수정했다. 직접 `node --env-file=... next build`는 현재 Next worker가 해당 옵션을 NODE_OPTIONS로 넘겨 exit 9로 실패했다. 전용 실행기가 환경을 메모리에서 읽고 plain Node 자식으로 빌드해 해결했다. 테스트 통과 기준을 낮추지 않았다.

첫 브라우저 계측은 Phoenix JSON 배열과 realtime-js 2.115의 binary kind=4 broadcast를 해석하지 못했다. 설치된 실제 SDK serializer에 맞춰 종류/건수만 해석하도록 수정했다. raw frame·JWT는 저장하지 않는다. 실패 실행의 fixture도 각각 정리했으며 최종 실제 수신/갱신 기준을 통과했다. 서비스 런타임 코드나 기존 테스트 기대값을 변경한 것은 아니다.

## 테스트 데이터와 성능

이번 생성 계정 **411~443**, 채팅방 **170~184**, 게시글 **312·313** 및 해당 글/채팅 원본 사진은 각 실행 UUID 명세·실제 소유자/참여자/경로를 확인하여 정리했다. 최종 읽기 전용 재조회에서 이 User/ChatRoom/LostPost 및 해당 Realtime Session/Grant의 잔여가 각각 0이었다. 자체 테스트 기관/멤버십도 정리했다. 기존 사용자·시드·운영 감사·신고 증거는 삭제하지 않았다. 실패한 브라우저 검증의 계정/방도 정리 결과가 true였다. 정상 요청이 남기는 집계 통계는 삭제하지 않았다.

이미지 원본 Storage의 부재는 확인했지만 공개 CDN GET은 삭제 후에도 200이었다. 기존 별도 보안 개선 항목으로 유지하며, 원본 삭제 실패로 오인하거나 캐시 잔존을 해결했다고 표시하지 않는다.

마지막 로컬 16단계의 검색 4종 합계는 약 3.8초, 실제 private 메시지·추가 HTTP 권한 거부를 포함한 11단계는 약 6.2초였다. 통제하지 않은 단일 로컬 표본으로 Production 지연/비용을 예측하지 않는다. 163초 browser의 token 4회에는 초기 연결·visibility/네트워크 재연결·갱신이 함께 포함돼 정상 시간당 발급량으로 환산하지 않는다. 다중 grant 부하/잠금 지연, 수시간 연결, OS 실제 background는 여전히 미측정이다.

## 백업과 남은 배포 게이트

다음 정기 백업 `auto-2026-11-18.tar.enc`의 실제 복원 검증 표식과 최신 성공 **2026-11-18 10:15:49 KST**를 확인했다. checksum OK, **53개 테이블 행 수 불일치 0·이미지 참조 134개 누락 0**이다. lastError는 없고 전일 lastFailureAt는 보존됐다. daily task LastResult 0, `ops/backup@89bec61`은 깨끗하며 backup/watchdog 실행 경로가 전용 worktree를 가리킨다. 다음 watchdog 11월 18일 13:00은 확인 시점에 아직 도래하지 않았다. 백업·예약·보존·접근 가드는 변경하지 않았다. 신규 D-3 역할/정책 복구와 Preview 테이블 56개 복원은 전회 완료 결과이며 이번 Production 정기 백업에는 아직 배포하지 않은 D-3 테이블이 없음을 구분한다. 기존 승인 실행기로 이번 Production read-only health도 통과했다(Data API 503/OFF·report-evidence private·작업 실패 0·D-2 트리거 7개·Realtime transport 정상).

Production 전환 전에는 독립 신규 키의 별도 승인·등록, 구버전 사용자 대상 전환 안내 준비, 권한 회수 부하·장시간·장애 시나리오, 호스팅 환경의 public OFF 검증이 남는다.

문제 시 Preview는 기존 `release-d3.mjs polling --apply --confirm-preview`로 인증 API polling에 복귀할 수 있다. 기존 키를 회전하거나 공개 통신으로 우회하지 않는다. Production의 현 D-2 배포는 그대로 보존한다. [전환/롤백 절차](release-d3-transition.md), [D-4 분석 계획](release-d4-plan-2026-11-16.md)을 계속 사용하며 D-4 구현은 하지 않는다.

## Preview 재배포 후 결과

- 앱/검증 커밋: `bb30c7a905662e98e6412271534af89185e627b3`.
- 배포: **`dpl_EQZvaqSf4GEzper1SMFWaCrMyBAP`**, READY, [고정 Preview](https://mju-lost-found-preview.vercel.app/) / [불변 URL](https://mju-lost-found-vercel-jtgbhdmsd-oyueo.vercel.app/). 기존 배포 실행기로 배포하고 고정 alias와 Preview 배포 이력 1건을 기록했다. Production 배포 이력은 쓰지 않았다.
- 배포된 버전 commit/ID 일치, 비파괴 프로브 **16/16**, 검색 4종/기존 사진/로그인 경로/익명 관리자·신고 증거 차단 통과. 이는 앞의 실제 쓰기 통합 회귀 16단계와 별개다.
- Preview 단일 검색 표본: keyword 437ms, semantic 1004ms, unified 261ms, image 1070ms. 콜드/웜/인스턴스 통제 없는 표본이며 검색 품질/요금의 비교 실험은 아니다.
- 최근 20분 오류/5xx 로그 각각 **0건**(조회 한도 각각 200). 업로드 파일 **1,179개**, `.env`/`.vercel`/DPAPI 등 금지 경로 **0개**. 로컬 client JS 68개에서 개인 서명값 및 `MJU_REALTIME_PRIVATE_JWK` 식별자 각각 0개를 확인했다.
- 배포 시작 후 보강한 동일 이름 public/private 격리 검사는 테스트 코드만 바꿨다. 후속 보고/테스트 커밋과 앱 배포 사이 서비스 동작 코드 차이는 없다.
- 사용자가 배포 `dpl_EQZvaqSf4GEzper1SMFWaCrMyBAP`에서 실제 Google 로그인 후 기존 채팅의 메시지·사진 표시, 최초 토큰 발급 HTTP 200, 2분 이상 열린 뒤 토큰 갱신 HTTP 200을 모두 확인했다. 검증은 기존 채팅 조회와 토큰 발급·갱신으로 이루어졌고 응답 본문이나 자격증명은 수집하지 않았다.

## 구버전 탭 전환 리허설

D-2 `8baa381` 로컬 빌드를 열고 공개 채널 가입 성공을 확인한 후, 같은 로컬 주소의 서버를 D-3으로 교체했다. 최종 Chromium 검사 **5/5**에서 기존 탭의 텍스트와 사진 미리보기 보존, 같은 로그인으로 열린 새 탭, 텍스트 복사와 원본 사진 재선택, D-3 polling의 새 메시지 수신을 확인했다. 구형 탭의 메시지 목록은 그대로 남아 새 탭으로 직접 이동해야 했다. 브라우저에서 구형 이벤트를 억제해 전환을 재현했으며 실제 Supabase 공개 채널 설정 변경 검증은 남아 있다.

초기 시험에서는 테스트 브라우저의 소켓 종료 계측이 멈췄다. 해당 자식 프로세스를 종료해 fixture를 정리하고, 구형 이벤트 억제로 바꿔 재실행했다. 가입 응답 계측의 Python 스코프 오류도 수정해 다시 통과했다. 변경된 공용 실행기에서 기존 API polling 회귀 **10/10**을 확인했다. 신규 테스트 사용자 444–458과 채팅방 186–190은 생성한 실행별 명세를 기준으로 정리했고, 사용자·방·메시지 잔여가 각각 0이었다. 사진 미리보기는 로컬 파일로 검증했다.

## 연결 안내 배포와 Preview 공개 접근 상태

2026-11-18 커밋 `0d8ff74`를 Preview 배포 `dpl_8dci85ohjUzhpxb6NTY4WPrkvruy`로 배포하고 고정 주소를 연결했다. D-3 화면은 비공개 연결이 끊기면 재연결과 주기 조회를 안내하고, 기존 화면에서 초안과 선택한 사진을 유지한다. 반복 연결 오류에서 API 조회 타이머가 매번 뒤로 밀리던 동작도 수정했다. 복구되면 안내가 사라진다. 이미 열려 있던 D-2 화면의 코드는 그대로 실행되므로 새 탭 이동을 사전에 안내해야 한다. [전환 절차](release-d3-transition.md)에 안내 문안을 준비했다.

이 배포에서 독립 검증 결과는 실제 공급자 Standby 검사 **43/43**, 실제 비공개 소켓과 토큰 장애 모의를 포함한 Chromium **12/12**, 인증 API polling Chromium **10/10**, 통합 회귀 **16/16**, 웹 푸시 발송·실패 처리 단위 **15/15**, 전체 단위 **3,009/3,009**, 타입·린트·빌드 통과다. 처음 전체 단위 실행에 로컬 `.vercel` 보관본의 D-2 테스트까지 섞였으므로 현재 저장소 코드를 대상으로 재실행했다. 언어 키가 하나 추가되어 엄격한 사전 일치 검사 예상 개수도 933개로 갱신했다. Preview의 Data API OFF와 증거 버킷 비공개를 확인했다. Vercel에는 웹 푸시 설정 변수 이름 두 개가 등록돼 있으나 실제 기기 수신은 아직 확인하지 않았다. 공개 JWKS를 로컬에서 비교하여 Preview 서명이 Production 공개키 집합에서 거부되고 환경별 공개키가 분리됐음을 확인했다. Production 검증기에 테스트 토큰을 보내지는 않았다.

마지막 공급자 확인에서 합성 공개 토픽 가입이 `SUBSCRIBED`였으므로 **Preview 공개 접근은 ON**으로 기록한다. 사용 가능한 인증된 Supabase 관리 연결이 없어 대시보드 토글 변경을 요청했다. 적용 후 `--expect-public-off` 검사는 명시적인 `PrivateOnly`를 요구하며 timeout이나 일반 오류는 통과로 처리하지 않는다. 이후 일반 회원의 private 재가입·수신, 갱신, 권한 회수, 통합 회귀를 다시 실행한다. 실패 시 인증 API polling으로 유지하는 절차는 [전환 및 복구 절차](release-d3-transition.md#안전한-롤백)에 있다. 이번 변경은 Preview 범위다.

새 Preview의 비파괴 프로브 **16/16**이 통과했고 조회 시 최근 20분 오류 및 5xx는 각각 0건이었다. 업로드 파일 1,180개에서 금지 경로는 0개였다. 테스트 사용자 459–470, 채팅방 191–196, 게시글 314와 생성한 사진을 정리했다. 읽기 전용 재조회에서 해당 사용자·방·메시지·게시글·Realtime grant는 모두 0건이었다. 원본 공개 사진은 Storage에서 제거됐지만 삭제 직후 CDN에서 200이 관측됐다. Production 공개 버전은 D-2 `8baa381`, `dpl_HTtxjZJDDgka3HjTkRH6ZKQzR7EX`였다.
