<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# MJU Find 자율 작업 및 운영 안전 정책

아래 정책은 승인된 목표와 작업 범위 안에서 적용한다. 최신 사용자 지시와 플랫폼 권한 정책을 우선하며, 상시 허용 목록 자체가 새로운 Production 작업의 승인을 뜻하지 않는다.

## 자율 작업 원칙

- 승인된 목표와 작업 범위 내에서 독립적으로 판단하고 작업한다.
- 사소한 기술적 판단, 구현 방법, 파일 수정, 테스트 실행 등에 대해 반복적으로 사용자에게 질문하지 않는다.
- 합리적인 기본값을 선택하고 결정 사항과 근거를 최종 보고서에 기록한다.
- 계획 수립 → 구현 → 테스트 → 오류 수정 → 재검증 → Preview 배포를 중간 승인 없이 진행한다.
- 테스트가 실패하면 원인을 분석하고 수정한 뒤 다시 검증한다.
- 이미 승인된 작업에 대해 동일한 승인을 반복 요청하지 않는다.
- 일부 작업이 차단되더라도 독립적으로 수행할 수 있는 다른 작업을 계속 진행한다.
- 사용자 확인이 필요한 사항은 가능한 한 모아서 한 번에 질문한다.
- 실제로 필요한 경우가 아니라면 중간 결과만 보고하고 작업을 종료하지 않는다.
- 단순히 시간이 오래 걸린다는 이유로 작업을 중단하거나 다음 세션으로 미루지 않는다.
- 플랫폼의 권한 정책이나 기존 보안 장치를 우회하지 않는다.

## 별도 승인 없이 진행할 수 있는 작업

해당 작업의 목적과 승인 범위 내에서 다음 작업을 상시 허용한다.

- 저장소 및 운영 문서 분석
- 구현 계획 수립
- 코드 수정 및 신규 파일 생성
- 리팩터링 및 오류 수정
- 의존성 설치 및 업데이트
- 단위·통합·회귀·보안 테스트
- 로컬 서버 실행 및 빌드
- 작업 브랜치 생성 및 로컬 커밋
- 해당 작업 브랜치의 일반적인 원격 Push
- Preview DB의 하위 호환 가능한 마이그레이션
- Preview 전용 독립 테스트 계정 및 데이터 생성
- 자신이 생성한 테스트 데이터의 검증 및 정리
- Preview 배포 및 재배포
- 운영 문서 작성 및 갱신
- 기존 승인 정책에 따른 읽기 전용 백업 및 복원 검증
- 조회 범위가 이미 승인된 로그와 운영 상태 확인

테스트 데이터는 생성 시점부터 ID와 경로를 기록하고, 기존 데이터와 구분하여 안전하게 정리한다.

## Production 배포 정책

사용자가 특정 릴리스의 Production 배포를 사전에 승인했다면 다음 조건을 모두 충족하는 경우 추가 승인 없이 배포한다.

- 전체 필수 테스트 통과
- Preview 검증 통과
- 기존 기능 및 데이터와 호환
- 보안 회귀 테스트 통과
- 롤백 대상 확보
- 필요한 백업 및 실제 복원 검증 완료
- 기존 Production 접근 보호 정책 준수
- 사전에 승인된 DB 변경 범위 준수

배포 이후에도 검증을 계속 수행하며, 문제가 있으면 승인된 롤백 절차에 따라 안전하게 대응한다.

## 반드시 별도 승인이 필요한 작업

- 사전에 승인되지 않은 Production 배포
- 사전에 승인되지 않은 Production DB 마이그레이션
- 실제 Production 사용자 데이터 삭제 및 일괄 변경
- Production DB 권한, RLS, GRANT, REVOKE 변경
- 인증 체계 및 접근 보호 정책의 중대한 변경
- 비밀키 및 자격증명 변경
- 새로운 유료 서비스 도입 및 결제
- 강제 Push, Git 이력 파괴
- 백업 원본의 임의 삭제
- 복구 불가능하거나 영향 범위가 불명확한 작업
- 기존 보안 장치의 비활성화

## 수동 검증 정책

- 가능한 경우 E2E 테스트와 자동 브라우저 검증으로 대체한다.
- 로그인 상태 검증은 승인된 Preview 테스트 계정을 활용한다.
- 실제 사용자 계정이나 인증 비밀키를 무단으로 사용하지 않는다.
- 직접 수행할 수 없는 사용자 검증은 다른 검증을 모두 마친 뒤 요청한다.
- 수동 검증이 필수 배포 조건이라면 통과한 것으로 임의 판단하지 않는다.
- 수동 검증을 기다리는 동안 독립적으로 진행할 수 있는 작업을 수행한다.

## 테스트 및 인수인계 정책

- 기존 테스트를 삭제하거나 약화하지 않는다.
- 실패를 숨기기 위해 기대값이나 통과 기준을 변경하지 않는다.
- 재사용 가능한 검증 스크립트는 임시 폴더가 아닌 Git 저장소에서 관리한다.
- 실행 방법, 환경 요구사항, 검증 기준을 문서화한다.
- Claude Code와 Codex 사이에서 작업을 전환하더라도 같은 작업을 불필요하게 반복하지 않도록 한다.
- 현재 작업 상태, 미완료 항목, 커밋, 배포 상태를 운영 문서에 기록한다.

## 보고 정책

작업 완료 후 다음 내용을 종합적으로 보고한다.

- 완료한 작업
- 수정 파일 및 커밋
- 테스트 및 검증 결과
- 자체적으로 결정한 사항과 근거
- 발견한 문제와 해결 결과
- Preview 및 Production 배포 상태
- 성능 변화
- 데이터 변경 여부
- 미검증 항목 및 남은 위험
- 롤백 방법
- 다음 작업
