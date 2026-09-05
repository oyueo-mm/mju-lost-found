# Phase 15-1 — 이미지 기반 유사도 검색 기술 검증 (PoC 결과)

이 문서는 Phase 15-1의 실제 PoC 실행 결과를 기록한다. **프로덕션 코드는 변경되지 않았다** — 이 문서는 참고용 기록이며, 이 phase에서 커밋되지 않는다.

## 1. 재사용 가능한 기존 인프라

- `@huggingface/transformers` (이미 `package.json`에 `^4.2.0`으로 설치됨) — **새 의존성 추가 없이** `SiglipVisionModel`/`CLIPVisionModelWithProjection`/`AutoProcessor`/`RawImage`를 즉시 사용 가능함을 실제로 확인(`node -e "require('@huggingface/transformers')"`로 export 목록 확인).
- `pipeline("image-feature-extraction", ...)`이라는 전용 파이프라인 태스크가 이미 라이브러리에 존재 — 기존 텍스트 `"feature-extraction"` 파이프라인과 동일한 API 계열이나, 실제 실행 시 Siglip 모델에서 내부 오류(`this.processor is not a function`)가 발생해 이번 PoC에서는 `AutoProcessor`+`SiglipVisionModel`/`CLIPVisionModelWithProjection`를 직접 사용하는 방식으로 우회함(§4).
- `scripts/downloadModel.mjs`의 "pinned commit SHA + SHA256 검증 + `models/` 로컬 저장 + `local_files_only: true`" 패턴은 이미지 모델에도 그대로 재사용 가능한 구조로 판단됨(실제 다운로드 스크립트는 이번 phase에서 작성하지 않음).
- `next.config.ts`의 `outputFileTracingIncludes` 패턴(onnxruntime-node 네이티브 바이너리 + `models/**` 명시적 포함)도 이미지 모델에 동일하게 필요할 것으로 판단되나, **Phase 13-2에서 실제로 겪은 Vercel Hobby 12-함수 제한**을 그대로 다시 마주칠 가능성이 높음(§6).
- pgvector + HNSW 인덱스(`prisma/migrations/20260905102654_add_post_embeddings/migration.sql`)는 이미지 벡터 컬럼에도 동일한 방식(별도 컬럼 + 별도 HNSW 인덱스)으로 확장 가능한 구조.
- `LostPost.embedding`/`FoundPost.embedding`이 `Unsupported("vector(768)")`, nullable, `$queryRaw` 전용으로 다뤄지는 기존 패턴 — `imageEmbedding` 컬럼도 동일한 접근이 그대로 적용 가능.

## 2. 후보 모델 조사 결과 (실제 확인, 추측 아님)

| 항목 | CLIP ViT-B/32 | SigLIP base-patch16-224 |
|---|---|---|
| Repository | `openai/clip-vit-base-patch32` (원본) / `Xenova/clip-vit-base-patch32` (ONNX 변환) | `google/siglip-base-patch16-224` (원본) / `Xenova/siglip-base-patch16-224` (ONNX 변환) |
| 라이선스 | **HF API 조회 결과 `cardData.license` 필드 없음.** 원본 모델 카드 "Out-of-Scope Use Cases"에 "Any deployed use case of the model - whether commercial or not - is currently out of scope."라고 명시(직접 fetch로 확인) | **`apache-2.0`** (HF API `cardData.license` 필드로 직접 확인) |
| 출력 차원 | 512 (image_embeds) | 768 (pooler_output) |
| Vision-only 양자화 ONNX 크기 | `vision_model_quantized.onnx` **89.1MB** (HTTP HEAD로 실측) | `vision_model_quantized.onnx` **99.5MB** / `vision_model_uint8.onnx` **94.1MB** (HTTP HEAD로 실측) |
| ONNX/Transformers.js 지원 | Xenova 변환 저장소 존재, `CLIPVisionModelWithProjection` export 확인(로컬 설치된 `@huggingface/transformers` v4.2.0에서 직접 확인) | Xenova 변환 저장소 존재(`Xenova/siglip-base-patch16-224` 등 6개 해상도/크기 변형), `SiglipVisionModel` export 확인 |
| CPU inference | 가능 (PoC로 실제 확인) | 가능 (PoC로 실제 확인) |

