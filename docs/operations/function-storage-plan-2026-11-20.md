# Vercel Function Storage 10GB — 원인 분석과 최적화 계획 (2026-11-20)

상태: **계획만 작성. 정리·삭제·설정 변경은 실행하지 않았다.** 측정은 읽기 전용(`vercel inspect`의 함수 출력 크기를 배포별 고유 번들로 합산)이다. Hobby에서는 대시보드의 Function Storage 수치를 API로 읽을 수 없으므로(`vercel usage` 404) 이 합산값은 추정이다.

## 1. 현재 상태

| 항목 | 값 |
|---|---|
| 팀 `oyueo` 보존 배포 | 15개(모두 `mju-lost-found-vercel`. 다른 두 프로젝트는 배포 0개) |
| 배포당 고유 함수 번들 | 약 0.64GB(함수 6개) |
| 합계(추정) | 약 9.6GB / 10GB |
| 오늘(11-18~19) 생성 | Production 8개, Preview 7개. D-3·UX 작업 중 Codex와 Claude가 연속 배포했다. |

배포당 큰 함수(현재 Production):

| 함수 | 크기 | 내용 |
|---|---|---|
| `api/posts` | 230.8MB | 텍스트·이미지 임베딩 모델(ko-sroberta 약 106MB, SigLIP vision 약 95MB) + onnxruntime |
| `api/posts/[id]` | 230.8MB | 같은 모델 사본(수정 시 임베딩 재계산) |
| `api/posts/[id]/image` | 131.1MB | 이미지 임베딩 경로 |
| 공용 API 함수 | 31.3MB | 관리자·신고 등 |
| 나머지 | 소량 | |

## 2. 원인

1. **배포 수 × 배포당 크기.** 한도는 보존된 모든 배포의 함수 저장량 합이다. 프로젝트 보존 설정은 30일(모든 유형)이고, Preview도 Production과 같은 크기의 번들을 저장한다. 하루 15회 배포하면 약 9.6GB가 된다.
2. **같은 모델 번들의 중복.** 모델을 포함한 함수가 3개라 배포마다 약 590MB가 모델 사본이다. 배포 간에도 digest가 매번 새로 생겨 공유되지 않는다(2026-10-18 조사).
3. **Hobby 초과 시 자동 정리 위험.** 2026-10-20에 한도를 넘자 Vercel이 최신 Production 3개와 최신 배포 3개만 남기고 정리한 이력이 있다. 한도를 넘으면 롤백 대상 배포가 사라질 수 있다.

## 3. 계획(우선순위순, 각 단계 별도 승인)

### A. 즉시 여유 확보 — 오래된 배포 정리(승인 필요, 효과 최대 약 5~6GB)
- 유지 후보(롤백 경로): 현재 Production `dpl_AgwysDi1MrMCFVh1AaGccih1dn5C`, 직전 `dpl_7wsj3uWVS3zXy3NayjJFTQMgtDMy`(같은 앱 코드), UI 릴리스 `dpl_HxSWo6BzrNfDTQDwg6NdMBMaYZKw`, 현재 Preview 고정 URL `dpl_8QFiNCRzAc8mKTAuGDe2Vns1fH46`. 합계 약 2.6GB.
- 삭제 후보(약 11개, 약 7GB): 11-18~19의 이전 Preview·canary·폐기 Production. 목록과 각 배포의 역할을 표로 다시 확인받은 뒤 `vercel remove`로 하나씩 삭제한다.
- 효과: 약 2.6GB가 되어 다음 릴리스 여러 번을 배포할 여유가 생긴다.

### B. 보존 정책(승인 필요, 대시보드 설정)
- Preview 보존 기간을 짧게(예: 7일) 설정한다. Production은 롤백을 위해 현행 유지 또는 30일.
- Hobby에서 설정 가능한 범위를 대시보드에서 확인한 뒤 적용한다(현재 30일, `deploymentsToKeep 10`).

### C. 번들 축소(코드 변경, Preview 검증 후 릴리스)
1. 모델을 쓰는 함수를 1개로 모은다. `api/posts/[id]`(수정)와 `/image`의 임베딩 계산을 `api/posts`의 내부 경로 또는 기존 백그라운드 작업(D-2 이미지 작업 큐)으로 넘긴다. 예상: 배포당 약 0.64GB → 약 0.3GB.
2. 이미지 경로(131MB)에 실제로 필요한 모델만 포함되는지 Linux 빌드에서 `.nft.json`으로 확인한다(2026-10-18의 검증 방법 재사용).
3. 회귀: 키워드·의미·통합·이미지 검색 프로브, 임베딩 재계산, 추천 결과 비교(`compare-image-search-deployments.mjs`).
- 주의: Hobby 함수 수 한도(12)에 걸린 이력이 있다. 새 라우트를 늘리지 않는다.

