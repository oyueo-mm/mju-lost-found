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

## 8. 실행 기록 — Preview 구현·배포·검증 (2026-11-21, `perf/function-storage-c2`)

상태: **Preview만 반영. Production DB 마이그레이션·권한 변경·배포는 하지 않았다(미승인).**

### 구현
- 마이그레이션 `20261124000000_text_embedding_jobs`(추가형): `TextEmbeddingJob` 테이블과 트리거 4개(수정 2, 삭제 정리 2), RLS ON, 정책 없음. PUBLIC·anon·authenticated의 테이블·함수 권한은 명시적으로 REVOKE한다(해당 역할이 없으면 건너뛴다).
- 트리거는 제목·설명·분류·장소가 **실제로 바뀐 경우에만** generation을 올리고 `pending`·attempts 0으로 재무장한다. 생성(INSERT)은 기존대로 `/api/posts`가 인라인으로 임베딩한다.
- `src/lib/ai/textJob.ts`: lease claim(150초), attempts<5, 실패 시 10초 backoff를 적용한다. 커밋 시 post→job 순서로 잠근다. 같은 generation·유효 lease·같은 텍스트일 때만 벡터 저장, 추천 캐시 무효화, 완료 표시를 한 트랜잭션으로 처리한다. 늦게 끝난 결과는 버리고 이전 벡터를 유지한다.
- `/api/posts`: maintenance drain이 이미지·텍스트 큐를 각각 처리한다(한쪽 실패가 다른 쪽을 막지 않고, 둘 다 실패하면 503). 요청 시 복구도 텍스트를 포함한다(인스턴스당 15초 1회).
- `/api/posts/[id]`
  - PATCH: 텍스트 필드가 바뀌면 `after()`에서 drain을 요청한다.
  - PUT: 수동 재계산 한도를 확인한 뒤 이미지 작업을 재무장하고 drain을 요청한다. 응답은 비동기 `pending`이다. UI 호출자는 없다.
  - 인라인 추론은 없다.
- 번들: 처음에는 `[id]`의 include만 빼고 exclude를 추가했지만 Vercel 번들이 그대로였다(Preview `dpl_7gWQjJTD…`, 539.4MB). 원인은 Turbopack이 embedding 모듈의 `process.cwd()/models` 경로를 import한 모든 함수에 trace하기 때문이다. 수정 로직을 `src/lib/posts/updateService.ts`로, `EMBEDDING_INPUT_FIELDS`를 `src/lib/ai/embeddingFields.ts`로 분리해 `[id]`가 embedding 모듈을 import하지 않게 했다(로컬 trace 모델 파일 7→0). `bundleTracing.test.ts`가 import를 지킨다.

### 결과 (Preview `dpl_9qJhtm4t2Y1T8XV96DAFXSuo4tKi`, `191ae82`)
| 항목 | C-1 Preview `dpl_DfQFL4LB…` | C-2 Preview |
|---|---|---|
| 함수 번들 합계 | 539.4MB(6개) | **308.8MB(5개), -230.6MB(-42.8%)** |
| `/api/posts/[id]` | 230.8MB | 30.9MB(사진 경로와 같은 함수로 합쳐짐) |
| `/api/posts` | 230.8MB | 230.8MB(모델은 여기만) |

### 검증
- 로컬 마이그레이션 리허설 30/30(`scripts/regression/text-job-migration-local.sh`, WSL PG18): Supabase 역할과 **Production식 잔여 default ACL을 재현**(새 테이블에 권한이 새는 것을 먼저 확인)한 상태에서 REVOKE 효과, RLS, 트리거, 롤백, 재적용을 확인했다.
- Preview 권한(`text-job-privileges.mjs`): anon·authenticated 권한·ACL 없음, 함수 EXECUTE 없음, 실제 읽기 시도 42501 거부, RLS ON, 정책 0, 트리거 4. Preview public 스키마 default ACL은 없다.
- 단위 274파일 3,047개, 타입, 린트 통과. 계약이 바뀐 기존 테스트(aiService 6개, `[id]` PUT 1개)는 새 계약(인라인 임베딩·캐시 무효화 없음, 큐 재무장)으로 바꿨고, 검사는 늘렸다.
- Preview 큐 통합 22/22(`verify-text-jobs.mjs`, 별도 프로세스 worker, 실제 SQL)
  - 동시 4개 → 추론 1회
  - 수정 중 늦은 결과 폐기
  - 실패 → backoff → 재시도
  - 크래시 lease 만료 회수
  - 5회 한도 뒤 새 수정이 재무장
  - 이전 배포의 인라인 쓰기 허용
  - 삭제 정리
- 로컬 회귀 17/17(신규 08b: PATCH 후 kick만으로 새 벡터, 1.3초). 분리 전후 빌드 모두 통과.
- 호스팅 Preview
  - 텍스트 7/7(`verify-text-kick.mjs`): 동시 3회 kick → claim 1회, 768차원, 0.9~2.8초. 정확한 텍스트로 의미 검색 시 새 배포와 이전 인라인 배포 모두 1위·score 1(같은 벡터). kick 없이 대기 → 요청 시 복구 1.3초.
  - 이미지 kick 8/8(`verify-image-kick.mjs`).
