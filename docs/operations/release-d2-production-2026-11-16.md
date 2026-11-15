# D-2 Production 배포·최종 검증 — 2026-11-16 KST

## 현재 상태

| 대상 | 상태 |
| --- | --- |
| Production | **8baa381605638ff7bde97446732083f47589c3b3** / **dpl_HTtxjZJDDgka3HjTkRH6ZKQzR7EX**, READY |
| Production URL | https://mju-find.vercel.app/ → https://mju-lost-found-vercel-gj3tfw6v1-oyueo.vercel.app/ |
| 검증 Preview | **4d5676b5919ca47ef905c823aa580036e07e9fbb** / **dpl_56u1sQBsqfsRNfd5qqNnVNYZFYFS**, READY |
| Preview URL | https://mju-lost-found-preview.vercel.app/ → https://mju-lost-found-vercel-6adf4bj0j-oyueo.vercel.app/ |
| 보존한 D-1 롤백 | cb3bb71184d1c7d534827cdf7660a15cede81569 / dpl_A8boERKr9cxihEsv5Wp6pmkqovRK |
| 작업 브랜치 | fix/release-d2-embedding-control, 일반 Push 완료. main 병합·강제 Push 없음 |
| 백업 작업 트리 | ops/backup @ 15e294e, 별도 작업 트리 및 원격 브랜치 유지 |

Preview 이후 Production 커밋 사이 변경은 운영 도구·문서·로컬 리허설 fixture다. src, Next 설정, vercel.json, Prisma 모델/실제 migrations, package/lock의 앱 동작 차이는 없다. 후속 최종 보고 커밋도 Production 재배포를 요구하지 않는다. D-3는 분석·설계만 완료했다.

## 인수 상태 확인과 자율 작업 정책

시작 시 8f8281b의 깨끗한 작업 트리, D-1 Production cb3bb71/dpl_A8bo..., D-2 이전 Preview dpl_9PVK..., ops/backup의 공유 snapshot 수정 15e294e를 확인했다. 원격에는 D-2/ops 브랜치가 아직 없었으며 D-1 원격은 458ea91이었다. Vercel Git 연동은 없으므로 Push가 Production을 자동 배포하지 않는다.

c5e6f7d에서 AGENTS.md와 CLAUDE.md에 사용자 요청 정책 전체를 동일하게 추가했다. Next가 관리하는 기존 블록과 CLAUDE의 @AGENTS.md 포함을 보존했고 두 정책 본문 일치를 검사했다. 상시 허용은 승인 목표 안에서만 적용하고, 미승인 Production·권한/키/비가역 변경은 별도 승인을 요구한다. 기존 운영 문서의 과거 UTM 작업 한정 금지는 D-2에 대한 최신 명시적 승인과 구분한다. 플랫폼 권한·DB 접근 가드·백업 standing 정책은 변경하지 않았다.

## 발견·수정한 문제와 결정 근거

1. **D-1의 잠금 없는 추론/늦은 벡터·NULL 쓰기**를 실제 독립 프로세스로 재현했다. DB 벡터 트리거가 token/generation/lease/현재 이미지 hash를 검사하여 구형 쓰기로 최신 결과를 덮거나 지우지 못하게 했다. 정상 원본 사진 변경·큐 등록은 유지한다.
2. **초기 D-2 Preview의 구형 claim/미인증 완료**도 조사했다. 새 작업 트리거는 구형 claim을 추론 전에 거절하고, 이미 실행 중인 구형 완료는 pending으로 복구한다. 현재 운영 도구의 호환 helper도 공통 제어로 연결했다. 작업 규약은 신뢰된 서버 코드의 동시성 장치이며 DB 자격증명 자체의 인증 대체물이 아니다.
3. **D-1 CPU 작업은 DB 저장 검증만으로 중단할 수 없다.** 새 Runtime 스위치로 전환 중 실행을 정지하고 사진 변경은 큐에 보존한다. 기존 보호 설정 all_except_custom_domains와 Skew Protection 비활성을 확인했다. 실제 Hobby/Fluid 기본 최대 300초보다 긴 330초를 새 Production 버전 확인 후 대기한다. 과거 배포·시드 도구는 직접 실행하지 않는다.
4. **검색마다 큐 확인 쿼리**가 추가되던 부분은 warm 인스턴스당 15초에 한 번으로 합쳤다. 동시 20회 복구 요청의 DB 조회 1회와 오류 후 재시도를 검사했다. cron/명시적 drain은 이 최적화로 생략하지 않는다. 이미지 POST 검색에는 이 큐 확인을 추가하지 않았다.
5. **회귀 검사 08단계의 즉시 완료 가정**은 사진 첨부 after()와 lease 합류 시 맞지 않는다. 첫 실행은 이 단계에서 실패했고 생성 데이터는 정리했다. Preview 전환 스위치 검사와 회귀 검사를 순차화하고, 최대 30초 안의 embedded=true 및 실제 현재 hash/768차원/completed를 모두 요구하도록 강화했다. pending/in_progress는 통과로 인정하지 않는다. 원래 실패 로그도 보존했다.
6. 운영 프로브의 D-1에 없는 maintenance 경로는 기준 환경에서 400임을 구분했다. 새 D-2에서는 비인증 401을 요구한다. Preview 시간에서 CLI 준비 시간을 빼고 실제 HTTP time_total을 사용하도록 보완했다. Realtime 관리 health URL의 401을 가용성 장애로 해석하지 않고, 방 구독·송신 없는 WebSocket 연결로 검사한다.

