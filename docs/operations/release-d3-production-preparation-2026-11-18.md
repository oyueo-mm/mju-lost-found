# D-3 Production 전환 준비

2026-11-18 사용자가 승인한 운영 변경은 Production Supabase 신규 Standby 키 1개 추가와 해당 키의 Vercel Production 민감 변수 등록이다. 현재 앱은 D-2 `8baa381` 및 `dpl_HTtxjZJDDgka3HjTkRH6ZKQzR7EX`를 유지한다. 새 앱 배포와 공개 채널 중단에는 별도 승인이 필요하다.

**현재 상태** · Production Standby의 JWKS 검증과 Vercel Production 전용 `MJU_REALTIME_PRIVATE_JWK` 민감 변수 등록을 완료했다. 아래 순서는 별도 운영 전환 승인 후 실행한다.

**이번 전환의 승인 범위** · 운영자가 D-3 Production 전환을 승인했다. 기준 시점에 채팅 메시지와 채팅 첨부 참조가 0건이어서 이번에는 24시간 사전 공지를 생략한다. D-3의 재연결 안내와 인증 polling, 초안을 보존하는 구형 탭 이동 절차는 유지한다. 실제 비공개 연결과 갱신 확인, 20분 관찰은 공개 접근 OFF의 필수 조건이다.

Production 프로젝트 `tmifqtyxojtuoejxjrng` 전용 ES256 키의 공개 ID는 `c455ce27-da9f-42e8-ab62-00d443e55979`다. Windows CurrentUser DPAPI에 암호화했고 로컬 서명과 검증, Preview 공개키와의 분리를 확인했다. 등록 전 Production JWKS의 기존 공개키 1개와 Vercel Production 전용 변수 부재를 기준으로 저장했다. 기준은 Git에서 제외된 공개 메타데이터다. 이전 키의 Standby/Active 상태 자체는 JWKS에서 판별할 수 없으므로 대시보드 상태는 운영자가 확인한다.

