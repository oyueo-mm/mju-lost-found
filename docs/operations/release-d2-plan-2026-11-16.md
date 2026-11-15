# D-2 상세 구현 계획 — 아직 구현하지 않음

## 목표와 현재 근거

D-1 Production `cb3bb71`을 기준으로 임베딩 실행 통제와 이미지 변경 경로의 내부 HTTP 호출만 개선한다. 모델·입력 구성·벡터 차원·검색 점수·정렬·UI는 유지한다. D-3~D-5, 권한 정리, 신고 증거·백업 정책 변경은 제외한다.

현재 확인한 경로:

- `src/app/api/posts/[id]/route.ts` PUT: 인증·정지·소유권 검사는 있으나 별도 요청 예산과 공유 실행 잠금이 없다. `embedPostImageBestEffort`가 실패를 삼킨 뒤에도 사진 존재 여부로 `embedded`를 반환한다.
- `src/app/api/posts/[id]/image/route.ts`의 `triggerEmbeddingRecompute`: 첨부·대표 사진 변경 후 `after()`에서 `request.nextUrl.origin`에 PUT하고 사용자 Cookie를 전달한다. 목적지가 요청 URL에서 파생되며 재호출 제한·타임아웃·리다이렉트 차단이 없다.
- `src/lib/ai/postEmbedding.ts`: 텍스트와 사진의 추론·저장이 best-effort. `vectorSearch.ts`의 저장은 게시글 ID 조건만 사용하여, 추론 중 원본 변경/삭제/사진 제거와 경쟁할 수 있다.
- `src/lib/posts/aiService.ts`: 생성·텍스트 변경 시 `after()`로 텍스트 임베딩. `src/lib/images/service.ts`: 사진 변경/제거와 대표 사진 승격, 별도 벡터 초기화가 있다. 이 경로들도 오래된 작업의 덮어쓰기를 막아야 한다.
- Next 설정에는 모델 묶음을 새 함수에 넣었을 때 과거 Hobby 함수 수 상한을 초과했던 운영 근거가 있다. 이를 현재 플랫폼 제한이라고 단정하지 않고 실제 계정 설정·빌드 산출물을 다시 확인한다. 현재 `vercel.json`은 icn1을 지정하지만 빌드 지역과 실행 지역은 구분해야 한다.
- Production 최근 30일 재계산 PUT 34건, 평균 서버 시간 약 1,053ms라는 집계만 있다. 최대·p95·동시성·실패율은 아직 없으므로 예산과 lease 시간의 최적값을 확정하지 않는다.

## 1. 공통 실행 서비스와 권한 경계

새 `src/lib/ai/embeddingExecution.ts`에 실행 상태·중복 병합·입력 버전·예산·저장을 모은다. 요청에서 URL/벡터/actor를 신뢰하지 않고 서버에서 현재 글·소유권·정지·대표 사진을 조회한다. 수동 요청과 내부 자동 작업을 구분하되 내부 작업도 별도 서버 자격과 실제 변경 근거가 있어야 한다.

텍스트/이미지 모두 입력 fingerprint를 만든다. 텍스트는 실제 EMBEDDING_INPUT_FIELDS, 이미지는 검증된 현재 대표 이미지 URL, 각각 모델 revision/전처리 버전을 포함한다. 원문·원본 IP·세션은 작업 메타데이터에 저장하지 않는다. 동일 fingerprint의 완료 결과는 재사용하고, 같은 작업이 진행 중이면 합류한다. 캐시 무효화는 새 벡터가 실제로 저장된 뒤에만 수행한다.

게시글·사진 변경은 기존대로 먼저 저장하고 비동기로 처리하여 임베딩 실패가 게시글/업로드 성공을 뒤집지 않게 한다. 업로드/정렬 요청마다 추론하지 않고 최신 대표 사진 기준으로 합친다. 순서 변경 후 대표 사진이 같다면 추론하지 않는다.

## 2. 사용자별·게시글별 예산