공통 제어의 사용자/글 예산과 근거는 [이전 Preview 보고](release-d2-review-2026-11-16.md)의 표를 유지했다. staff 업로드 정책·모델 revision·전처리·768차원·검색 점수는 바꾸지 않았다. 새 사진은 처리 전 텍스트 신호로 검색하며, 입력 변경은 DB 트랜잭션에서 큐와 캐시를 함께 갱신한다.

## 검증 결과

| 검사 | 결과 |
| --- | --- |
| 전체 단위 | 260개 파일 **2,966/2,966** |
| 통합 회귀 | 최종 빌드+Preview DB/Storage **16/16** |
| 타입·빌드 | tsc, 로컬 Next 및 실제 Preview/Production 빌드 통과 |
| 린트 | 최종 전체 소스 **877개**, 오류/경고 0 |
| 다중 프로세스 | 4개 새 worker의 추론 1회, 동일 입력 reuse, 구형 D-1/초기 D-2 공존 검사 통과 |
| 중단·재시도 | 실제 SIGKILL, lease 만료, 마지막 시도 중단, 모델 실패·재시도, A→B·ABA/제거 저장 차단 통과 |
| 큐 복구 | Runtime 정지/미도래 시 추론 0·큐 유지, 재개 후 완료, 구형 완료 pending 복구 통과 |
| 배포된 실제 모델 | Preview 신규 글/사진 1개: completed, 현재 hash 일치, 768차원; 원본 사진 포함 정리 |
| 사용자 수동 검사 | 앞선 Preview에서 사진·유사 이미지·사진 검색 정상 확인. 이번 보완은 UI/로그인을 바꾸지 않았으며 자동 회귀로 보완 |
| Production 공개 검사 | 버전·홈·로그인·익명 세션·정책·검색·사진 정상, 채팅/관리자/증거/maintenance 비인증 차단 |
| 증거/Storage/Realtime | 신고 snapshot 컬럼 3개·비공개 evidence 버킷 유지, 실제 원본/서명 업로드와 Realtime 메시지는 Preview 회귀에서 검증, Production은 구독 없는 transport 연결 확인 |
| 업로드 소스 검사 | Preview 1,123개, Production 1,128개: 비밀·QA·fixture 금지 파일 0 |
| 오류 로그 | 해당 새 배포의 조회 구간마다 오류·5xx 각 0. 조회당 최근 20분/최대 200개 범위 |

새 테이블 2개는 RLS 활성·클라이언트 정책 0이고 관련 트리거 7개가 활성이다. 기존 권한·RLS·GRANT/REVOKE 정리는 수행하지 않았다. 양쪽 REST 루트 503을 재확인했고 Data API 설정은 OFF를 유지했다. Auth.js·관리자·신고 증거 소스와 접근 보호 코드는 D-1 이후 변경하지 않았다.

Production 첫 실제 Google 로그인과 실제 사용자 이미지 변경/추론은 이번 배포에서 강제로 수행하지 않았다. 인증 API·권한 회귀와 기존 로그인 구조 보존을 검증했다. 새 일간 cron의 첫 정기 실행은 아직 도래하지 않았으나 기존 CRON_SECRET이 양쪽에 있고 배포 설정을 반영했다. 실제 사용자에게 테스트 게시글/신고를 만들거나 정지·대량 호출·전체 임베딩 재계산을 하지 않았다.

## Production 실행 및 백업

최신 버전·원격·롤백 대상을 재확인하고 지침/백업/D-2 브랜치를 일반 Push했다. 기존 승인 실행기로 허용된 D-2 5개만 적용했고 pending은 0이다. 추가 전환 마이그레이션은 ImageEmbeddingRuntime과 작업/벡터 쓰기 트리거로 이 릴리스 범위에 한정했다. 기존 벡터를 backfill하지 않는다.