**결론: 두 모델 모두 기술적으로는 동등하게 실행 가능하지만, 라이선스 측면에서 SigLIP(Apache-2.0)이 CLIP(라이선스 태그 없음 + 원본 카드의 "배포 사용 범위 외" 명시)보다 훨씬 안전하다.** 실제 배포 서비스에 CLIP을 쓰려면 별도 법률 검토가 필요하다고 판단.

## 3. 최종 추천 모델

**`Xenova/siglip-base-patch16-224`(vision tower만 사용) 추천.**

이유:
1. Apache-2.0 라이선스 — 상업/실서비스 배포에 대한 명확한 허가.
2. 실제 PoC에서 "동일 물건 > 같은 종류 다른 물건 > 유사 외형 다른 카테고리 > 무관한 물건"이라는 요구 경향이 CLIP보다 더 뚜렷하게 관찰됨(§4).
3. 기존 텍스트 파이프라인과 동일한 `@huggingface/transformers` 라이브러리, 동일한 "vision-only 서브모델 파일" 구조(Xenova 변환 저장소가 `vision_model_*.onnx`를 별도 파일로 이미 제공)로 텍스트 인프라와 동일한 패턴 재사용 가능.

CLIP은 추론 속도가 더 빠르고 파일이 더 작다는 장점이 있어(§5), latency가 심각한 병목으로 판명될 경우의 대안으로 남겨둔다.

## 4. 실제 PoC 결과 (real cosine similarity)

**방법**: Wikimedia Commons의 CC0/CC-BY/CC-BY-SA 라이선스 실제 사진 6장(에어팟 2장, 에어팟 프로 1장, 유선 이어폰 1장, 지갑 1장, 우산 1장)을 다운로드해 `SiglipVisionModel`/`CLIPVisionModelWithProjection`으로 임베딩 후 코사인 유사도 계산. 이미지는 프로젝트 저장소에 커밋하지 않았고(스크래치패드에서만 사용), PoC 종료 후 전량 삭제함.

### SigLIP (Xenova/siglip-base-patch16-224, quantized)

| Query | Candidate | Similarity | 관계 |
|---|---|---|---|
| AirPods A | AirPods B | **0.9217** | 동일 물건(다른 사진) |
| AirPods A | AirPods Pro | 0.8992 | 같은 종류, 다른 물건 |
| AirPods A | 유선 이어폰(iPod Earbuds) | 0.6883 | 유사 외형, 다른 카테고리 |
| AirPods A | 지갑 | 0.5700 | 무관한 물건 |
| AirPods A | 우산 | 0.4930 | 무관한 물건 |

→ **요구된 경향(동일 > 같은 종류 다른 물건 > 유사 외형 > 무관)이 정확히 관찰됨.**

### CLIP ViT-B/32 (Xenova/clip-vit-base-patch32, quantized) — 비교용

| Query | Candidate | Similarity | 관계 |
|---|---|---|---|
| AirPods A | AirPods B | 0.8356 | 동일 물건(다른 사진) |
| AirPods A | AirPods Pro | 0.7062 | 같은 종류, 다른 물건 |
| AirPods A | 유선 이어폰 | 0.6927 | 유사 외형, 다른 카테고리 |
| AirPods A | 지갑 | 0.4862 | 무관한 물건 |
| AirPods A | 우산 | 0.3477 | 무관한 물건 |
| AirPods Pro | 유선 이어폰 | **0.8070** | (같은 종류-다른 물건 쌍보다 더 높은 이상 신호) |

CLIP도 전반적 경향은 맞지만, "AirPods Pro ↔ 유선 이어폰"이 "AirPods ↔ AirPods Pro"보다 더 높은 유사도(0.807 > 0.706)를 보여 — **작고 흰 이어버드류 물체를 카테고리 구분 없이 뭉뚱그리는 false-positive 경향이 SigLIP보다 뚜렷함.** 이는 §7-2(같은 카테고리 false positive) 관점에서 SigLIP 우위를 뒷받침하는 실측 근거.

## 5. 성능 실측