- 기존 D-1 Postgres 원자적 예산 처리와 429/503 구분을 재사용한다. 수동 PUT은 인증·정지·소유권 확인 후 제한한다. 관리자/승인 외부 계정/활성 조직 담당자 staff 정책을 유지한다.
- 초기 검토안: 수동 재계산 일반 사용자 5/분·50/일, staff 20/분·500/일. 게시글에는 이미지/텍스트별 유효 실행 1개, 최신 pending 입력 1개만 유지한다. 동일 입력 재시도/진행 중 합류에는 새 모델 실행 예산을 부과하지 않는다.
- 이 숫자는 승인·실측 전 제안이다. 짧은 창 경계의 반복 실행도 막도록 완료 fingerprint와 공유 작업 상태를 함께 검사한다. 실제 이미지 변경의 자동 작업은 수동 한도를 공유해 정상 첨부가 막히지 않게 하며, D-1 업로드·게시글 생성 예산에 대응한 별도 실행 예산을 검토한다. 새 입력과 같은 입력의 재시도를 구분한다.
- 예산과 작업 claim은 한 짧은 DB 트랜잭션에서 처리한다. claim 실패/중복/예산 초과로 불필요한 예산이 소모되지 않아야 한다. 이를 위해 D-1 limiter의 트랜잭션 내부 admission 부분을 재사용 가능한 형태로 분리하되 기존 D-1 동시성·정리 실패 검사를 그대로 재실행한다.
- 예산 시스템/claim 저장 실패는 추론하지 않고 503. 자동 작업은 콘텐츠 저장을 유지하고 제한된 재시도 상태를 기록한다. 사용자 입력 오류·권한 오류는 기존 4xx를 유지한다.

## 3. 여러 인스턴스의 실행 잠금과 오래된 결과 차단

**전용 작업 테이블 1개를 추가하는 additive migration을 권고한다. 이는 D-2 구현 전 별도 승인 대상이며 이번 세션에서는 schema/SQL을 작성하거나 적용하지 않았다.**

예상 키는 `(postType, postId, kind)`. 필드는 desired/completed input hash, lease token, 단조 증가 generation, lease 만료, 상태, 제한된 재시도 횟수/다음 시각, 오류 분류, 생성/갱신 시각이다. 문자열 상태와 CHECK·유일키·필요 인덱스 중심으로 구버전과의 호환성을 유지한다. 원문이나 쿠키를 저장하지 않는다.

- 원자적 UPSERT/조건부 UPDATE로 claim하고 추론 중 DB 트랜잭션을 열어두지 않는다. 모델 추론 동안 사용자·게시글 행 잠금을 오래 보유하지 않는다.
- 성공 저장은 현재 원본 fingerprint와 현재 lease token/generation을 **같은 짧은 트랜잭션**에서 확인한 뒤 수행한다. 원본 변경은 즉시 generation을 갱신한다. 이미지 제거 시 벡터 null 처리와 generation 변경을 묶어 이전 worker가 되살릴 수 없게 한다.
- A→B 사진 변경, 대표 사진 승격, 삭제, 글 재수정 중 오래된 A 작업은 결과를 폐기한다. 같은 URL로 돌아오는 경우도 generation으로 오래된 작업을 구분한다. 텍스트 임베딩도 동일하게 적용한다.
- lease 만료·함수 종료·모델 오류에는 제한된 재시도/오류 상태를 남긴다. lease 시간은 실제 함수 maxDuration 및 추론 p99와 함께 정한다. 단순한 JS Map, RateLimitCounter를 잠금처럼 쓰기, pooler 위의 연결 불명확한 세션 advisory lock은 사용하지 않는다.
- lease만으로 worker 장애 시 물리적 exactly-once 추론을 보장할 수는 없다. 늦은 worker의 벡터 저장은 fencing으로 막고, 실행 시간 상한·재획득 유예로 중복 추론 위험을 줄인다. 장애 복구 조건까지 ‘중복 0’이라고 주장하지 않는다.
- pending을 DB에 저장하는 것만으로 자동 실행이 보장되는 것은 아니다. 정상 worker는 최신 pending을 제한된 횟수만 이어서 처리한다. 종료 후 남은 pending의 재전달 방법(현재 재계산 호출에서 복구 / 인증된 운영 재시도 / 별도 예약 실행)은 Preview 검증 전에 확정한다. 자동 복구가 필요하면 실제 플랜의 cron 제약과 비용을 확인하고 별도 운영 변경으로 제시한다. `after()`를 영속 큐로 취급하지 않는다.