- 검색 동일성 26/26(`compare-search-deployments.mjs`): 키워드·의미·통합 × 분실·습득 × 질의 4개, 이미지 2건. 순위와 표시 점수 해시가 같다(429는 스크립트의 한도 초과로 재시도 처리).
- 기존 벡터 보존(`text-vector-snapshot.mjs`): 분실 115·습득 174개의 텍스트·이미지 벡터 digest가 마이그레이션·배포·검증 전후로 같다.
- 프로브 16/16, error·5xx 0, 이미지·텍스트 큐 적체 0. Realtime private(활성 grant 0), Data API 503.
- 시험 데이터(Preview, 모두 정리 확인): 사용자 620~632, 글 343~358, Storage 객체(이미지 kick 4개). manifest는 `.vercel/text-jobs-*`, `text-kick-*`, `image-kick-*`, `regression-*`.

### 롤백 절차
1. 앱(먼저)
   - Preview: `npx vercel alias set https://mju-lost-found-vercel-fxzahtewv-oyueo.vercel.app mju-lost-found-preview.vercel.app`(C-1 `dpl_DfQFL4LB…`).
   - Production(반영 후): `npx vercel rollback <C-1 dpl_5r8gc7wQ… URL> --yes`.
   - 테이블이 남아 있어도 이전 코드는 인라인 임베딩을 계속한다. 트리거가 넣는 작업은 처리되지 않고 남을 뿐이다(무해, 재배포 시 처리).
2. DB(필요할 때만, 앱 롤백 후): `scripts/fixtures/text-job-rollback/rollback.sql` 실행, 이어서 `_prisma_migrations`에서 해당 행 삭제. 로컬 리허설에서 검증했다. 게시글·벡터는 건드리지 않는다. Production 실행은 별도 승인을 받는다.

### Production 반영 시 위험과 순서
- **순서: 백업 → 마이그레이션 → 권한 검사 → 앱 배포.** 앱이 먼저 나가면 drain이 테이블 없음으로 실패하고(로그만 남고 503은 아님), 그동안 수정 글의 텍스트 재임베딩이 일어나지 않는다.
- Production public 스키마의 잔여 default ACL 때문에 새 테이블이 anon·authenticated 권한을 물려받는다. 마이그레이션의 REVOKE로 제거되며, 적용 직후 `text-job-privileges.mjs`로 확인해야 한다(Production 권한 변경 승인 범위).
- 대량 수정(분류 일괄 변경 스크립트 등)은 작업을 한꺼번에 만든다. 처리량은 kick당 8건, 요청 복구 15초당 1건, 일일 cron이라 쌓일 수 있다. 처리 전까지는 이전 벡터를 유지한다.
- PUT은 비동기로 바뀌었다(UI 호출 없음, 운영 도구는 완료까지 폴링).
- 수정 후 새 벡터 반영에 함수 간 요청 1회가 더해진다(호스팅 0.9~2.8초).
- 마이그레이션 파일은 LF 그대로 적용됐다. 다른 체크아웃에서 CRLF로 바뀌면 Prisma 체크섬이 달라 보일 수 있으니 같은 작업 트리에서 적용한다.

## 9. Production 반영 (2026-11-21, 사용자 승인: 마이그레이션·권한·배포)

승인 참조: `C2-PROD-RELEASE-2026-11-21`(승인 실행기). 단계별로 진행했고, 각 단계를 통과한 뒤에만 다음 단계로 넘어갔다.

1. **백업·복원**: `release-c2-pre-2026-11-21-083510.tar.enc`(24.9MB).
   - 암호화 왕복 검증, 체크섬 144/144 일치, 평문 삭제.
   - WSL PG18 격리 복원: 테이블 56개 행 수 불일치 0, 사진 135개 누락 0, D-3 권한 재구성 일치.
2. **충돌 확인**
   - 복원한 Production 사본에서 C-2 마이그레이션 리허설 성공.
   - 실제 Production 읽기 전용 점검(`c2-preflight.mjs`): 대기 마이그레이션은 C-2 하나뿐, 미해결 행 0, 기존 체크섬 일치, 새 객체 이름 충돌 0, 대상 컬럼 존재.
   - 2026-10-03의 rolled-back 행(`20261018000000_add_post_category_code`)은 이후 재적용된 과거 복구 흔적이다.
   - public default ACL 잔존을 확인했다. postgres 소유 새 테이블에 anon·authenticated·service_role의 `Dxtm`이 상속된다.
3. **적용**: `release-c2.mjs migrate --apply --confirm-production`(lock_timeout 5초, statement_timeout 60초). 적용 후 대기·미해결 0.
4. **권한**(`text-job-privileges.mjs`)
   - 마이그레이션의 REVOKE로 anon·authenticated는 0이 됐다.
   - service_role에는 상속분 `TRUNCATE/REFERENCES/TRIGGER/MAINTAIN`(읽기·쓰기 없음)이 남았다. "default ACL 상속 차단" 기준에 따라 `release-c2.mjs revoke-inherited`로 새 테이블에서만 회수했다. 앱은 소유자(postgres)로만 접근한다.
   - 최종 결과: 비소유 역할 권한 0, PUBLIC 0, 함수 EXECUTE 0, anon·authenticated 실제 읽기 42501, RLS ON, 정책 0, 트리거 4. 강화된 검사 11/11 통과.
