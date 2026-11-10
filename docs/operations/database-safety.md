# 개발·테스트 DB 접근 보호

2026-11-10 도입. [기존 운영 가이드](../operations.md)와 [배포 절차](deployment.md)에 추가되는 기준입니다. DB 스키마와 과거 통계는 변경하지 않습니다.

## 환경 로딩

Next의 우선순위는 프로세스 환경변수 → `.env.{NODE_ENV}.local` → `.env.local`(test 제외) → `.env.{NODE_ENV}` → `.env`입니다. `.env.preview.local`은 Next가 자동으로 읽지 않습니다. `NODE_ENV=production`은 로컬 빌드·`next start`에도 사용되므로 운영 배포의 증거가 아닙니다.

| 용도 | 연결 설정 | 허용 대상 |
| --- | --- | --- |
| 로컬 개발 | `.env.development.local` | Preview 프로젝트 또는 localhost PostgreSQL |
| 단위 테스트 | Vitest setup, mock | 실제 DB 연결 금지 |
| Preview | Vercel preview 환경변수 | 확정된 Preview 프로젝트 |
| Production 앱 | Vercel production 환경변수 | 확정된 Production 프로젝트 |
| 명시적 운영 스크립트 | `.env.operations-production` + 승인 실행기 | 승인한 작업에 한해 Production |

이번 작업 PC에서는 기본 `.env`의 자격 증명을 제거하고 기존 설정을 Git·배포 제외 대상인 `.env.operations-production`에 보존했습니다. 개발 설정에는 기존 Preview 연결을 사용합니다. 다른 운영자의 PC에는 이 로컬 파일 변경이 자동 반영되지 않으므로 인수인계 때 확인합니다. Preview도 공유 검증 DB이므로 무제한 쓰기를 허용한다는 뜻은 아닙니다. 개발 전용 disposable DB 도입을 권장합니다.

`.env.production.local`에 운영 비밀을 두면 로컬 `next build/start`가 다시 읽으므로 사용하지 않습니다. 쉘의 운영 환경변수는 파일보다 우선하지만 보호 검사가 중단합니다. 누락된 DB 설정에 운영 URL을 보충하는 fallback은 없습니다. 비밀 없는 빌드는 허용하되 실제 서버 시작에는 DB 설정이 필요합니다.

## 코드 보호

- `accessPolicy.mjs`: 실제 호스트와 pooler 사용자 식별자로 대상 판정. 비밀번호·쿼리 문자열의 프로젝트 코드로 허용하지 않으며 미확인 원격 DB는 거부.
- `predev`, Next config, instrumentation: 직접 `next dev/start`를 실행해도 서버 시작 검사. 로컬의 `NODE_ENV=production`만으로 운영 연결 불가.
- Prisma: hot reload의 전역 클라이언트 캐시 재사용 **전** 검사. Prisma CLI 설정에도 검사 적용.
- 직접 pg를 사용하는 저장소 스크립트 12개: `install-guard.mjs`로 실제 `Client.connect` 검사. Pool에도 적용. 백업의 `pg_dump`는 실행 전 별도 검사.
- Supabase REST/Storage 관리 스크립트: 별도 대상 검사.
- Vitest: 상속된 DB URL·서비스 키·운영 승인 값 제거, 실제 pg 연결 금지. 테스트 mock은 유지.

새 DB 스크립트에도 검사를 적용합니다. 회귀 테스트는 직접 pg 스크립트가 guard import를 잃으면 실패합니다. 이 장치는 실수 방지 수단이며 임의의 외부 프로그램이나 가드를 제거한 코드를 OS/DB 수준에서 통제하지 않습니다. 장기적으로 개발 PC의 운영 쓰기 자격 증명을 제거하고 제공업체의 읽기 전용 역할·자격 증명 분리를 추가해야 합니다.

## 승인된 운영 작업

운영 담당자는 실행 대상·예상 변경·백업·복구 방법을 검토하고 승인 참조를 남깁니다. 실행기는 참조의 존재와 형식을 검사하며 실제 결재 시스템·사용자 인증을 대신하지 않습니다. **이번 작업은 Production 쓰기나 배포를 승인하지 않습니다.**

```text
npm run operations:production -- --confirm-production --approval-reference CHANGE-123 -- scripts/deployments/record.mjs --db production --confirm-production --dry-run
```

위 예시는 recorder의 dry-run입니다. 실행기는 운영 파일을 명시적으로 읽고 pg guard를 preload하여 저장소 내 `.mjs` 운영 도구만 실행합니다. Next 서버·단위 테스트는 허용하지 않습니다. 각 도구의 기존 `--apply`, `--confirm-production` 등도 여전히 필요합니다. 운영 Prisma CLI·TypeScript 도구는 이 실행기의 허용 대상이 아니므로 별도 검토한 실행 경로를 마련해야 합니다. 접속 값·쿠키를 출력하거나 채팅으로 전달하지 않습니다.

## 통계 무결성 배포 게이트

Production의 `meta.since.utm_content`는 2026-11-09/value=1이며 방문 통계와 같은 마지막 행 버전 트랜잭션 번호를 가집니다. 번호만으로 기록 주체를 확정하지 않습니다. 현행 Production은 이 표식을 판독하지 않습니다. 기존 표준 구현은 최소 표식 날짜를 시작일로 사용해 배포를 보류했으며, 후속 구간 분리 구현은 새 키만으로 신규 시작일을 결정합니다.

정확한 테스트 증가량을 복원하지 못했으므로 기존 행 삭제·감산·시작일 변경을 하지 않습니다. 기존 익명 방문·흐름·DB 지연 통계가 영향을 받았을 가능성을 기록합니다.

다음 분리 설계는 후속 작업에서 **구현하여 Preview에서 검증**합니다. Production에는 적용하지 않습니다. 실행 키·일별 관측·활성화·롤백의 현행 기준은 [Content 신규 측정 구간](content-measurement.md)을 따릅니다.

1. 첫 정식 Production Content 측정에 별도 release/epoch 식별자를 부여합니다.
2. 시작 표식뿐 아니라 Content·campaign×Content 카운터도 새 namespace로 분리합니다. 표식만 바꾸면 같은 날의 과거 카운터가 섞일 수 있습니다.
3. 승인된 배포 이후 새 namespace의 첫 유효 일반 세션부터 측정합니다. 시작일은 부분 측정으로 표시하고 기존 namespace는 출처 미확인 과거 자료로 별도 유지합니다. 자동 합산하지 않습니다.
4. 기존 Source·Medium·Campaign, 전체 세션 중복 방지와 관리자 제외는 유지합니다. 새 namespace는 기존 MetricDaily 구조로 표현할 수 있어 스키마 변경 없이 설계 가능합니다.
5. 실제 시작 시각·행 변경 시각·배포 시각은 다릅니다. 더 정확한 시각 기록이 필요하면 개인정보 없는 릴리스 메타데이터를 검토합니다.

신규 구간의 Preview 검증 완료 후에도 Production 배포는 별도 승인된 작업에서만 수행합니다. 정확한 과거 원인과 증가량은 미확인으로 보존합니다.