## 4. 내부 HTTP 제거 우선, 불가 시 목적지 고정

첫 선택은 `after(() => embeddingExecution(...))`의 내부 함수 호출이다. Cookie 전달과 내부 네트워크 재인증 자체가 필요 없어지지만, 이미지 mutation 함수에 ONNX/model이 포함되어 함수 개수·크기·cold start 비용이 바뀔 수 있다. 구현 초기 Preview 빌드/배포에서 실제 trace·함수 수·용량을 검사하여 결정한다. 이 확인을 위해 Production 설정이나 큰 함수 옵션을 미리 켜지 않는다.

직접 호출이 현재 플랜/번들 제약으로 불가능하면 모델을 이미 포함한 기존 PUT endpoint를 worker 진입점으로 유지한다:

1. 목적지는 검증된 배포 설정 또는 신뢰하는 플랫폼 시스템 환경에서 얻은 **해당 환경의 불변 배포 URL**로 정한다. Host/X-Forwarded-Host/Origin/클라이언트 URL을 목적지에 사용하지 않는다. Preview→Production 교차 호출도 거부한다. 이동 가능한 고정 별칭만 쓰면 혼합 버전 배포 문제가 생기므로 불변 배포 URL을 우선한다.
2. 사용자 Cookie/Authorization을 복사하지 않는다. 서버 전용 환경별 서명 키로 목적·환경·actor ID·post type/id·입력 hash·generation·짧은 만료·nonce를 묶은 작업 증명을 보낸다. 작업 테이블 claim으로 재사용·동시 replay를 차단한다. 만료된 세션 Cookie에 의존하지 않으며 실행 시 현재 권한을 다시 검증한다.
3. 서명된 목적지와 path/method를 검증하고 리다이렉트 금지, 요청·응답 시간 상한, 제한된 응답 크기, 실패 분류를 둔다. query string에 비밀을 넣지 않는다. HTTP 성공과 실제 벡터 저장 성공을 구분한다.
4. Preview Deployment Protection이 막으면 공식 automation bypass의 최소 범위 자격을 헤더로만 사용한다. 보호 기능을 끄지 않는다. 새 서명/bypass 자격 또는 환경 설정은 별도 승인·배포 항목이며 로그에 남기지 않는다. 외부 URL로 자격을 보내지 않는 단정 검사를 추가한다.

기존 PUT의 `embedded` 응답은 실제 모델 실패를 구분하지 못한다. 하위 호환을 고려해 기존 요청 형태를 유지하고 `status`(completed/already_current/in_progress/failed 등)를 명시한다. 응답 코드/embedded 의미 변경은 호출자 및 16단계 검사와 함께 확정하고, 이미 저장된 콘텐츠의 성공 응답을 실패로 바꾸지 않는다. ‘사진 있음’을 ‘새 벡터 저장 성공’으로 보고하지 않는다.

## 5. 수정 대상