### D. 배포 습관(즉시 적용 가능, 승인 불필요)
- 회귀는 로컬 Preview 빌드(`build-preview.mjs`)로 하고, 호스팅 Preview 배포는 릴리스 후보당 1회로 줄인다.
- 배포 전에 `node scripts/deployments/deploy.mjs <target> --dry-run`으로 계획만 확인한다(이제 실제 배포하지 않는다).
- 배포 전에 보존 배포 수×0.64GB가 8GB를 넘는지 확인한다(이 문서의 측정 방법).

## 4. 권장 순서
1. A(승인 후 즉시): 여유 확보, 롤백 3개와 Preview 1개 유지.
2. D: 바로 적용.
3. B: 대시보드에서 확인 후 적용.
4. C: 다음 릴리스로 진행. Preview 검증 → Production 순.

## 5. 실행 기록 (2026-11-20)

### A. 오래된 배포 정리(사용자 승인, 보수안)
- 직전에 별칭과 라이브 배포를 다시 확인하고, 별칭이 없는 10개를 `vercel remove`로 하나씩 삭제했다: dpl_2c2dVUwx…, dpl_BMcQvpkR…, dpl_ApPnCr6g…, dpl_8ZVdUpqa…, dpl_99h6yK3C…, dpl_Dp777vyv…, dpl_9RCXUS7G…, dpl_EKBdLKrB…, dpl_9NmiRUie…, dpl_9RGngoii….
- 유지: Production `dpl_AgwysDi…`, 롤백 `dpl_7wsj3uWV…`·`dpl_HxSWo6Bz…`·`dpl_ADBchXMB…`(D-3 이전 polling), Preview `dpl_8QFiNCRz…`.
- 결과: 15개 약 9.6GB → 5개 3.20GB. Production 프로브 16/16.

### B. Preview 보존 기간
- 현재 CLI API 목록에는 보존 기간을 바꾸는 공개 엔드포인트가 없다(`PATCH /v9/projects`는 `deploymentExpiration`을 거부). 대시보드에서 Project Settings → Deployment Retention의 Preview 값을 7일로 바꿔야 한다. 바꾼 뒤 `/v9/projects/{id}`의 `deploymentExpiration.expirationDays`로 확인한다.

### C-1. 사진 경로의 모델 제거 (`perf/function-storage-c1`, `0675177`, Preview만)
- 변경: `/api/posts/[id]/image`가 추론하지 않는다. DB 트리거가 이미 큐에 넣은 작업을, 모델을 가진 `/api/posts`(`mode=embedding-maintenance`)에 같은 배포 주소(`VERCEL_URL`)와 cron 인증·자동화 bypass로 처리하도록 요청한다. 실패하면 작업이 큐에 남아 요청 시 복구 또는 일일 cron이 처리한다. DB 변경은 없다.
- 번들(배포당 고유 함수 합): 기존 Preview `dpl_8QFiNCRz…` 639.8MB → 새 Preview `dpl_DfQFL4LB…` **539.4MB(-100.4MB, -15.7%)**. `/image`는 131.1MB → 30.7MB(공용 include의 onnxruntime 때문에 남는다).
- 검증:
  - 단위 273파일 3,028개, 타입·린트 통과.
  - 로컬 16단계 회귀 16/16. 08단계를 강화해 사진 첨부 뒤 PUT이나 `/api/posts` 요청 없이 kick만으로 작업이 768차원으로 완료되는 것을 확인했다.
  - 배포된 실모델 작업: 이전 9.7초 → 새 8.4초. 요청 시 복구 경로라 kick 실패 시의 회복 경로도 입증한다.
  - 이미지 검색 비교 2회: 두 배포의 rank 해시가 동일하다.
  - 작업 프로토콜 24/24(중복 억제, 동일 입력 재사용, 실패·중단 복구, 재시도, 사진 변경 원자적 무효화).
  - 새 Preview 프로브 16/16, error·5xx 0.
- 미검증:
  - 호스팅 Preview에서의 실제 kick 자기 호출(자동화 bypass 헤더)은 로그인 세션이 없어 직접 실행하지 못했다. 로컬에서 같은 코드 경로를 확인했고, Production 배포 직후 로그(`Image job drain request failed` 없음)와 작업 상태로 확인한다.
  - Preview 이미지 글 88개 중 lost 1개에 임베딩이 없다. 변경 전 기준값이 없어 원인을 확정하지 못했다. C-1은 기존 임베딩을 지우지 않는다.
- Production 배포는 하지 않았다(사용자 지시).

### B 확인 (2026-11-20)
- 사용자가 대시보드에서 변경했다. `/v9/projects/{id}`의 `deploymentExpiration`: Preview 7일, Production 30일, canceled·errored 30일, `deploymentsToKeep 10`.

