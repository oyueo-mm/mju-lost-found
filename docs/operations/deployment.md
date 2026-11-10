# 배포·검증·롤백

환경·비밀 관리·백업·마이그레이션의 상세 기준은 [기존 운영 가이드](../operations.md)를 따릅니다. 본 문서는 현재 저장소의 CLI 스크립트와 UTM 검증 항목을 연결합니다. 이번 UTM 표준 작업에서는 **Production 배포를 수행하지 않습니다**.

## 배포 전

[DB 접근 보호와 통계 무결성 배포 게이트](database-safety.md)를 먼저 확인합니다. 보호 코드 통과가 과거 통계의 무결성을 증명하지는 않습니다. 현재 UTM Production 배포는 중단 상태이며, 본 작업에서는 Preview만 검증합니다.

1. 작업 트리, GitHub 원격 브랜치와 현재 Production·Preview의 실제 배포 ID를 기록합니다. `/api/version`과 배포 플랫폼의 메타데이터를 대조합니다. 미커밋 배포는 SHA만 믿지 않고 실제 소스 파일을 비교합니다.
2. Production에만 있는 변경, DB/의존성 변경, 비밀 파일 업로드 가능성을 검토합니다. `.vercelignore`의 환경 파일 제외를 유지합니다. 충돌이나 예상하지 못한 DB 변경이 있으면 배포하지 않습니다.
3. 아래 검사를 실행합니다.

```text
npm run operations:validate
npm test -- --maxWorkers=2
npx tsc --noEmit
npx eslint src scripts next.config.ts vitest.config.ts
npm run build
```

소스 범위 린트와 전체 `npm run lint`를 구분하여 기록합니다. 기존 `.vercel` 임시 파일의 오류를 새 소스 오류와 섞거나 검사를 통과했다고 생략하지 않습니다. 테스트 동시 실행 2개는 이 작업 환경의 메모리 부족을 피하기 위한 실행 옵션입니다.

## Preview

```text
node scripts/deployments/deploy.mjs preview --alias --dry-run
```

실제 Preview 배포와 고정 Preview 별칭 연결을 수행합니다. `--dry-run`은 이 스크립트의 **배포 후 DB 이력 recorder에 전달되는 옵션**이며 배포 자체를 생략하지 않습니다. 이 옵션을 빼면 recorder는 기본적으로 Preview DB의 DeploymentRecord를 기록합니다. 기존 앱 런타임의 자동 이력·통계 기록은 별개입니다.

현재 연결된 프로젝트와 CLI 로그인 상태를 먼저 확인합니다. Preview 빌드 성공뿐 아니라 승인된 등록부 선택, 실제 UTM 수집·DB 집계·통계 조회와 QR 파일 내용까지 검증합니다. 비로그인 테스트 브라우저와 관리자 브라우저를 구분하고 자동화 탐지에 의해 방문 비콘이 제외됐는지도 기록합니다. 테스트 계정·글이 필요하면 Preview에만 만들고 식별 가능한 범위만 정리합니다.

## Production 반영 시 별도 수행

Preview와 동일 실행 코드임을 확인하고 운영 반영이 승인된 작업에서만 기존 CLI의 `production` 대상 배포를 수행합니다. 이전 Production ID·URL·별칭·커밋, DB/환경변수 메타데이터를 먼저 기록합니다. GitHub 브랜치는 fast-forward 가능한 경우에만 동기화하고 강제 Push하지 않습니다. Git 연동 여부는 현재 프로젝트 설정에서 다시 확인합니다.

```text
node scripts/deployments/deploy.mjs production --dry-run
```

이 명령은 **실제 Production 배포**입니다. 이번 작업에서 실행할 명령이 아닙니다. `--db both --confirm-production`은 DB 쓰기 범위를 넓히므로 필요와 영향이 확인되지 않은 상태에서 추가하지 않습니다. 배포 후 `/api/version`, 주요 페이지, 관리자 권한, 실제 OAuth 복귀와 UTM, 새 집계의 측정 시작일을 확인합니다. 새 측정 코드의 시작일은 환경별 첫 일반 세션이 기록되기 전에는 미측정일 수 있습니다.

## 롤백

실행 직전에 확인한 이전 배포 URL을 사용합니다. 예전 보고서의 배포 ID를 영구 롤백 대상으로 복사하지 않습니다.

```text
npx vercel rollback <기록한-이전-Production-배포-URL> --yes
```

프로젝트 권한·배포 보존 상태·현재 CLI 도움말로 실행 가능 여부를 확인합니다. 롤백 후 실서비스 별칭과 `/api/version`을 재확인합니다. 앱 롤백은 DB 마이그레이션이나 이미 발급한 QR을 되돌리지 않습니다. 이번 v1.0은 DB 스키마 변경이 없어 역마이그레이션은 없으며, 이전 코드로 돌아가면 새 Content 수집만 중단될 수 있습니다. 기존 데이터는 삭제하지 않습니다.