| 대상 | 예정 변경 |
| --- | --- |
| `src/lib/ai/embeddingExecution.ts` 및 테스트(신규) | claim·fingerprint·권한·입력 버전·예산·실행 결과 |
| `src/lib/ai/postEmbedding.ts`, `vectorSearch.ts` 및 테스트 | 조건부 저장, 오류 결과 구분, generation fencing |
| `src/app/api/posts/[id]/route.ts`, 테스트 | 수동 PUT 제한·중복 합류·결과 명시·내부 worker 검증 |
| `src/app/api/posts/[id]/image/route.ts`, 테스트 | 헤더 기반 목적지/Cookie 재호출 제거 |
| `src/lib/images/service.ts`, `src/lib/posts/aiService.ts`, 삭제 파생 데이터 정리 및 테스트 | 원본 변경/제거와 작업 generation 일치, 자동 텍스트/사진 경로 통합 |
| `src/lib/rateLimit/index.ts`, 테스트 | 실행 예산과 트랜잭션 재사용, 기존 staff·D-1 정책 보존 |
| `src/lib/recommendation/service.ts`, 테스트 | 실제 새 벡터 저장 시점의 invalidateRecommendationCache 호출과 순서 검증 |
| `prisma/schema.prisma`, 신규 migration | 전용 작업 테이블. 승인 전 미작성·미적용 |
| `next.config.ts`, 필요 시 `vercel.json` | 직접 호출 분기에서 모델 trace/실행 상한만. 크론/플랜 변경은 별도 검토 |
| `scripts/regression/preview.mjs`, README | 기존 16단계를 유지하며 중복·오래된 결과 시나리오 추가 |

UI나 모델 파일 변경은 기본 범위가 아니다. 신규 package 도입 없이 기존 Postgres/Prisma를 우선 사용한다.

## 6. 검증과 배포 게이트

1. 단위 검사: 429/503, staff, 권한/정지/비소유자, 같은 입력 합류, 모델 실패, 타임아웃, cache 무효화 순서. 외부 호스트·리다이렉트·서명 만료/환경 혼동에서 자격 전달 0을 확인한다.
2. Preview 독립 프로세스: 같은 글에 20개 요청→유효 worker 1개, 다른 글은 정책 내 독립 진행. lease 만료/이전 worker 귀환, claim DB 장애, 실패 후 재시도를 검증한다. 실제 모델 호출 횟수와 저장된 hash를 검사하고 단순 200만 세지 않는다.
3. 원본 경합: A 추론 중 B로 교체·순서 변경·전체 제거·게시글 삭제, 텍스트 연속 수정. 완료 후 현재 원본의 벡터만 남고 사진 제거 후 null이 다시 채워지지 않아야 한다.
4. 기관 담당자의 연속 등록·여러 사진 첨부·대표 사진 변경 시 최종 사진이 반영되고 재시도 루프/API 증폭이 없어야 한다.
5. 기존 전체 단위 테스트·타입·린트·빌드 및 정식 Preview 16단계 재실행. 배포된 Preview 로그인 수동 검증, 검색 상위 결과/점수 해시와 지연·함수 메모리/용량 비교. Data API는 OFF 유지.
6. 새 테이블 승인 후에는 암호화 백업의 실제 복원 DB에서 적용·롤백·재적용 리허설을 먼저 한다. additive 구조를 유지하고 구버전 롤백 때 작업 행·사용자 콘텐츠·증거를 임의 삭제하지 않는다.
7. Preview 통과 후 별도 Production 배포 승인. 새 테이블과 신/구 함수가 겹치는 동안의 조건부 저장 호환성도 확인한다. 구버전은 generation을 확인하지 않으므로 mixed-version worker를 차단하거나 기존 작업 종료를 기다린 뒤 활성화한다. 롤백은 기존 worker가 보호 로직을 무시할 수 있다는 한계를 명시하고 별도 운영 절차로 검토한다.

## 문서 근거

[Next after](https://nextjs.org/docs/app/api-reference/functions/after)는 요청 수명 연장을 설명하며 영속 큐를 보장하는 기능은 아니다. [Vercel 함수 제한](https://vercel.com/docs/functions/limitations)과 [큰 함수 지원 변경](https://vercel.com/changelog/vercel-functions-can-now-be-up-to-5-gb-in-package-size)은 기능·옵션에 따라 제약이 달라질 수 있음을 보여준다. [공식 automation bypass](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation)를 검토하되 이번 배포에서는 보호·플랜·환경 설정을 변경하지 않았다.
