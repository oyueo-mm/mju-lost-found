# D-3 Production 전환 준비

2026-11-18 사용자가 승인한 운영 변경은 Production Supabase 신규 Standby 키 1개 추가와 해당 키의 Vercel Production 민감 변수 등록이다. 현재 앱은 D-2 `8baa381` 및 `dpl_HTtxjZJDDgka3HjTkRH6ZKQzR7EX`를 유지한다. 새 앱 배포와 공개 채널 중단에는 별도 승인이 필요하다.

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
