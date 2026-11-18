# D-3 전환·복구 실행 절차

이 문서는 조건부 배포용 실행 절차다. 실행 상태와 단계별 승인 범위는 [Production 전환 기록](release-d3-production-preparation-2026-11-18.md)을 참조한다. 현재 Production은 D-3 인증 API polling으로 운영 중이다.

Production 신규 Standby 준비와 Vercel 민감 변수 등록은 [Production 전환 준비 기록](release-d3-production-preparation-2026-11-18.md)을 따른다. 배포, 공개 접근 OFF, 운영 DB 변경은 별도의 전환 승인 범위에서 실행한다.

현재 Production 키는 Vercel에 Production 전용 Secret으로 등록됐다. [확정된 실행 순서와 중단 조건](release-d3-production-preparation-2026-11-18.md#승인-후-실행-순서와-중단-조건)을 따른다. 이번 전환의 24시간 사전 공지는 사용자의 승인에 따라 생략했다. 공개 접근 OFF는 비공개 연결·갱신 및 20분 관찰을 통과한 뒤 실행한다.

2026-11-18 Preview에서 `Allow public access to channels`를 OFF로 전환했다. 공급자의 `PrivateOnly`, 기존 Standby 키의 private 구독·수신·권한 회수와 갱신은 hosted 검사 45개, Chromium 12개와 통합 회귀 16단계로 확인했다. 구버전 탭은 실제 가입 거부를 받은 상태에서 수동 전환 리허설을 통과했다. [후속 보고](release-d3-standby-2026-11-18.md)를 참조한다.

## 상태와 기본 순서

`release-d3.mjs`는 checksum이 일치하는 기존 이력과 지정 D-3 6개 migration만 허용한다. 실패 후 rolled-back 이력은 보존하고, 미완료 이력/임의 baseline/다른 migration은 거부한다. Preview의 문서화된 과거 identity migration은 D-2와 같은 정확한 LF/CRLF checksum만 허용한다.

```powershell
node --env-file=.env.preview.local scripts/operations/release-d3.mjs preflight
node --env-file=.env.preview.local scripts/operations/release-d3.mjs migrate --apply --confirm-preview
```

상태 조회는 새 역할의 앱·Storage 테이블 실효 권한 0, 신규 세 테이블 RLS ON/정책 0, 전용 receive-only SELECT 정책/함수 ACL도 확인한다. 새 역할을 예약 관리자 역할이나 authenticator에 부여하지 않는다. public API 설정과 기존 잔여 권한을 변경하지 않는다.

신뢰된 Preview 키 등록 뒤에만 공개 kid를 지정하여 새 설정을 켠다. JWKS에 해당 ES256/P-256 kid가 없으면 거부한다. **JWKS 게시만으로 실제 Realtime 수용이 입증되는 것은 아니다.** 정상 회원 JWT의 실제 구독·수신·갱신과 타 API 거부를 계속 검사해야 한다.

```powershell
node --env-file=.env.preview.local scripts/operations/release-d3.mjs private --kid <VERIFIED_PUBLIC_KID> --apply --confirm-preview
```

mode/key 변경은 설정 행을 독점 잠근 뒤 기존 grant를 회수한다. 발급/송신은 같은 행의 shared lock을 먼저 잡아 변경 중 새 grant가 회수에서 빠지는 경쟁을 차단한다. 세션→grant의 잠금 순서를 유지한다. 정상 권한 회수는 이미 승인된 HTTP 송신이 끝난 뒤 commit되며, 회수 commit 뒤 새 송신을 허용하지 않는다. 개별 HTTP 송신 timeout은 1.5초다. 여러 grant/송신이 얽힌 전체 회수 transaction의 지연이 1.5초 이하라고 주장하지 않으며 실제 부하·lock 대기 측정은 별도 게이트다. 이미 전송 중인 네트워크 패킷은 회수할 수 없다. 클라이언트 payload는 본문 없는 힌트이고 실제 상태는 인증 API로 확인한다.

## Production 필수 게이트

1. Preview 서명키 실제 등록·회원 role 전환·private 전달·동시성·권한 회수·토큰 만료/교차 환경·직접 발행 차단·다중 탭/장시간 연결 검증을 완료한다. 서버 관리자 대조군으로 private 전달이 된 것과 일반 회원 토큰 검증을 구분한다.
2. 16단계 회귀를 실제 private 수신으로 통과시킨다. 키가 없다는 이유로 public/polling 성공을 11단계 통과로 바꾸지 않는다. 전체 단위/타입/린트/빌드 및 이전 클라이언트 전환 검증을 완료한다.
3. **Production 신규 서명키의 별도 승인**을 받은 후 환경마다 다른 키를 등록한다. Preview 키를 Production에 복사하지 않는다. 기존 활성 키·provider·Auth.js secret을 변경하지 않는다.
4. 원격/Production 버전/롤백 대상을 확인하고 최신 암호화 Production 백업을 생성하여 checksum·실제 복원·D-3 rehearsal을 완료한다. 기존 과거 백업 rehearsal을 새 백업으로 잘못 기록하지 않는다.
5. 아래 작업은 모두 기존 승인 실행기로 수행한다. migration 먼저, 검증한 앱 배포, private 정상 동작 확인, 최종 public OFF 순서다. 전환 중 public/private 이중 송신을 보안 완료로 취급하지 않는다.

```powershell
node scripts/db/approved-operation.mjs --confirm-production --approval-reference RELEASE-D3-PREFLIGHT -- scripts/operations/release-d3.mjs preflight
# 모든 게이트와 키 승인이 완료된 경우에만:
node scripts/db/approved-operation.mjs --confirm-production --approval-reference RELEASE-D3-MIGRATE -- scripts/operations/release-d3.mjs migrate --apply --confirm-production
# 실제 Production 배포. --dry-run은 배포 이력 쓰기만 생략한다.
node scripts/deployments/deploy.mjs production --dry-run
# polling 상태의 배포를 검증한 다음 Production 비공개 연결을 켠다.
node scripts/db/approved-operation.mjs --confirm-production --approval-reference RELEASE-D3-PRIVATE -- scripts/operations/release-d3.mjs private --kid c455ce27-da9f-42e8-ab62-00d443e55979 --apply --confirm-production
```

서버 mode 변경은 새 메타데이터만 변경한다. 메시지·게시글·사진·사용자 권한·신고 증거를 변경하지 않는다. Realtime 프로젝트 설정 변경은 인증된 관리 도구로 정확히 해당 프로젝트에서 수행하고, Data API OFF와 기존 설정의 불변성을 재확인한다.

### Production 신규 키 등록 범위

별도 승인 후 Production `tmifqtyxojtuoejxjrng`을 확인하고, 승인된 로컬 비밀 저장 절차로 Preview와 다른 신규 ES256 키를 생성한다. Production 프로젝트의 **Project Settings → JWT Keys → JWT Signing Keys**에서 **Create standby key → ES256 (ECC) → Import an existing private key**로 가져온다. 공개 `kid`와 좌표를 JWKS로 확인하고 같은 개인키는 Vercel Production 전용 `MJU_REALTIME_PRIVATE_JWK` 민감 변수로 한정해 등록한다. 키는 Standby에 두며 기존 활성 키의 회전·폐기·삭제는 승인 범위에 포함되지 않는다. 키 등록에 대한 승인은 별도의 배포·DB 마이그레이션·Realtime 설정 변경 승인으로 확대하지 않는다. [Supabase 서명키 문서](https://supabase.com/docs/guides/auth/signing-keys)

## 장시간 열린 구버전 탭

D-2의 기존 JS에는 private 토큰 발급이나 API 주기 조회가 없다. 새 서버 코드를 배포하거나 public 접근을 닫는 것만으로 이미 실행 중인 JS를 자동 업그레이드할 수 없다. 숨김 채널 이름·TTL·서버-only 새 이벤트가 이 문제를 해결한다고 가정하지 않는다. 강제 reload로 작성 중 텍스트/사진 선택을 잃게 해서는 안 된다.

2026-11-18 Chromium에서 D-2 `8baa381` 빌드의 실제 공개 채널 가입을 확인한 뒤, 기존 탭을 유지한 채 같은 로컬 주소의 서버를 D-3으로 전환했다. 구형 채널 이벤트 수신을 테스트 탭에서만 억제하자 기존 메시지 목록은 멈췄지만 텍스트와 선택한 사진 미리보기는 보존됐다. 같은 로그인 세션으로 새 탭을 열어 텍스트를 복사하고 원본 사진을 다시 선택한 뒤, 인증 API polling으로 새 메시지를 받았다. 절차와 실행 방법은 [회귀 검사 문서](../../scripts/regression/README.md#d-2-열린-탭-전환-리허설)에 있다.

운영 전환 전에는 새 탭으로 이동하는 절차를 안내한다. 작성 중이면 기존 탭을 열어 둔 상태로 같은 대화를 새 탭에서 열고, 작성한 텍스트를 복사하고 원본 사진을 다시 선택한다. 새 탭에서 초안과 사진을 확인한 후 기존 탭을 닫는다. 이미 열린 D-2 화면은 자동 전환되지 않으므로 배포 시 강제 새로고침을 사용하지 않는다. Preview 공개 접근 OFF 이후 D-2 빌드가 실제 공급자의 `PrivateOnly`를 받는 상태에서 같은 전환 절차 5개를 다시 통과했다.

D-3에서는 실시간 연결이 끊기면 채팅 화면에 재연결과 주기적 조회 상태를 표시한다. 같은 화면에서 인증 API로 새 메시지를 조회하고 비공개 연결이 회복되면 안내를 지운다. 이미 실행 중인 D-2 화면 안에 서버가 새 배너를 표시할 수 있는 경로는 없다. 이번 전환에서도 아래 안내 문안과 초안 보존 절차를 사용한다.

안내 문안: “채팅 연결 방식이 업데이트됩니다. 업데이트 이후 열어둔 채팅에 새 메시지가 표시되지 않으면 기존 탭을 둔 채 같은 대화를 새 탭에서 열어주세요. 작성 중인 글은 복사하고 원본 사진은 새 탭에서 다시 선택해주세요. 초안과 사진이 보이는 것을 확인한 뒤 기존 탭을 닫아주세요.”

## 안전한 롤백

private/public 차단 이후에는 D-2 앱을 무조건 다시 배포해 공개 채널을 여는 방식을 사용하지 않는다. 검증된 D-3 앱을 유지하고 다음과 같이 인증 API polling으로 전환한다.

```powershell
node scripts/db/approved-operation.mjs --confirm-production --approval-reference RELEASE-D3-POLLING-ROLLBACK -- scripts/operations/release-d3.mjs polling --apply --confirm-production
```

새 앱은 갱신 실패 때 소켓을 닫고 인증 API를 제한된 주기로 조회한다. public OFF 이후 앱도 되돌려야 하는 경우 인증 polling에서 검증한 Production 배포 `dpl_9RGngoiirr63Yj2WMcFFMfTqdbVC`를 사용한다. 새 테이블과 증거는 보존하고 회수한 grant와 세션은 비활성 상태로 유지한다. D-2 배포 `dpl_HTtxjZJDDgka3HjTkRH6ZKQzR7EX`는 **public OFF 이전** 기준 롤백으로 보존한다.

DB 장애로 로그아웃 회수 기록 자체가 commit되지 못하면 Auth.js는 쿠키 삭제를 계속할 수 있다. DB 장애 중 서버 송신은 fail-closed지만, 회수 commit이 없는데 즉각 철회됐다고 주장하지 않는다. 최대 120초 토큰 수명과 이 장애 시나리오의 실제 제공자 동작을 별도로 검증하고 남은 위험으로 보고한다.
