# Function Storage C-2 — `/api/posts/[id]`의 모델 제거 계획 (2026-11-20)

상태: **계획만 작성. 코드·DB·배포 변경 없음.** C-1(Production `dpl_5r8gc7wQ…`) 이후 단계다. Production 배포와 Production DB 마이그레이션은 각각 별도 승인을 받는다.

## 1. 목표와 효과
- `/api/posts/[id]` 함수는 230.8MB이고, 그중 약 200MB가 모델(ko-sroberta 텍스트 약 106MB, SigLIP 이미지 약 95MB)이다. 이 함수에서 모델을 빼면 배포당 0.539GB → **약 0.34GB(-약 200MB, -37%)**가 된다. 모델은 `/api/posts` 함수 하나에만 남는다.
- 새 라우트는 만들지 않는다(Hobby 함수 12개 한도). 처리는 기존 `/api/posts?mode=embedding-maintenance`가 맡는다.

## 2. 현재 `/api/posts/[id]`의 모델 사용 지점
| 메서드 | 모델 | 동작 | 호출자 |
|---|---|---|---|
| PATCH(글 수정) | 텍스트 | 제목·설명·분류·장소가 바뀌면 `after()`에서 `embedPostBestEffort` → 추천 캐시 무효화 | 수정 화면 |
| PUT(수동 재분석) | 이미지 | `runImageJob(manual)` 동기 실행 후 결과 반환 | UI 호출 없음. 회귀·운영 도구만 사용 |
| GET(추천 포함) | 없음 | 저장된 벡터만 사용 | 글 화면 |

- 현재 텍스트 재임베딩은 **기록이 남지 않는 best-effort** 방식이다. 실패하면 이전 벡터가 조용히 남고, 재시도하는 장치가 없다.

## 3. 선택지
| | A. 텍스트 작업 큐(권장) | B. 마이그레이션 없이 `embedding=NULL` 표시 | C. kick만 |
|---|---|---|---|
| DB 마이그레이션 | 새 테이블·트리거(추가형) | 없음 | 없음 |
| 실패 시 재시도·누락 방지 | 있음(이미지 큐와 같은 lease·attempts·복구) | NULL을 다시 찾아 처리 | 없음(지금보다 나빠짐: 네트워크 단계 추가) |
| 수정 직후 검색 | 이전 벡터 유지, 새 벡터로 교체 | 재계산 전까지 의미 검색·추천에서 빠짐 | 이전 벡터 유지 |
| 기존 데이터 보존 | 기존 벡터를 건드리지 않음 | 수정한 글의 벡터를 먼저 지움 | 유지 |
| 판단 | 신뢰성 향상 + 용량 절감 | 검색 공백·데이터 선삭제가 있어 비권장 | 신뢰성 저하로 제외 |

## 4. 권장안 A 상세
### DB(추가형 마이그레이션, Preview 먼저)
- `TextEmbeddingJob`(post_type, post_id, desired_hash, completed_hash, generation, state, lease_token, lease_until, attempts, next_run_at, last_error, updated_at). `ImageEmbeddingJob`과 같은 구조다.
- 트리거: `LostPost`/`FoundPost`의 `UPDATE OF title, description, category, location`에서 네 필드와 모델 태그의 해시로 작업을 넣는다. 값이 실제로 바뀐 경우만 넣는다.
- 기존 행·벡터는 바꾸지 않는다. backfill이나 일괄 재계산은 하지 않는다.
- 권한: 새 테이블에 RLS를 켜고, `anon`·`authenticated`에 대한 권한을 명시적으로 REVOKE한다. Production에 남아 있는 기본 ACL 때문에 새 테이블이 권한을 물려받을 수 있다(2026-11-12 감사). 이 REVOKE는 Production 권한 변경에 해당하므로 마이그레이션 승인에 포함해 받는다.

