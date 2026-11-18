# D-3 서명키 등록 승인 경계

2026-11-16 확인: 두 Supabase 프로젝트는 각각 ES256 공개 JWKS 키를 제공한다. Vercel에는 앱이 사용할 별도 Realtime 서명키 설정이 없다. 기존 Supabase private key를 추출하거나 Auth.js AUTH_SECRET/service_role 키를 새 사용자 토큰의 서명용으로 사용하지 않는다.

## 현재 승인·실행 상태

사용자의 승인 범위는 **Preview 신규 키 추가만**이다. Production 키 등록은 승인되지 않았다. 2026-11-18 사용자가 대시보드에서 Preview `swqvlihgupranzfzjevb`에 공개 kid `c0eb51e4-97b9-4d13-b042-1a820650d257`를 Standby로 가져왔음을 확인했다. 공개 JWKS의 kid/alg/kty/crv/x/y가 기존 로컬 DPAPI 키와 일치했으며 **실제 일반 회원 역할의 private 구독과 서버 이벤트 수신이 성공했다.** 활성 키의 회전·교체·폐기는 하지 않았다. Vercel Preview에만 `MJU_REALTIME_PRIVATE_JWK`를 sensitive 변수로 stdin 등록했고 Production 변수는 변경하지 않았다. [대시보드 절차](realtime-dashboard-registration.md)를 따른다. 수동 키는 `.vercel/realtime-preview-manual.dpapi`이며 아래 API 자동 등록 경로와 혼용하지 않는다.

수동 가져오기 이후에는 `register-preview-realtime-environment.mjs --confirm-preview`로 변경 없는 준비 검사를 수행하고 승인된 경우에만 `--apply`를 사용한다. 고정된 로컬 키·Preview DB/Storage·공개 JWKS를 확인하고 링크된 Vercel 팀에서 Preview 변수만 추가한다. 기존 동명 변수에 대응하는 자신의 등록 기록이 없으면 덮어쓰지 않는다. 실제 등록은 완료됐으므로 재실행으로 새 키를 생성하지 않는다. 실제 대시보드의 Standby 상태는 사용자의 확인이며 관리 API로 기존 키 목록/상태를 추가 조회한 것은 아니다.

`node scripts/operations/register-preview-realtime-key.mjs`는 변경 없는 준비 검사다. 실제 실행은 기존 관리 인증을 가진 Windows 환경에서 `--apply --confirm-preview-only`가 모두 필요하다. 관리 인증이 없으면 키 생성 전에 중단한다. Production 인자는 거부한다. private JWK 체크포인트는 Windows CurrentUser DPAPI로 암호화하여 Git/배포에서 제외된 `.vercel`에만 보관하고, Vercel 등록은 stdin을 사용한다. stdout/명령행/로그에 키를 출력하지 않는다. 불명확한 부분 성공 시 중복 키 생성이나 기존 변수 덮어쓰기를 거부한다. 이 도구의 관리 API 실제 등록 성공은 아직 미검증이다.

## 별도 승인 요청 대상

- Preview 및 Production에 **서로 다른 신규 ES256/P-256 키** 각 1개를 추가한다. 먼저 Preview에서 검증하고 Production은 D-3 전체 게이트 통과 후 수행한다.
- Supabase signing-keys API의 **standby import만** 사용한다. 기존 in_use/previously_used 키를 교체·rotate·revoke·delete하지 않는다. 기존 Google/Auth.js 인증 제공자·세션키·Storage URL 서명키를 변경하지 않는다.
- 해당 키의 private JWK를 각 Vercel 환경의 **MJU_REALTIME_PRIVATE_JWK**에 민감 변수로 등록한다. 공개 kid와 project만 운영 메타데이터로 기록한다. private JWK·PAT·발급 JWT는 로그·Git·클라이언트에 남기지 않는다.
- 실제 Supabase Realtime에서 standby 키의 서명 수용을 Preview로 먼저 입증한다. 기존 활성 키를 바꿔야 한다면 그 변경은 진행하지 않고 별도로 보고한다.
- 관리 API 접근은 기존 인증된 관리 수단만 사용한다. 새로운 PAT 발급/자격증명 변경 또는 사용할 수 있는 관리 수단이 없으면 해당 부분을 별도로 남긴다. 비밀값을 채팅으로 요청하지 않는다.

생성/검증용 단위 테스트 키는 메모리에서만 사용하며 프로젝트에 등록하지 않는다. 키 등록 승인 전에도 코드·RLS·로컬 암호학 검증·Preview SQL 권한 검사·인증 API polling 대체 경로·브라우저 검증을 계속할 수 있다. 실제 private WebSocket 성공 검증과 Production 전환은 서명 신뢰 등록 전까지 완료로 표시하지 않는다.

키 등록은 신뢰 대상을 늘리는 보안 변경이다. 새 토큰의 역할은 mju_chat_realtime으로 고정한다. Supabase의 예약 역할을 수정하지 않고 새 역할에 필요한 realtime USAGE/SELECT와 자체 정책 함수 EXECUTE만 부여한다. authenticator·Storage 관리자·기존 사용자 역할에 멤버십을 추가하지 않는다. 실제 Realtime 서버의 역할 전환과 타 API 접근 차단은 Preview에서 검증한다.

Preview 진단에서 관리 역할에 새 역할을 부여하려는 GRANT는 예약 역할 보호로 거부됐다. 해당 DDL은 전체 롤백됐으며 우회하지 않았다. 현재 postgres에는 관리 역할로 전환하지 않고도 realtime.messages의 SELECT grant/정책과 schema USAGE를 지정할 권한이 있어 이 최소 경로만 사용한다. 보호 역할 자체와 그 멤버십은 그대로다.

[Supabase 키 추가 API](https://supabase.com/docs/reference/api/v1-create-project-signing-key), [서명키/외부 발급 JWT](https://supabase.com/docs/guides/auth/signing-keys).