| 암호화 백업 | 검증 |
| --- | --- |
| release-d2-pre-2026-11-16-065006.tar.enc | 06:52:52 KST 완료, 체크섬 141개, 51개 테이블 불일치 0, 이미지 134개 누락 0 |
| 같은 pre 백업 리허설 | 06:54:45 KST 완료, 5개 적용·롤백·재적용, 모든 기존 이미지/벡터 digest 동일, backfill 0·Runtime 정지·트리거 7 확인 |
| release-d2-post-2026-11-16-070018.tar.enc | ops/backup 실제 실행, 07:02:58 KST 완료, 체크섬 141개, **53개 테이블 불일치 0**, 이미지 134개 누락 0 |
| post 덤프 자체 추가 검사 | 07:14:36 KST: 재생 마이그레이션 없이 **Job 0행·Runtime 1행·RLS 2개·트리거 7개·768차원** 실제 복원 확인 |

암호화 왕복·체크섬·PostgreSQL 18.6/pgvector 0.8.1 격리 실제 복원을 유지했다. 덤프 도구는 기존 EDB 18.7이다. 두 평문 원본과 복호화 임시본은 기존 절차로 정리했다. 최신 덤프와 기준값은 같은 RR READ ONLY exported snapshot이다. Storage의 삭제/교체 불일치는 여전히 실패 처리한다. 추가 복원 assertion 첫 실행은 psql 세션에서 extensions.vector 함수를 찾지 못해 실패했다. 로컬 검사에 실제 extension search_path를 명시하여 동일한 768차원 기준으로 재검증했으며 실패 로그·정상 원본·기존 검증 표식을 보존했다.

전용 ops/backup @15e294e와 Production guard/approvalPolicy/backup 스크립트의 내용 일치를 확인했다. 일간·watchdog 두 예약 작업은 ops 작업 트리 사용, Ready/LastTaskResult 0이다. 최근 일간 성공은 04:16:21 KST, lastError 없음. 11월 15일 정상본·오늘 검증본·실패 아카이브 1개를 보존했고 보존 정책으로 기존 파일을 추가 삭제하지 않았다.

새 배포는 06:57:27 KST READY였다. 공개 버전을 다시 확인한 뒤 Runtime을 arm했고 **재개 시각 07:05:36 KST 경과 후 ready=true**를 확인했다. 마지막 조회에서 queue/failed 모두 0. 기존 Production 임베딩은 lost 2개, found 77개이며 검사 전후 동일했다. 명시적 Production 쓰기는 승인된 D-2 스키마/Prisma 이력과 Runtime 배포 설정 행뿐이다. 공개 프로브에 따른 기존 접속·검색 통계 기록은 정상 런타임 동작으로 구분한다.

## 함수 크기·응답 시간·비용

Vercel 메타데이터의 고유 function artifact 경로는 D-1 5개에서 D-2 6개(참조 6→7)다. Hobby 플랜을 변경하지 않았다. API가 전체 압축 함수 바이트를 제공하지 않아 그 값을 추정해 실제 크기라고 보고하지 않는다.

로컬 trace에서 이미지 함수는 SigLIP 3개 파일 **99,499,954바이트**, 텍스트 모델 없음. root/id의 기존 모델 7개/211,323,161바이트와 댓글 0개를 유지했다. 중간 D-2 빌드에서 잘못 포함됐던 텍스트 모델은 제외했다. 추가 이미지 함수의 모델 메모리/배포 용량과 DB claim·예산·최종 저장 비용은 있으며, 내부 HTTP/중복 추론을 줄이는 효과와 구분한다. 실제 청구액 절감이나 p95 개선을 주장하지 않는다.

같은 Production DB·입력·상위 5건의 ID/종류/점수 해시는 D-1/새 D-2 및 후속 표본에서 동일했다. keyword는 해당 입력 0건의 정상 응답이며, 실제 매칭은 Preview 회귀의 신규 고유 제목으로 검사했다.

| 검색 HTTP 전체(ms) | D-1 초기 기준 | D-2 배포 직후 | D-2 후속 |
| --- | ---: | ---: | ---: |
| keyword | 1,370 | 1,338 | 1,565 |
| semantic | 2,217 | 2,237 | 2,338 |
| unified | 203 | 2,266 | 192 |
| image | 761 | 2,365 | 2,401 |

이미지 지연을 분리하기 위해 보존 D-1과 D-2의 immutable 배포에 같은 파일로 **각 2회**만 정상 비저장 검색했다. 1차 D-1/D-2는 **2,716/2,711ms**, 2차는 **573/583ms**, 네 결과 해시는 동일했다. 처음의 격차는 이 비교에서 지속적 D-2 회귀로 재현되지 않았고 인스턴스/모델 준비 상태 차이와 일치하는 패턴이다(추론). 이미지 POST에는 큐 복구 조회 자체가 추가되지 않았다. 작은 표본이며 통제된 cold/warm·p95·부하 측정은 아니다. Preview 실 HTTP는 keyword252/semantic1004/unified230/image944ms였고 서로 다른 DB라 Production과 품질/시간을 직접 비교하지 않았다.