### 앱
- PATCH: 인라인 임베딩 대신 `after()`에서 `kickImageJobs`와 같은 kick을 보낸다(이름을 일반화한다). 추천 캐시 무효화는 작업 완료 시점(worker)으로 옮겨 "새 벡터 저장 → 무효화" 순서를 유지한다.
- PUT: `runImageJob` 대신 작업을 수동 재시도 상태로 되돌린 뒤 kick하고 `{ jobStatus: "pending" }`을 반환한다(비동기). 호출자가 도구뿐이라 영향은 회귀 08단계 갱신에 그친다.
- worker(`/api/posts`): drain이 이미지·텍스트 작업을 함께 처리한다. 텍스트 작업은 행을 잠그고 현재 네 필드로 해시를 다시 계산한다. 해시가 같을 때만 저장한다(빠른 연속 수정에서 오래된 벡터가 덮어쓰는 것을 방지). 요청 시 복구와 일일 cron도 텍스트 작업을 포함한다.
- 생성 경로(`/api/posts` POST)는 모델이 있는 함수라 이번에는 바꾸지 않는다.

### 롤백·장애 복구
- 앱 롤백: C-1 배포 `dpl_5r8gc7wQ…`로 즉시 복귀할 수 있다. 추가형 테이블이라 이전 코드와 호환되고, 이전 코드는 인라인 임베딩을 그대로 한다. 롤백 중 쌓인 텍스트 작업은 남았다가 재배포 후 처리된다(중복 계산 1회 수준, 결과 동일).
- kick 실패: 작업이 pending으로 남고, 다음 `/api/posts` 요청의 복구나 일일 cron이 처리한다(C-1에서 입증한 경로).
- 모델 실패: attempts 5회까지 10초 backoff 후 `failed`로 남는다. 이전 벡터는 유지한다.
- 역마이그레이션은 Production에서 하지 않는다(테이블은 남겨도 무해하다).

## 5. 영향 분석
- 검색 정확도: 같은 모델·같은 텍스트 생성 함수·같은 onnxruntime 버전이므로 벡터가 같아야 한다. 검증에서는 인라인 결과와 큐 결과를 같은 글에서 비교한다(최대 절대 차이). 의미·통합 검색 rankHash와 추천 결과도 이전·새 Preview 배포 간에 비교한다.
- 응답 속도: PATCH 응답은 지금도 임베딩을 `after()`로 미루므로 변화가 없을 것으로 본다. 새 벡터가 반영되는 시간은 함수 간 요청 1회가 늘어난다. 대신 `/api/posts`는 검색 트래픽으로 자주 warm 상태라, cold start가 잦은 `[id]` 함수에서 모델을 로드하는 지금보다 빨라질 수 있다. Preview에서 수정→완료 시간을 p50·최대로 잰다.
- 메모리·시간: `[id]` 함수는 모델 로드가 없어져 cold start가 줄어든다. `/api/posts`의 drain은 기존 한도(최대 8건)를 공유한다.
- 운영 데이터: 기존 사용자 데이터·이미지·벡터는 변경하지 않는다.

## 6. 검증 계획(Preview)
1. 단위: 텍스트 작업 프로토콜(해시 fence, 연속 수정, lease, 재시도, 중복 claim 1회), `bundleTracing.test.ts`(`[id]`에 모델 include 없음), PATCH·PUT 라우트 테스트 갱신.
2. 로컬 16단계 회귀: PATCH 텍스트 수정 → 다른 요청 없이 작업 완료·벡터 갱신 단계를 추가한다.
3. 호스팅 Preview: `verify-image-kick.mjs`를 텍스트 작업까지 확장한다(보호, 인증, 동시 kick 1회 claim, kick 없는 복구).
4. 정확도·속도: 위 5절의 비교. 함수 번들 측정.
5. 이후 Production: 백업 → 마이그레이션(승인) → 배포(승인) → 프로브·rankHash·큐 상태 확인.

## 7. 필요한 승인
- Preview 마이그레이션과 Preview 배포: 상시 허용 범위다(배포 1회 목표).
- Production 마이그레이션(새 테이블·트리거·REVOKE)과 Production 배포: 각각 별도 승인이 필요하다.
