# D-3 전환·복구 실행 절차

이 문서는 조건부 배포용 실행 절차다. 문서와 명령의 존재 자체는 승인이 아니다. 최신 승인 경계는 [서명키 등록안](realtime-signing-registration.md)을 따른다. 현재 Production은 D-2이고 D-3 운영 변경은 수행하지 않았다.

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
```

서버 mode 변경은 새 메타데이터만 변경한다. 메시지·게시글·사진·사용자 권한·신고 증거를 변경하지 않는다. Realtime 프로젝트 설정 변경은 인증된 관리 도구로 정확히 해당 프로젝트에서 수행하고, Data API OFF와 기존 설정의 불변성을 재확인한다.

## 장시간 열린 구버전 탭

D-2의 기존 JS에는 private 토큰 발급이나 API 주기 조회가 없다. 새 서버 코드를 배포하거나 public 접근을 닫는 것만으로 이미 실행 중인 JS를 자동 업그레이드할 수 없다. 숨김 채널 이름·TTL·서버-only 새 이벤트가 이 문제를 해결한다고 가정하지 않는다. 강제 reload로 작성 중 텍스트/사진 선택을 잃게 해서는 안 된다.

Production 전환 전에 기존 탭을 실제 브라우저에 유지한 상태의 리허설을 수행해야 한다. 새 polling 지원 앱을 먼저 확보하고, 구버전 사용자가 작성 중 내용을 보존한 채 새 버전으로 이동할 구체적인 경로를 검증한다. 새 앱이 동작했다는 이유로 구형 탭의 무중단 전환을 통과로 처리하지 않는다. 이 게이트가 미해결인 상태에서 public OFF/Production 배포를 강행하지 않는다.

## 안전한 롤백

private/public 차단 이후에는 D-2 앱을 무조건 다시 배포해 공개 채널을 여는 방식을 사용하지 않는다. 검증된 D-3 앱을 유지하고 다음과 같이 인증 API polling으로 전환한다.

```powershell
node scripts/db/approved-operation.mjs --confirm-production --approval-reference RELEASE-D3-POLLING-ROLLBACK -- scripts/operations/release-d3.mjs polling --apply --confirm-production
```

새 앱은 갱신 실패 때 소켓을 닫고 인증 API를 제한된 주기로 조회한다. 필요하면 같은 보안 특성을 가진 polling 호환 배포를 보존한 뒤 그 배포로 앱만 되돌린다. 새 테이블/증거를 drop하거나 grant·세션을 복원해 오래된 토큰을 되살리지 않는다. D-2 배포 `dpl_HTtxjZJDDgka3HjTkRH6ZKQzR7EX`는 **public OFF 이전** 기준 롤백으로 보존한다. public OFF 이후의 안전한 polling Production 배포 ID는 실제 조건부 배포가 끝난 뒤 기록해야 하며 현재는 없다.

DB 장애로 로그아웃 회수 기록 자체가 commit되지 못하면 Auth.js는 쿠키 삭제를 계속할 수 있다. DB 장애 중 서버 송신은 fail-closed지만, 회수 commit이 없는데 즉각 철회됐다고 주장하지 않는다. 최대 120초 토큰 수명과 이 장애 시나리오의 실제 제공자 동작을 별도로 검증하고 남은 위험으로 보고한다.