| 항목 | SigLIP (patch16) | CLIP (patch32) |
|---|---|---|
| Model load (파일 로컬 캐시 상태) | 1,369ms | (최초 다운로드 포함 15,742ms — 순수 로드 시간 아님) |
| RSS (모델 로드 후) | 458.4MB | 444.0MB |
| RSS (이미지 6장 임베딩 후) | 641.8MB | 547.7MB |
| 개별 이미지 추론 | 172~291ms | 68~196ms |
| Warm 재추론(동일 이미지) | 304ms | 148ms |
| Embedding 차원 | 768 | 512 |

측정 환경: 로컬 Windows, Node.js 24 (win32) — Vercel의 실제 Linux 컨테이너 수치와는 다를 수 있음(기존 텍스트 모델도 로컬 대비 Vercel 콜드스타트가 더 크게 측정된 전례가 있음, Phase 6/7 문서 참고). **Vercel Production에서의 실측은 이번 phase에서 수행하지 않았다** — Phase 15-1은 "실제 코드 미구현" 원칙이므로 배포 자체를 하지 않았다.

패치 크기가 작을수록(SigLIP patch16 = 196 패치 vs CLIP patch32 = 49 패치) 정확도는 더 좋지만 추론 비용은 더 크다는, 일반적으로 알려진 트레이드오프가 실측으로도 그대로 재현됨.

## 6. Vercel 적합성 판단

- **Serverless Function bundle size**: vision-only quantized ONNX 파일이 89~99MB — 기존 텍스트 모델(111MB)과 같은 자릿수. 기술적으로 같은 방식(`outputFileTracingIncludes` + `models/**`)으로 포함 가능할 것으로 판단.
- **Hobby 12-함수 제한(실제 겪은 문제)**: Phase 13-2에서 이미 "새 `outputFileTracingIncludes` 항목을 추가하면 그 라우트가 공유 번들에서 분리되어 별도 함수가 되고, 기존 12개 한도를 초과한다"는 것을 **실제로** 확인했다. 이미지 임베딩용 라우트를 하나 더 추가하면 동일한 문제가 재발할 가능성이 매우 높다 — **Phase 13-2에서 이미 채택한 "무거운 모델을 쓰는 라우트를 늘리지 않고, 기존 라우트에 대한 fetch로 위임"하는 패턴을 그대로 재사용해야 할 것**으로 판단(신규 함수를 만들지 않고 `/api/posts`류의 기존 함수 하나에 이미지 임베딩 로직도 함께 태우는 방식).
- **`/tmp` 등 ephemeral filesystem 의존 여부**: 텍스트 모델과 동일하게 빌드타임에 `models/`에 다운로드해두고 `local_files_only: true`로 실행하면 런타임에 `/tmp` 쓰기가 전혀 필요 없다 — 이 패턴 그대로 재사용 가능.
- **메모리**: 로컬 실측 RSS가 458~642MB로, 기존 텍스트 모델(문서상 ~230MB)의 약 2~3배. **텍스트 모델과 이미지 모델을 같은 요청/함수 안에서 동시에 메모리에 올리는 경우** 합산 RSS가 700MB~1GB에 근접할 수 있어, Vercel 함수 메모리 한도(설정에 따라 다르나 여유가 크지 않을 수 있음)를 실제로 압박할 가능성이 있음 — Phase 15-2에서 반드시 실측 필요.
- **native ONNX runtime dependency**: 기존과 동일한 `onnxruntime-node` 네이티브 addon을 그대로 사용(추가 의존성 없음).

**종합 판단**: 기술적으로는 실행 가능하나, **"새 라우트 추가 = 함수 개수 한도 초과"라는 이미 실제로 겪은 제약이 이미지 임베딩에도 동일하게 적용될 것이 거의 확실**하므로, Phase 15-2 설계 단계에서부터 "어느 기존 함수에 얹을 것인가"를 먼저 결정해야 한다.

## 7. DB 설계 제안 (실제 migration 없음, 제안만)

```prisma
// LostPost / FoundPost 각각에 추가 (실제로는 아직 적용하지 않음)
imageEmbedding Unsupported("vector(768)")?
```