### C-1 호스팅 내부 요청 검증 (2026-11-20, Production 반영 전)
- 원인: 프로젝트 보호가 `all_except_custom_domains`이므로 `VERCEL_URL`(배포 고유 주소)은 Preview와 Production 모두 보호된다. bypass 헤더가 없으면 302(SSO)로 막혀 앱에 닿지 않는다. kick은 Vercel이 런타임에 주입하는 `VERCEL_AUTOMATION_BYPASS_SECRET`(프로젝트 자동화 bypass 1개, 모든 배포보다 먼저 생성, 시스템 변수 노출 ON)을 보낸다. 이 값은 Vercel 문서상 빌드와 런타임에서 모두 쓸 수 있다. 호스팅 Preview는 Google 로그인만 지원하고 배포 AUTH_SECRET은 쓰지 않으므로, 사진 경로 자체 대신 같은 kick 코드를 보호된 배포 주소에 실행해 확인했다.
- 도구: `scripts/operations/verify-image-kick.mjs`(Preview 전용, `node --env-file=.env.preview.local scripts/operations/verify-image-kick.mjs --deployment=https://<preview 배포>.vercel.app`). 일회용 사용자 1명·분실물 2개·Storage 객체 2개를 만들고 manifest(`.vercel/image-kick-<marker>.json`)에 기록하며 finally에서 지운다.
- 결과 `dpl_DfQFL4LB…`: 8/8 통과(1회차는 판정 개수 오기로 false, 8개 검사는 모두 PASS. 수정 후 재실행 8/8).
  - bypass 없이 302(앱 미도달), cron 비밀값 없음·오류 401.
  - 트리거가 작업을 pending으로 넣고, 실제 `kickImageJobs()` 3회 동시 호출이 모두 `sent`, 작업 완료 768차원, `attempts=1`(중복 추론 없음). 완료까지 1.9초·4.1초.
  - kick 없이 5초 동안 pending 유지(유실 없음), 이후 일반 검색 요청의 복구 경로로 완료(2.2~3.5초).
  - 정리: 사용자 618·619, 글 339~342, Storage 객체 삭제, 남은 작업 0, 큐 적체 0.
  - 같은 시간 Preview 로그 error·5xx 0.

### C-1 Production 반영 (2026-11-20 18:24 KST, 사용자 승인)
- 배포: `node scripts/deployments/deploy.mjs production --record-dry-run`(실제 배포, Production DB 이력 쓰기 생략). **`dpl_5r8gc7wQAmwriBH7Tz63n5gSLjgm`** (`381b944`, `mju-lost-found-vercel-8yefiiabm-oyueo.vercel.app`). 직전 Production과 앱 코드 차이는 C-1 세 파일(`next.config.ts`, 사진 경로, `imageJobKick.ts`)뿐이다. DB·Storage·환경 변수·JWT 키 변경 없음.
- 롤백 대상: 직전 Production `dpl_AgwysDi1MrMCFVh1AaGccih1dn5C`(`931864c`, READY). `npx vercel rollback https://<dpl_AgwysDi… URL> --yes`. DB 변경이 없으므로 앱 롤백만으로 복귀한다. 롤백 중 쌓인 작업은 큐에 남고, 이전 배포의 요청 시 복구가 처리한다.
- 번들: 배포당 0.640GB → **0.539GB**. 보존 7개 합계 4.28GB.
- 검증:
  - 공개 프로브 16/16(버전·SHA, 인증 401, maintenance 401, 키워드·의미·통합·이미지 검색, 기존 사진 표시).
  - 이미지 검색: 이전·새 Production을 2회 비교, rankHash 4건 모두 동일.
  - 큐(읽기 전용, `image-job-status.mjs`): 사진 글 80개(found 78, lost 2) 모두 임베딩, 미완료 작업 0, 오류 0.
  - Realtime `private`, 활성 grant 0. Data API 503(OFF). error·5xx 0.
- 남은 확인: Production 실제 사진 등록. 로그인 세션이 필요해 사용자 계정으로 시험 글 1건이 필요하다. 확인 방법: `image-job-status.mjs --since=<등록 시각>`에서 새 글이 `job_completed_current`이면 통과. 로그에서 `POST /api/posts/[id]/image` 직후 배포 고유 주소의 `GET /api/posts`가 200이고 `Image job drain request failed`가 없어야 한다.

### Preview 미임베딩 글 1건(별도 조사 대상)
- Preview lost:182: 2026-11-03 작성(사진 포함), 텍스트 임베딩 있음, 이미지 임베딩 없음, 작업 기록 없음. 작업 큐 마이그레이션(Preview 2026-11-15)과 C-1(2026-11-20)보다 먼저 생긴 상태다. 당시 인라인 이미지 임베딩이 실패한 것으로 보이지만 원인은 확정하지 않았다. 처리 여부는 별도로 정한다(PUT 재분석은 작성자 권한이라 운영 도구로 진행해야 한다). C-1과의 인과는 단정하지 않는다.