1. [Production JWT Signing Keys](https://supabase.com/dashboard/project/tmifqtyxojtuoejxjrng/settings/jwt)에서 **Project Settings → JWT Keys → JWT Signing Keys → Create standby key**로 이동한다.
2. **ES256 (ECC)**를 선택하고 **Import an existing private key**를 체크한다. 아래 명령을 저장소 루트에서 실행한다. 터미널을 열어 둔 상태에서 120초 안에 JWK 입력란에 붙여넣고 **Create standby key**로 저장한다.

   ```powershell
   powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File scripts/operations/realtime-manual-key.ps1 -Action Copy -ConfirmProduction
   ```

3. 새 키의 공개 ID와 **Standby** 상태를 확인한다. 기존 키 이동이나 회전이 요구되면 중단한다. 운영자가 등록을 확인하면 `production-realtime-standby.mjs verify --confirm-production-key-only`로 JWKS를 검증한다. 신규 키의 ID·지문과 기존 공개키 보존이 확인되면 `register-vercel --confirm-production-key-only --confirm-standby`로 Production 전용 민감 변수를 등록한다. 도구는 동일 변수의 덮어쓰기를 거부하고 stdin으로만 전달하며 배포를 생성하지 않는다. JWKS 게시 이후에도 D-2에는 신규 키를 쓰는 토큰 발급 경로가 없다.

Supabase 문서상 Standby 키 가져오기와 신규 발급에 쓰는 키 회전은 별개의 동작이다. 등록 전후에 공개 JWKS, 기존 배포 ID, 로그인 경로와 비인증 접근, 기존 이미지, 신고 증거 버킷, Data API OFF, 기존 Realtime 연결을 비교한다. 운영자 기존 Google 세션의 화면 확인과 앱이 발급한 D-3 토큰의 정상 가입은 배포 후 검증 항목에 넣는다. [Supabase 서명키 문서](https://supabase.com/docs/guides/auth/signing-keys) · [Vercel 민감 변수 문서](https://vercel.com/docs/environment-variables/sensitive-environment-variables)

## 배포 및 복구 순서

1. 승인과 배포 시점을 확정한다. 이전 D-2 배포를 보존하고 Production 암호화 백업을 비교해 최신 상태를 재확인한다. 11월 18일 기존 정기 백업의 격리 복원은 53개 테이블 일치, 참조 사진 134개 일치, D-3 6개 마이그레이션과 수신 전용 권한을 통과했다. 이 결과는 배포 직전 백업을 대신하지 않는다.
2. 운영자는 **D-3 앱 배포 전에** 사용자 안내를 게시한다. D-3 발행기는 공개 채널 허용 설정과 무관하게 D-2의 공개 토픽으로는 보내지 않으므로 기존 탭은 앱 전환 시점부터 오래된 목록을 보여줄 수 있다. 기존 탭을 둔 채 새 탭에서 초안을 복사하고 원본 사진을 다시 선택하도록 안내한다. 기존 승인 실행기로 DB 이력·checksum을 검증해 승인된 D-3 추가형 마이그레이션만 적용한다. D-3 앱을 인증 API polling 상태로 먼저 배포해 안전한 복구 후보를 확보한다.
3. 검증한 공개 `kid`로 private 모드를 활성화한다. 실제 Production 운영자 세션에서 기존 방의 화면과 정상 비공개 가입·토큰 갱신을 확인하고, 새 데이터 없이 버전·로그·기존 사진·인증과 Data API OFF를 확인한다. 로그인 사용자 테스트는 기존 조회 기능으로 제한한다.
4. 사용자 안내와 복구 후보 확인 후 별도로 승인된 시점에만 **Allow public access to channels**를 OFF로 저장한다. 설정 저장 시 연결이 끊길 수 있으므로 새 비공개 연결과 인증 polling을 확인하고 Vercel 오류, 5xx, 채팅 지연을 관찰한다. 공격성 검사는 Preview 결과를 사용한다. [Supabase Realtime 설정 문서](https://supabase.com/docs/guides/realtime/settings)
5. 비공개 가입·갱신이 실패하거나 오류가 악화되면 공개 접근 OFF 단계로 넘어가지 않는다. 공개 접근 OFF 전에는 기존 D-2 배포를 복구에 사용할 수 있다. OFF 이후에는 검증한 D-3 배포를 유지하며 승인 실행기로 polling 모드로 전환해 발급한 grant를 철회한다. 앱 롤백도 polling과 호환되는 배포를 사용한다. 신고 증거와 추가형 테이블을 보존한다. [전환·복구 실행 절차](release-d3-transition.md)

구버전 실제 가입 거부와 수동 이동은 Preview Chromium에서 5/5 통과했다. 기존 D-2 탭에 새 코드를 주입할 방법은 없으므로 공지 시점과 문안은 운영 전환 일정에 포함한다. [Preview 검증 결과](release-d3-standby-2026-11-18.md)

## 실기기 웹 푸시

Windows Edge의 실제 푸시 제공자를 사용해 앱 설정의 구독, 다른 테스트 계정의 메시지 발송, 서비스 워커 알림 수신과 채팅 목적지 확인, 브라우저 구독 해제 **4/4**를 통과했다. 발송 대기열은 1회 시도에서 성공했고 구독 해제 뒤 DB 구독은 0건이었다. 현재 앱 빌드에 기기 전용 임시 VAPID와 격리 WSL PostgreSQL을 연결했다. 임시 Edge 프로필과 DB는 시험 종료 후 정리했다. 기존 사용자 구독이나 실제 Preview·Production 발송 대기열과 섞지 않았다. 이 결과는 실제 기기에서 푸시 전달을 확인한 것이며 Android·iOS와 OS 알림 클릭은 아직 시험하지 않았다.

Windows에서 직접 WSL 포트에 접속할 수 없어 로컬 루프백과 WSL Unix 소켓을 중계했다. 스키마 엔진의 직접 DB 쓰기가 실패해 Prisma가 생성한 빈 스키마 SQL을 검증된 임시 DB 연결에 적용했다. 첫 브라우저 검사도 비동기 알림 조회를 기다리는 방법을 고친 뒤 재검증했다. 단계별 판정과 기존 웹 푸시 정책을 유지했다.

## Standby 등록 후 읽기 전용 점검

운영자가 Production 대시보드에서 `c455ce27-da9f-42e8-ab62-00d443e55979`를 Standby로 가져왔고 기존 활성 키를 그대로 유지했다고 확인했다. `production-realtime-standby.mjs verify`는 로컬 공개 지문과 현재 Production JWKS의 일치, 등록 전 공개키 보존, Preview 키와의 분리를 모두 통과했다. 활성 상태는 운영자 대시보드 확인을 기준으로 기록하며 공개 JWKS 점검은 공개키와 서명 검증 범위다.

| Production 검사 | 결과 |
| --- | --- |
| 앱 버전 | D-2 `8baa381`, `dpl_HTtxjZJDDgka3HjTkRH6ZKQzR7EX` 일치 |
| 인증 경계 | 로그인과 익명 세션 HTTP 200, 익명 채팅·관리자 신고 API HTTP 401 |
| Storage와 Data API | 신고 증거 버킷 비공개, 신고 스냅샷 컬럼 3개, Data API HTTP 503으로 OFF 확인 |
| Realtime | 기존 WebSocket transport 열기·닫기 정상 |
| D-2 작업 | 트리거 7개 유지, 실패 0건 |
| Vercel 로그 | 최근 20분 오류 0건, 5xx 0건 |
| Vercel Production 변수 이름 | `MJU_REALTIME_PRIVATE_JWK` 미등록 |

이번 요청은 읽기 전용 점검으로 해석했다. 운영 앱 세션으로 로그인한 확인과 D-3 앱에서 발급한 Production 토큰의 실제 비공개 가입은 배포 단계의 검증으로 남는다. Vercel 변수 등록, Production 배포, 공개 채널 OFF는 이번 점검 범위에 포함하지 않았다.

## Vercel 민감 변수 등록과 최종 점검

후속 승인으로 `production-realtime-standby.mjs register-vercel --confirm-production-key-only --confirm-standby`를 실행했다. Production JWKS와 로컬 키의 지문, 기존 공개키 보존, Preview 공개키와의 분리를 다시 검증하고 Vercel CLI stdin으로 값을 전달했다. Vercel의 복호화 없는 조회에서 동일한 이름의 `sensitive`/`secret` 항목이 **Production 전용 하나와 Preview 전용 하나**로 분리돼 있었다. 브랜치나 사용자 지정 환경에 연결된 항목은 없었다. 개인키나 변수 값을 출력하지 않았다. Vercel 환경 변수 변경은 새 배포부터 적용된다. [Vercel 환경 변수 동작](https://vercel.com/docs/environment-variables/managing-environment-variables)

| 등록 후 확인 | 결과 |
| --- | --- |
| Production 배포 | D-2 `8baa381`, `dpl_HTtxjZJDDgka3HjTkRH6ZKQzR7EX` 일치. Vercel 메타데이터에서 같은 프로젝트의 Production `READY` 롤백 대상 확인 |
| 인증 | 로그인 HTTP 200, 익명 세션 확인, 채팅·관리자 API HTTP 401 |
| 채팅과 Storage | 채팅방 4개, 메시지·채팅 이미지 참조 0개. 채팅 이미지와 신고 증거 버킷 비공개, 게시글 이미지 버킷 공개 및 기존 이미지 응답 정상 |
| Realtime 및 데이터 | WebSocket transport 정상, Data API HTTP 503/OFF, D-2 작업 실패 0건 |
| 오류 | 기존 배포 최근 20분 error·5xx 각각 0건 |
| DB 변경 전 이력 | 예정된 D-3 마이그레이션 6개만 대기, D-3 설정 테이블 미존재 |

게시글 이미지와 채팅 버킷을 점검하는 `--content-continuity` 옵션을 기존 읽기 전용 점검에 추가했다. 처음에는 Prisma 필드명과 실제 기존 SQL 컬럼명이 달라 조회가 실패했으며 물리 컬럼 `image_url`로 수정해 통과했다. Production에 기존 채팅 메시지나 채팅 사진 참조가 없어 실물 채팅 사진 열람은 Preview 통합 회귀 결과를 사용한다. Production의 실제 D-3 세션 발급과 비공개 가입은 아래 전환에서 확인한다.

## 승인 후 실행 순서와 중단 조건

1. **안내 및 일정**. 기본 안내 채널은 기존 [관리자 공지 등록](https://mju-find.vercel.app/admin/announcements)이다. `settings.manage` 권한의 운영자가 앱 전환 예정 시각을 KST로 확정한 뒤, 최소 24시간 앞서 `채팅 연결 업데이트 안내` 공지를 등록해 활성 이용자의 앱 내 알림으로 전달한다. 사용자에게 기존 채팅 탭을 닫기 전에 같은 대화를 새 탭에서 열어 작성한 글을 복사하고 원본 사진을 다시 선택하도록 안내한다. 공지 본문은 [전환·복구 절차](release-d3-transition.md#장시간-열린-구버전-탭)에 있다. 공지 등록에 따른 사용자 알림 생성은 전환 승인 범위에 포함되는지 확인한 뒤 실행한다. 기존 탭에 즉시 표시되거나 모바일 푸시로 전달된다고 가정하지 않는다. D-3 앱이 공개 토픽에 새 이벤트를 보내지 않으므로 안내 기준 시점은 **공개 OFF가 아니라 앱 배포 시점**이다.
2. **백업 및 사전 확인**. Production 버전과 직전 READY 롤백 배포, Preview와 소스 동등성, Production 전용 Secret 메타데이터, JWKS를 대조한다. 전용 `ops/backup`에서 기존 승인 실행기로 **새 이름의 최신 암호화 백업**을 만들고 SHA256·실제 격리 복원·이미지 참조·D-3 마이그레이션 리허설을 요구한다. 기존 정기 파일의 재검증 시각만으로 새 백업으로 판정하지 않는다. 권한·체크섬·복원 실패, 관련 5xx, 환경 키 혼선, 안내 미확인 또는 롤백 대상 미확보 시 중단한다.
3. **DB 마이그레이션**. `release-d3.mjs preflight`에서 예정된 6개만 대기 중임을 확인한다. 승인 실행기로 `migrate --apply --confirm-production`을 실행해 대기가 0이고 `mode=polling`, 전용 역할이 수신 전용, 앱·Storage 콘텐츠 실효 테이블 권한 0임을 확인한다. 잠금이나 migration 실패 시 앱 배포를 중단하고 이력을 확인한다. 기존 콘텐츠와 Storage는 그대로 둔다.
4. **polling으로 앱 배포**. Preview와 서비스 소스가 일치하는 깨끗한 작업 트리를 기존 `node scripts/deployments/deploy.mjs production --dry-run`으로 배포한다. 여기서 `--dry-run`은 배포 이력 DB 쓰기만 생략하며 실제 배포가 발생한다. 새 배포 ID를 기록하고 인증 API 조회, 기존 게시글 이미지와 채팅 화면 접근을 확인해 같은 빌드를 polling 복구 후보로 보존한다. 직전 D-2 배포는 READY 롤백 대상으로 유지한다.
5. **비공개 활성화 후 관찰**. 기존 방에 참여 중인 운영자가 비저장 수신 확인에 참여할 수 있을 때 승인 실행기에서 `private --kid c455ce27-da9f-42e8-ab62-00d443e55979 --apply --confirm-production`으로 전환한다. 해당 세션에서 최초 토큰 발급과 실제 비공개 가입을 확인한다. 최초 토큰 만료 뒤 갱신을 확인하고, 갱신된 개별 토픽에 보낸 REST Broadcast가 동일 브라우저에 도착해야 한다. 비참여자의 인증 토큰 요청과 익명의 가입은 거부돼야 한다. 검사에 실패하면 공개 접근 OFF를 중단하고 polling으로 복구한다. Storage, Data API OFF, Vercel 로그를 다시 확인한다.
6. **공개 접근 OFF**. 앞 단계 통과 후 관련 오류·5xx 없이 **20분 관찰**하고 공지 전달 경로와 polling 복구를 재확인한 뒤, 승인된 시각에만 [Production Realtime 설정](https://supabase.com/dashboard/project/tmifqtyxojtuoejxjrng/realtime/settings)의 **Allow public access to channels**를 OFF로 저장한다. 설정 저장으로 연결이 끊길 수 있다. 운영 참여자의 재가입과 갱신, 앱의 인증 경계·Storage 및 Data API OFF를 확인하고 관련 로그를 다시 본다. Production에서 공격성 가입이나 대량 요청을 수행하지 않는다. [Supabase Realtime 설정](https://supabase.com/docs/guides/realtime/settings)
7. **복구 및 계속 감시**. 공개 OFF 전 앱 기능이나 데이터 연속성에 영향이 있으면 직전 D-2 배포 `dpl_HTtxjZJDDgka3HjTkRH6ZKQzR7EX`로 되돌릴 수 있다. OFF 뒤 가입·갱신 또는 채팅 경로에 장애가 있으면 받은 승인 아래 `release-d3.mjs polling --apply --confirm-production`을 실행해 인증 API polling으로 복구하고 발급된 grant를 철회한다. 기존 D-2 앱은 이미 열린 탭에서 polling을 지원하지 않으므로 OFF 이후 복구 대상은 위에서 확인한 D-3 빌드다. 앱 데이터·증거·추가형 테이블과 키는 보존한다. DB 접근 장애로 polling 전환 자체가 실패하면 연결 복구와 기존 읽기 경로 확인을 우선하고, 공개 모드 복원은 별도의 운영 결정으로 둔다. [Vercel 롤백 절차](https://vercel.com/docs/cli/rollback)

## Production 전환 실행 기록 · polling

사용자 승인에 따라 이번 24시간 공지는 생략했다. D-3 재연결 안내와 인증 polling 및 기존 탭을 유지한 초안 이동 절차는 검증한 빌드 그대로 보존했다. D-2의 이미 열린 화면에는 새 스크립트를 주입할 수 없으므로 구버전 창 자체에 `재연결` UI가 새로 붙는다고 보장하지 않는다.

| 항목 | 확인 결과 |
| --- | --- |
| 전환 직전 암호화 백업 | `release-d3-pre-2026-11-18-161329.tar.enc`. 공유 snapshot, 암호화 왕복 SHA256, WSL PG18 격리 복원에서 53개 테이블 행 수 불일치 0 및 이미지 134개 누락 0. 같은 백업에 지정 D-3 6개 리허설 및 수신 전용 권한 검사를 완료했다. |
| Production DB | `20261123000000`부터 `20261123050000`까지 지정 6개 적용, 대기 0. 신규 세션·grant·설정 테이블의 RLS와 Realtime 수신 전용 권한 확인. 앱·Storage 콘텐츠 실효 권한 0. |
| 현재 Production 및 polling 복구 대상 | `dpl_9RGngoiirr63Yj2WMcFFMfTqdbVC`, 커밋 `cbb1a90341ac959b27e37f23fe1f461128161adb`, DB 모드 `polling`, 활성 grant 0. Preview와 서비스 소스가 동일하다. |
| 직전 D-2 롤백 대상 | `dpl_HTtxjZJDDgka3HjTkRH6ZKQzR7EX`, 커밋 `8baa381`, 바로 이전 Production이며 READY. |
| 비파괴 확인 | 16/16. 버전, 로그인 경로, 익명 조회 차단, 검색 4종 및 기존 이미지 응답 확인. 익명 Realtime 토큰 요청 HTTP 401 및 no-store, 알림·읽지 않은 수 HTTP 401. |
| 데이터·Storage·운영 | 읽기 전용 확인에서 기존 채팅방 4개, 메시지와 사진 참조 0개, 게시글 이미지 행 134개. 채팅·신고 증거 버킷 비공개, 기존 이미지 응답 정상, Data API OFF, 기존 D-2 작업 오류 0. 첫 최근 20분 로그 조회에서 error 및 5xx 각 0. |
| 배포 업로드 | 1,186개 파일의 경로 검사에서 금지 파일 0. |
| 적용 후 암호화 백업 | `release-d3-polling-2026-11-18-162050.tar.enc`. 56개 테이블 행 수 불일치 0, 이미지 134개 누락 0. Production Realtime 수신 전용 역할, ACL 및 정책을 격리 복원에서 재구축해 원본 메타데이터와 대조했다. |

### Production 실제 로그인 후속 확인

운영자가 Production에서 Google 로그인과 재로그인, 기존 게시글과 사진 표시, 채팅 화면 열기, 알림 화면 표시를 확인했다. 후속 읽기 전용 검사에서 DB 모드 `polling`, 활성 grant 0, 대기 migration 0, 채팅방 4개, 메시지와 채팅 사진 참조 각각 0개를 재확인했다. 채팅·신고 증거 버킷은 비공개이고 기존 게시글 이미지는 응답했으며 Data API는 OFF였다. 동일 배포의 최근 20분 로그에서 error와 5xx는 각각 0건이었다.

동일 소스의 로컬 브라우저와 Preview DB에서 실행한 격리 polling 회귀는 10/10이었다. 새 메시지 수신, 다중 탭, 응답 순서 역전, 초안 보존, 재연결, 비참여자 차단 및 세션 만료를 확인했다. 테스트로 생성한 방과 계정 3개의 정리도 완료했다.

### Production 비파괴 Realtime 전환 게이트

사용자의 후속 지시에 따라 두 계정으로 메시지와 사진을 주고받는 검증은 생략했다. 현재 배포는 `dpl_9RGngoiirr63Yj2WMcFFMfTqdbVC` (`cbb1a90`)이며 `polling`에서 동작한다. 채팅방 4개, 메시지 0개, 채팅 이미지 참조 0개였다. 사용자·채팅·첨부 데이터와 감사·보안 로그를 수정하지 않았다.

| 확인 범위 | 결과 |
| --- | --- |
| Production 실제 익명 경계 | 앱 토큰 API는 HTTP 401 및 `no-store`, 공급자의 비공개 구독은 권한 거부. 합성 토픽에 대한 공개 구독은 허용됐다. |
| Production 실제 비공개 전송 | 기존 채팅과 무관한 임시 토픽에 기존 서버 SDK로 본문 없는 nonce를 보냈다. 서버 권한으로 가입한 비공개 WebSocket에서 같은 값을 받았다. 앱 DB에 메시지를 추가하지 않았다. |
| Production 현재 DB 권한 | 기존 방의 학생 참여자 표본 4/4 허용, 비참여자 표본 4/4 거부. 전용 역할의 송신 및 앱·Storage 데이터 권한은 0이다. 마이그레이션 대기 0, 활성 grant 0, Data API OFF다. |
| Production 공개키 및 설정 | 이전 공개키 집합과 Production Standby 공개키의 일치, Preview와 별개의 키, Vercel Production 민감 변수 등록 메타데이터를 확인했다. |
| Production 로그 | polling 배포의 최근 20분 error·5xx 각각 0건. 비공개 모드의 관찰 시간은 집계하지 않았다. |
| Preview 일반 회원 검증 | 공개 구독 `PrivateOnly`, 실제 참여자와 기관 담당자 비공개 수신·비참여자 차단·갱신·권한 회수 등 45/45. 브라우저 12/12, polling 10/10, 통합 회귀 16/16. |

비파괴 점검은 [재사용 스크립트](../../scripts/regression/README.md#호스팅-realtime-비파괴-점검)로 실행했다. 처음에는 서버 키를 일반 소켓에 직접 지정해 Production 가입이 거부됐다. 서비스 SDK의 정상 서버 인증으로 같은 검사를 다시 실행한 결과 두 환경에서 수신했다. 스크립트 구문·린트와 Realtime 단위 검사 29/29도 통과했다.

서버 대조군 수신과 DB 함수 표본은 일반 회원의 실제 소켓에서의 검증과 별개다. Production 앱이 발급한 회원 토큰의 실제 비공개 가입·수신, 비참여자의 인증된 토큰 요청 거부, 120초 이후 새 토큰의 수신 및 비공개 모드의 20분 관찰이 남아 있다. 공개 접근 OFF는 해당 수신과 전환 게이트를 통과한 뒤 진행한다.

최소 변경 절차는 정상 로그인한 기존 참여자가 동의한 빈 방을 이용하는 것이다. 기존 토큰 API의 비공개 권한 발급·갱신에는 Realtime 세션·grant, 요청 제한 카운터와 일반 운영 로그가 남는다. 사용자·채팅방·메시지·첨부를 추가하거나 바꿀 필요 없이, 운영자가 그 세션의 유효한 개별 토픽에만 서버 REST Broadcast로 본문 없는 점검 이벤트를 보낼 수 있다. 앱이 처리하지 않는 점검 이벤트의 수신은 해당 브라우저의 WebSocket 프레임에서 확인한다. 처음 발급된 토큰의 120초가 지난 뒤 수신을 확인해 갱신을 입증하고, 후속 관찰 20분을 별도로 기록한다. 방이나 권한이 유일하게 확인되지 않거나 전환 검증에 실패하면 인증 API polling을 사용한다. JWT·쿠키·토픽은 운영 보고서에 기록하지 않는다. [Supabase REST Broadcast](https://supabase.com/docs/guides/realtime/broadcast)

후속 전환 준비에서 Production 배포·커밋, `polling`, 대기 마이그레이션 0, 활성 grant 0, Data API OFF를 확인했다. 이 시점의 읽기 전용 표본은 채팅방 5개, 메시지와 사진 참조 각각 0개다. 조회한 503은 모두 polling 중의 Realtime 토큰 API 응답이었다. 운영자는 기존 빈 방을 열고 최초 가입과 수신을 확인한다. [브라우저 및 발송 절차](../../scripts/regression/README.md#기존-참여자의-비저장-수신-확인)

`realtime-member-check.mjs`는 승인 실행기에서 기존 빈 방과 작업 시작 이후 발급된 단일 회원 grant를 확인한 후 Supabase REST 경로로 점검 이벤트 한 건을 전송한다. 서버 응답과 회원 수신을 따로 판정한다. Preview 리허설에서 회원 권한 소켓이 같은 nonce를 받았고 기존 검사와 합해 46/46을 통과했다. 초기 Windows 자식 프로세스 종료 문제는 REST 호출과 비동기 테스트 실행으로 수정했다. 한 실행에서 자동 정리가 실패한 Preview 계정 3개와 방 1개는 실행 명세와 소유 관계를 대조한 후 정리했고 남은 계정·방은 0개였다. 이 리허설에서 Production 앱 모드나 데이터는 변경하지 않았다.

### 51번 방 실제 메시지 수신과 48번 토큰 503 점검

운영자가 51번 방에서 기존 두 계정 간 메시지 전송 및 수신을 확인했다. 승인 실행기의 읽기 전용 DB 점검에서 2026-11-18 18:33:05 KST에 저장된 보고 내용과 일치하는 표시 가능 메시지 1개, 첨부 0개, 발신자의 참여 권한을 확인했다. 수신자 읽음 커서는 확인하지 못했다. 조회 가능한 Vercel 성공 요청 표본에는 51번 방의 수신자 GET 기록이 없어, 브라우저의 개별 요청과 polling 주기는 별도로 입증하지 못했다.

같은 배포의 최근 2시간 로그에서 503은 48번 토큰 경로 5건과 51번 토큰 경로 3건이었다. 두 방의 메시지 경로 5xx와 채팅 관련 error 로그는 0건이었다. `ChatRealtimeConfig.mode`는 `polling`이고 활성·전체 grant는 0개였다. 현재 배포 코드는 이 모드에서 토큰 발급을 거부하며, 브라우저는 별도 인증 메시지 API를 주기적으로 조회한다. 기존 JWKS와 Data API OFF도 확인했다. 이 결과는 채팅 저장 및 polling 모드에서의 사용자 관찰을 뒷받침하며, Production 회원 토큰의 실제 비공개 가입·수신·갱신과 비공개 관찰 20분은 남아 있다. Production 데이터나 모드를 변경하지 않았고 공개 접근 설정을 유지했다.

### 51번 방 Production 비공개 전환 시도 및 복구

2026-11-18 19:48 KST에 기존 배포 `dpl_9RGngoiirr63Yj2WMcFFMfTqdbVC`에서 애플리케이션 모드를 `private`로 바꿨다. 전환 직전 합성 토픽에서 Supabase 공개 접근 ON과 익명 비공개 가입 거부를 확인했다. 전환 전후 공개 접근 설정은 변경하지 않았다. 51번 방의 기존 메시지 1개를 읽기 전용으로 재확인했으며 발송 도구에는 명시한 기존 메시지 수가 일치할 때만 발송하는 옵션을 추가했다. 기본 동작은 빈 방만 허용한다. Preview 회원 수신을 포함한 회귀 46/46과 테스트 정리가 통과했다.

실제 Production 브라우저 가입 응답을 받지 못했고, 51번 방의 활성 grant와 전체 Realtime grant는 마지막 확인까지 0개였다. 전환 직후 확인한 5xx 표본에 신규 항목은 없었다. 회원 대상 일회성 이벤트는 발송하지 않았다. 19:53 KST에 기존 승인 실행기로 `polling`으로 복구했고 대기 마이그레이션은 0개였다. 일반 회원의 비공개 가입·수신, 인증된 비참여자 거부, 120초 이후 갱신 수신, 비공개 검증 후 20분 관찰, 공개 접근 OFF와 `PrivateOnly` 및 회원 재접속은 미검증이다. 메시지·사진·계정·방을 새로 만들거나 기존 활성 JWT 키를 변경하지 않았다.

### 51번 방 Production 회원 브라우저 재시도

운영자가 기존 계정의 51번 방을 열었다고 확인한 뒤 19:58:50 KST에 같은 배포의 `private` 모드를 켰다. 19:59:15에 새 회원 grant 1개가 생성됐다. 최초 만료는 20:01:15였고, 같은 grant의 만료가 20:02:45로 연장된 것을 원래 만료 이후 확인했다. 최초 발급 후와 120초 경과 후 각각 개별 토픽에 비저장 이벤트를 한 번씩 보냈고 두 요청 모두 Supabase에서 수락됐다. 기존 메시지는 1개로 유지됐다. 조회한 시험 구간의 error 및 5xx는 0개였다.

브라우저의 HTTP 상태, 가입 응답 및 두 수신값은 확인되지 않았다. 서버 수락과 grant 갱신은 회원 브라우저 수신으로 집계하지 않았다. 20:06:48 KST에 `polling`으로 복구했으며, 승인 실행기에서 활성 grant 0개와 대기 migration 0개를 확인했다. 공개 접근은 ON을 유지했다. 회원 가입·브라우저 수신, 인증된 비참여자 차단, 20분 관찰과 OFF 이후 재검증은 남아 있다. DevTools 네트워크 기록이 보존돼 있으면 추가 발송 없이 두 수신값을 이번 시험과 대조할 수 있다.

### Network 기록을 켠 51번 방 회원 검증

2026-11-18 20:44 KST에 브라우저 기록 준비 신호를 받고 앱의 비공개 시험 모드를 적용했다. 운영자가 51번 방의 실제 브라우저에서 토큰 HTTP 200과 비공개 가입 성공을 확인했다. 이전 시험에서 철회한 grant를 다시 발급하면 행 생성 시각은 유지되고 ID가 바뀐다. 운영 발송 도구가 이 유효한 권한을 놓친 원인을 확인하고, 생성 시각과 최대 토큰 수명으로 계산한 최신 발급 하한을 함께 확인하도록 수정했다. 수정한 도구로 유효한 권한 1개에 비저장 이벤트 1건을 보냈고 Supabase가 접수했다. 미래 시험 시각으로 조회했을 때 현재 권한은 선택되지 않았다.

브라우저 수신값을 기다리는 동안 공개 접근은 ON이며 기존 51번 방 메시지는 1개다. 이번 접수 응답은 회원 브라우저 도착 및 갱신 후 수신으로 집계하지 않는다.