- 차원: SigLIP 채택 시 **768**(CLIP 채택 시 512) — 기존 텍스트 `embedding` 컬럼과 우연히 같은 차원(768)이 될 수 있으나 **의미가 다른 벡터이므로 반드시 별도 컬럼**으로 관리(이번 phase 지시사항과 일치).
- 인덱스: 기존과 동일하게 `USING hnsw ("imageEmbedding" vector_cosine_ops)`.
- Nullable, 기존 `embedding`과 동일한 "없으면 검색에서 제외" 정책 재사용.

## 8. 이미지 lifecycle 처리 전략 (제안)

| 상황 | 처리 |
|---|---|
| 새 이미지 업로드(생성/수정) | 업로드 성공 후 `imageEmbedding` 재계산 — 기존 `embedPostBestEffort()`(텍스트)와 동일한 "post-commit, best-effort, 실패해도 게시물 자체는 유지" 패턴 재사용 |
| 이미지 삭제(제거만, 새 이미지 없음) | `imageEmbedding = NULL` |
| 이미지 변경 없음(제목/설명만 수정 등) | 기존 `imageEmbedding` 유지 — 기존 `EMBEDDING_INPUT_FIELDS` 체크(변경된 필드가 있을 때만 재임베딩)와 동일한 원리를 `imageUrl` 필드 하나에 적용 |
| 원래 이미지 없음 | `imageEmbedding = NULL`, 이미지 검색에서 자동 제외, 텍스트 검색/기존 매칭에는 영향 없음 |

## 9. UX 추천

네 가지 후보(A: 게시글 상세 "이 사진과 비슷한 분실물", B: 독립 이미지 업로드 검색, C: 기존 검색에 통합, D: AI 매칭에 결합) 중:

- **1차로는 방법 A(게시글 상세에 "이 사진과 비슷한 게시물")를 추천.** 이유: 이미 이미지가 있는 게시글이라는 확실한 쿼리 소스가 있어 별도 업로드 UI가 필요 없고, 기존 `findSimilarPosts()`(같은 게시글 기반 유사도 검색)와 구조적으로 거의 동일 — 재사용성이 가장 높음.
- 방법 B(독립 이미지 업로드 검색)는 UX 가치는 크지만 "업로드된 임시 이미지"를 어디에 저장/폐기할지의 정책이 새로 필요해 복잡도가 큼 — 2차 후보.
- 방법 C(검색에 이미지 모드 통합)는 Phase 12/13에서 이미 구축한 "keyword/semantic 토글" UI를 확장하는 형태라 UI 일관성은 좋으나, "업로드 이미지" 자체가 필요해 결국 B의 하위 문제를 포함함.
- 방법 D(텍스트+이미지 결합 스코어)는 §14 지시대로 이번 phase 범위 밖이며, 결합 가중치를 정하려면 실사용 데이터가 필요해 성급히 결정하면 안 됨.

**"이미지 유사도 = 동일 물건 판정"으로 절대 표현하지 말 것**(§13 지시 재확인) — UI 카피는 "AI 유사도"가 아니라 반드시 "사진이 비슷한 게시물" 같은 검색-후보 뉘앙스로 표현.

## 10. Phase 15-2 제안

1. **함수 배치 전략을 먼저 확정**: 새 API 라우트를 만들지, 아니면 `/api/posts`(이미 이미지 모델 파일을 포함할 수 있는 기존 함수)에 이미지 임베딩 계산을 얹을지 — Phase 13-2의 12-함수 제한 경험을 바탕으로 설계.
2. `imageEmbedding` 컬럼 + HNSW 인덱스 실제 migration.
3. `embedPostBestEffort()`와 동일한 패턴의 `embedPostImageBestEffort()`(가칭) — 업로드/삭제/미변경 3가지 lifecycle 처리.
4. 게시글 상세 페이지의 "이 사진과 비슷한 게시물" (UX 방법 A) 구현.
5. Vercel Production에서 실제 콜드/웜 latency, 메모리 재측정(로컬 수치와의 괴리 확인).
6. 텍스트 모델과 이미지 모델을 동시에 로드했을 때의 실제 메모리 사용량 측정(§6에서 제기한 우려의 실측 검증).
