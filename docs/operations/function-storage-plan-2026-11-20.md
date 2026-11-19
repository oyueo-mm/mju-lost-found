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