## 테스트 데이터와 보존

- 동시성 실행: 사용자382/글283~287, 사용자383/글288~294, 사용자384/글295~301, 사용자388/글303~309 정리 완료(모두 lost).
- 처음 실패한 회귀: 사용자385~387/글302와 사진 정리 완료. 최종 회귀: 사용자389~391/글310/방163·메시지·사진 정리 완료.
- 배포 실모델 검사: 사용자392/글311/사진 1개·작업·카운터·테스트 계정 정리, 원본 Storage 부재 확인.
- 최종 읽기 전용 조회에서 이 계정·글·방 잔여 모두 0이다. 생성 시점의 실행별 명세와 정리 결과를 보존했다. 기존 계정·시드·일반 게시글·감사 기록은 삭제하지 않았다.
- 이전 수동 습득글271 정리는 이전 보고에 기록돼 있고 이번 lost 글 ID들과 구분한다. 삭제된 공개 사진의 CDN 200 잔존은 SEC-CDN-DELETE-001로 계속 열려 있으며 이번에 해결했다고 보고하지 않는다.

## 커밋·남은 한계·롤백·다음 작업

주요 수정 파일:

- `AGENTS.md`, `CLAUDE.md`: 동일한 자율 작업·승인 경계·테스트·보고 정책.
- `src/lib/ai/imageJob.ts`, `postEmbedding.ts`, `src/app/api/posts/route.ts`와 관련 테스트: 전환 대기·저장 token·운영 도구 제어·검색 후 복구 합치기. `[id]/route.ts`의 과거 내부 HTTP 설명도 현재 구조로 갱신.
- `prisma/schema.prisma`, `20261122030000_image_job_fence`, `20261122040000_image_job_protocol`: Runtime·벡터 저장/claim/완료 검증. 앞선 D-2 3개 마이그레이션과 함께 적용.
- `scripts/operations/release-d2*.mjs`, `release-probes.mjs`, `release-logs.mjs`, `image-bundle-summary.mjs`, `compare-image-search-deployments.mjs`, `verify-image-jobs.mjs`, `verify-deployed-image-job.mjs`, `scripts/deployments/verify-upload.mjs`: 승인 실행·비파괴 상태/성능·실제 모델·공존 검사를 정식 관리.
- `scripts/regression/preview.mjs`, `README.md`, `scripts/fixtures/image-job-*`: 완료된 실제 벡터 검증·리허설·덤프 복원 검증. 운영 문서/색인/이전 보고 링크 갱신.

- 백업 복구: 0007e21, 053b8b9, 15e294e. 자율 정책: c5e6f7d.
- D-2 선행 구현: 11a8e15, d9dac9e, badeea7, 0b7232e, 36b15e3, 56af989 및 기존 보고8f8281b.
- 이번 공존/전환/성능 보완: **4d5676b**. 재사용 운영 도구86814e9, 문서/D-3 설계8309d67, 기존 벡터 보존 검사·실제 Production 배포 커밋 **8baa381**. 최종 운영 보고/추가 진단 도구는 후속 커밋이다.

기존 D-1 배포를 보존했으며 [전환·롤백 절차](release-d2-transition.md)를 따른다. Runtime pause→현재 worker 종료 시간 확보→기존 vercel rollback→버전/비파괴 확인 순서다. Production에서 역마이그레이션하거나 큐·새 테이블·신고 증거를 삭제하지 않는다. D-1 복귀 후 새 사진의 AI 작업은 pending에 보존하고, 수정 D-2 재배포·drain 뒤 처리한다.

lease 기반 시스템은 장애 시 물리적 exactly-once 추론과 즉시 완료 SLA를 보장하지 않는다. 일간/후속 요청 복구와 최대 5회 자동 시도 뒤 명시적 재시도를 유지한다. 전체 압축 함수 크기·실제 청구액·운영 p95·첫 정기 cron 실행·새 Production의 실제 Google OAuth/사용자 이미지 추론을 강제로 재현하지 않은 항목을 남긴다. 이번 D-2 필수 검사 실패는 모두 해결했다. 공개 Realtime 접근 통제와 CDN 잔존 등 후속 보안 항목은 별도 범위로 남는다.

다음은 [D-3 상세 계획](release-d3-plan-2026-11-16.md)이다. Auth.js와 별도 Realtime 수신 토큰의 신뢰 연결, private 채널/참여자 정책, 서버 검증된 읽음 상태, 이벤트 합치기를 설계했다. 새 키·역할/정책·프로젝트 설정은 미실행이며 해당 범위를 명시한 후속 승인이 필요하다. D-4/D-5/E/잔여 DB 권한/최종 재감사는 미착수다.