5. **데이터 보존**: 적용 전후 Production 벡터 지문이 같다(분실 4·습득 80개의 텍스트·이미지 digest).
6. **배포**: `deploy.mjs production --record-dry-run`, **`dpl_3AgGm82bTYAQUV8bRJevsf8JquRX`**(`253de8f`). 롤백 대상은 C-1 `dpl_5r8gc7wQAmwriBH7Tz63n5gSLjgm`(READY)이며, D-3 이전 배포들도 보존했다.
7. **배포 후 검증**
   - 실제 번들: **539.4MB(6개) → 308.8MB(5개)**. `[id]`는 230.8MB → 30.9MB(사진 경로와 같은 함수로 합쳐짐).
   - 공개 프로브 16/16. 검색 rankHash 4종이 C-1 때와 같다.
   - 이전·새 Production 검색 비교 26/26 동일(`compare-search-deployments.mjs --allow-production`; 키워드·의미·통합 × 분실·습득 × 질의 4개 + 이미지 2건, 순위·점수).
   - 벡터 직접 비교(`text-vector-equivalence.mjs`, Preview, 실모델): 기존 인라인 `embedPostBestEffort`와 새 `runTextJob`의 결과가 3개 샘플(한국어, 장소 없음, 영어)에서 **최대 차이 0, cosine 1**로 같다.
   - Realtime: private, 활성 grant 0. 익명 공개 가입 `private_only`, 익명 비공개 `authorization_denied`. Data API 503(OFF).
   - error·5xx 0. 이미지 큐 적체 0, 사진 글 80개 모두 임베딩. 텍스트 큐 0건.
- 남은 확인: 로그인 상태에서 실제 글을 수정했을 때의 텍스트 재임베딩, 그리고 함수가 합쳐진 사진 첨부 경로. 사용자 계정의 시험 글로 확인한다(`image-job-status.mjs --post`, 텍스트 작업은 `text-job-privileges.mjs` queue summary와 `post-cleanup-check.mjs`로 확인).

### 로그인 상태 실제 검증 (사용자 시험 글 lost:143, 2026-11-21 09:38~09:40 KST)
- 읽기 전용으로 확인했다: 로그, `image-job-status.mjs --post`, `text-vector-check.mjs`, 공개 의미 검색.
- 사진: 등록(00:37:59Z) → 업로드 → `POST /api/posts/143/image` 200(00:38:07.6Z) → 배포 고유 주소로 drain 요청 `GET /api/posts` 200(00:38:10.4Z). 이미지 작업은 completed, attempts 1, 768차원으로 약 3.9초 만에 끝났다. PostImage 1, 사진 200(webp).
- 텍스트 수정: `PATCH /api/posts/143` 200(00:40:38.6Z) → drain 요청 200(00:40:40.1Z). 텍스트 작업은 generation 1 completed, attempts 1, 오류 없음, 수정 후 2.2초.
- 텍스트 수정은 이미지 작업을 다시 건드리지 않았다(이미지 작업 마지막 갱신이 수정 이전).
- 벡터 갱신 직접 확인(`text-vector-check.mjs`): 저장 벡터와 "현재 텍스트" 계산값의 cosine 0.99999995(최대 차이 4e-5, 로컬 Windows CPU와 Vercel CPU 차이 수준), 저장 벡터와 "수정 전 텍스트" 계산값의 cosine 0.956. 즉 벡터가 수정 후 텍스트로 바뀌었다.
- 의미 검색(새 배포·C-1 롤백 배포 같음)
  - 수정 후 전체 텍스트: 1위, score 1.
  - 수정 후 제목만: 1위, 0.9750.
  - 수정 전 텍스트도 표시 점수 1이었다. 표시 점수가 높은 유사도에서 포화되므로 갱신 판정에는 위의 직접 비교를 사용했다.
- 큐·오류: 텍스트 큐 completed 1, 이미지 큐 completed 2, 미완료 0. 배포 이후 error·5xx 0. 권한 검사 11/11 유지. 습득물 벡터 digest 변화 없음(분실물 쪽 변화는 시험 글 추가뿐).
- **C-2 완료(2026-11-21).** 시험 글은 사용자가 삭제하고, 이후 `post-cleanup-check.mjs --post=lost:143`(텍스트 작업 포함)로 정리를 확인한다.

### 완료 확정 (2026-11-21)
- 사용자가 C-1·C-2를 완료로 확정했다. 시험 글 lost:143 삭제 뒤 `post-cleanup-check.mjs --post=lost:143` 통과(글·사진·이미지/텍스트 작업·추천 캐시·Storage·연관 데이터 0).
- 브랜치·다음 단계 현황은 [maintenance-status-2026-11-21.md](maintenance-status-2026-11-21.md)에 정리했다.
