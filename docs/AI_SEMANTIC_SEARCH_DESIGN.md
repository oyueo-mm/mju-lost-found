# AI 자연어 의미 검색 설계 (Phase 12-1)

> Phase 12-1 산출물. 작성 기준: `vercel` 브랜치, 커밋 `2048464`(Phase 10) 위에 Phase 11 변경사항이 아직 커밋되지 않은 작업 트리 상태, 2026-09-05.
> **이 문서는 설계 전용이다 — 이번 Phase에서 코드/스키마/의존성 변경은 전혀 없다.** 실제 코드(`src/lib/posts/*`, `src/lib/ai/*`, `src/app/api/posts/route.ts`, `src/components/search/*`, `main:ai/search.py` 등)를 직접 읽고 확인한 내용만 근거로 작성했다.

---

## 1. 현재 검색 구조

### 1.1 키워드 검색 (실제 코드 기준)

- **API**: `GET /api/posts`(`src/app/api/posts/route.ts`) — `runtime = "nodejs"`가 **파일 레벨로 이미 선언**되어 있다(POST의 임베딩 추론 때문). 즉 이 라우트에 AI 검색을 추가해도 런타임 설정을 새로 할 필요가 없다.
- **Query schema**: `src/lib/posts/schema.ts`의 `listQuerySchema` — `type`(lost/found/all) · `q`(≤100자) · `category` · `location` · `status`(Phase 9, 보드별 실제 enum만 허용, `type=all`과 조합 시 거부) · `dateFrom`/`dateTo` · `sort`(latest/oldest) · `page`/`limit`.
- **Service**: `src/lib/posts/service.ts`의 `searchPosts()` → `type`에 따라 `listLostPosts()`/`listFoundPosts()`/`searchAllPosts()`로 dispatch. `buildSearchWhere()`가 실제 필터 로직: `q`는 `title OR description`에 대한 **대소문자 무시 `contains`**(Prisma `mode: "insensitive"`, PostgreSQL 전용), `category`는 정확히 일치, `location`은 부분 일치, `status`는 보드별 Prisma enum으로 변환.
- **`type=all`(통합 검색)의 실제 구현**: Prisma가 두 테이블 간 UNION을 지원하지 않아 `searchAllPosts()`가 LostPost/FoundPost를 **각각 별도 쿼리**한 뒤 메모리에서 병합·정렬한다(`page*limit`, 최대 1000행 캡). `total`/`totalPages`는 별도 COUNT 쿼리로 정확하게 계산.
- **UI**: `SearchFilterBar.tsx`(클라이언트 컴포넌트, `/lost`·`/found`·`/search` 공용) — 검색어 입력창 + 카테고리/상태 select(Phase 9에서 canonical화) + 위치 입력 + 정렬 select, 폼 제출 시 URL query string으로 이동(서버 컴포넌트가 `searchParams`로 읽음 — 새로고침해도 상태 유지).
- **`PostCard.tsx`**: 제목/상태/카테고리/위치/작성일만 표시, 유사도 점수 같은 필드는 없음(현재는 키워드 검색만 있으므로 당연히 없음).

### 1.2 레거시 Streamlit의 검색 동작 (`main` 브랜치 실제 코드)

- `pages/1_찾아요.py`/`pages/2_찾았어요.py` 각각의 게시판 안에 `st.radio`로 **"키워드 검색" vs "AI 의미 검색"** 두 모드가 있다(별도 페이지가 아니라 같은 검색 폼 안의 모드 전환).
- **AI 의미 검색은 항상 "반대편 게시판"을 검색한다** — 찾아요(분실물) 게시판에서 AI 의미 검색을 하면 습득물(FoundPost) 후보를 찾고, 그 반대도 마찬가지다(`ai/search.py::search_similar_posts()`, 호출부는 `db.search_found_posts()`/`db.search_lost_posts()`로 후보 풀을 가져와 검색). 이는 "내가 잃어버린/주운 물건을 설명하면 반대쪽에서 그 물건을 찾아준다"는 UX 의도이며, 이미 구현되어 있는 "AI로 유사한 OO 찾기"(Next.js `MatchPanel`)와 사실상 동일한 방향성 로직을 **자유 텍스트 입력**으로 수행하는 것이다.
- `ai/search.py::search_similar_posts(query, posts, top_k=10)`: 쿼리를 그대로 `embedding.get_embedding(query)`로 임베딩(별도 전처리 없음), 후보들은 `embedding.build_embedding_text()`로 구성 후 임베딩, `matching.cosine_similarity()`로 점수 계산, `top_k`만큼 정렬 반환. **유사도 threshold 없음.**

## 2. 기존 AI embedding/vector search 구조

| 구성요소 | 실제 코드/상태 |
|---|---|
| Provider | `src/lib/ai/embedding.ts`의 `TransformersEmbeddingProvider` — `jhgan/ko-sroberta-multitask`, int8 ONNX, **모듈 static 캐시**(프로세스당 1회 로드) |
| 차원 | `EMBEDDING_DIMENSIONS = 768` |
| 문서 임베딩 입력 | `buildEmbeddingText()` — `title + description + category + location`을 공백으로 join(빈 필드 skip), 레거시 `ai/embedding.py::build_embedding_text()`와 동일 |
| DB 컬럼 | `LostPost.embedding`/`FoundPost.embedding` — `vector(768)`, nullable, Prisma `Unsupported` |
| 인덱스 | HNSW, `vector_cosine_ops`(Phase 6 마이그레이션, 실제 Supabase에 적용 확인됨) |
| 검색 헬퍼 | `src/lib/ai/vectorSearch.ts::findSimilarPosts(sourceType, sourcePostId, topK)` — **소스가 항상 "이미 존재하는 게시글의 id"** 라는 게 이번 설계에서 가장 중요한 제약(§3.1에서 설명) |
| 점수 변환 | `matching.ts::normalizeScore()` — 코사인 유사도 `[-1,1]` → `[0,1]` |
| 저장 | `postEmbedding.ts::embedPostBestEffort()` — 게시글 생성 시 항상, 수정 시 관련 필드가 바뀐 경우만(Option B, 실패해도 게시글 저장은 성공) |
| Runtime | `nodejs`로 API 라우트에 명시(Edge 금지) — `/api/posts`에 **이미 선언되어 있음** |
| 모델 배포 | `scripts/downloadModel.mjs`(Phase 7-B) — build-time에 Hugging Face Hub에서 고정 revision + SHA256 검증 후 다운로드, git에는 커밋 안 함 |
| 실배포 검증 | Phase 6~7에서 **실제 Vercel 배포**로 검증 완료(문서: `docs/AI_MATCHING_ARCHITECTURE.md`) |

## 3. Semantic Search 설계안

### 3.1 왜 `findSimilarPosts()`를 그대로 재사용할 수 없는가

`findSimilarPosts()`는 SQL CTE로 `SELECT embedding FROM "LostPost" WHERE id = ${sourcePostId}`처럼 **"이미 DB에 저장된 게시글의 임베딩"**을 소스로 삼는다. 자연어 검색어는 DB에 저장된 행이 아니므로 이 함수를 그대로 쓸 수 없다 — **새 함수가 반드시 필요**하지만, 기존 함수의 구조·연산자·점수 변환은 전부 재사용 가능하다.

### 3.2 신규 함수 설계 (구현 시 `vectorSearch.ts`에 추가할 것을 제안)

```ts
// 설계안 -- 아직 구현하지 않음
export async function findPostsBySemanticQuery(
  targetTable: "LostPost" | "FoundPost",
  queryVector: number[],
  topK: number,
  extraWhere?: { category?: string; status?: PrismaEnum },
): Promise<VectorSearchResult[]> {
  // SELECT id, 1 - (embedding <=> ${vectorLiteral}::vector) AS similarity
  // FROM "LostPost"  -- 또는 FoundPost, 항상 리터럴
  // WHERE embedding IS NOT NULL [AND category = ...] [AND status = ...]
  // ORDER BY embedding <=> ${vectorLiteral}::vector, id  -- id는 동점 시 안정적 페이지네이션용
  // LIMIT ${topK}
}
```

- `queryVector`는 **Node 쪽에서 `getEmbeddingProvider().embed(query)`로 이미 계산된 값**을 그대로 넘긴다 — `saveEmbedding()`이 이미 쓰고 있는 `[0.1,0.2,...]::vector` 리터럴 캐스팅 패턴을 그대로 재사용.
- 테이블명은 `findSimilarPosts()`와 동일하게 **항상 리터럴**(절대 문자열로 조립하지 않음, SQL 인젝션 불가) — `sourceType`에 따라 두 개의 완전히 분리된 리터럴 SQL 분기를 쓰는 기존 패턴을 그대로 따른다.
- `1 - (... <=> ...)` → `normalizeScore()` 동일 재사용 — 점수 스케일이 기존 매칭 기능과 완전히 동일하게 유지된다.

### 3.3 Threshold

**두지 않는 것을 권장한다.** 근거: (a) 레거시 `search_similar_posts()`도 threshold가 없다, (b) Phase 6에서 이미 "레거시의 threshold-less 정책을 유지한다"고 명시적으로 결정했고 매칭 기능에 그대로 적용되어 있다(`docs/AI_MATCHING_ARCHITECTURE.md`) — 이 결정과 일관성을 깨지 않는 것이 좋다. 대신 §5(UI 설계)에서 다루듯, 결과가 있지만 유사도가 낮을 때는 **UI에서 부드럽게 안내**(하드 컷오프가 아니라 "유사도가 낮을 수 있어요" 같은 캡션)하는 방식을 제안한다.

## 4. API 설계

### 4.1 검색 대상 범위 — Option A vs B

| | A. LostPost+FoundPost 단일 semantic 대상 | B. `type`에 따라 lost/found/all 분리(기존 키워드 검색과 동일 모델) |
|---|---|---|
| 기존 UX와의 정합성 | 낮음 — `/lost`, `/found`가 이미 보드별로 분리되어 있는데 semantic만 항상 섞으면 혼란 | **높음** — 기존 `q`/`category`/`status` 필터가 이미 `type`별로 동작 |
| 레거시 정합성 | 레거시는 애초에 "반대편 게시판만" 검색(A도 B도 아닌 제3의 방식) | 레거시와 다름(§1.2) — 단, 레거시의 그 자동-반대편 로직은 게시판 안에 통합 검색 폼이 없었기 때문에 나온 설계였고, Next.js는 이미 `/search`(통합, 레거시에 없던 신규 기능, Phase 8 문서 확인)가 있음 |
| 구현 복잡도 | 낮음(테이블 하나만 안 봐도 됨 — 사실은 두 테이블 다 봐야 하니 A가 오히려 B의 `type=all`과 동일 코드) | `type=lost`/`found`는 단순, `type=all`은 기존 `searchAllPosts()`처럼 두 번 쿼리 후 병합 필요 |

**권장: B.** 이유는 §6에서 자세히 다루지만 핵심은 "키워드 검색과 동일한 정신 모델(내가 선택한 범위 안에서 검색)"을 유지해야 사용자가 두 검색 모드를 오갈 때 혼란이 없다는 것이다. 레거시의 "자동으로 반대편만" 로직은 채택하지 않는다 — 그 로직은 게시판이 분리되어 있고 통합 검색이 없던 레거시 UI 구조의 산물이며, Next.js는 이미 `/search`로 통합 검색을 제공하고 있어 사용자가 `type` 필터로 명시적으로 범위를 고르는 것이 이 앱의 기존 설계와 더 일치한다.

### 4.2 엔드포인트 — 신규 라우트 vs 기존 확장

**권장: 기존 `GET /api/posts`(`type`+`q` 파라미터)를 확장**하고, **새 라우트를 만들지 않는다.**

제안 형태:
```
GET /api/posts?type=lost&mode=semantic&q=검은색 에어팟을 도서관에서 잃어버렸어요
```
- `mode` 파라미터(기본값 `"keyword"`, 명시적으로 `"semantic"`일 때만 AI 검색) 추가 — **breaking change 없음**: 기존 클라이언트/테스트가 `mode`를 안 보내면 지금과 100% 동일하게 동작.
- `listQuerySchema`에 `mode: z.enum(["keyword", "semantic"]).optional().default("keyword")` 추가, `mode === "semantic"`이면서 `q`가 없으면 400(레거시도 빈 쿼리는 결과 없이 조기 반환).
- `mode=semantic`은 `type=all`과 함께는 **거부**하는 것을 제안(§3.4의 status 필터와 동일한 이유 — 나중에 구체적으로 §7에서 설명) — 아니면 A안처럼 두 테이블을 합쳐야 하는데, semantic 병합은 키워드 병합(단순 `createdAt` 정렬)과 달리 **유사도 점수로 다시 정렬**해야 해서 `searchAllPosts()`를 그대로 재사용할 수 없다. `type=lost`/`found` 각각은 신규 `findPostsBySemanticQuery()` 한 번으로 충분히 해결된다.
- `GET /api/posts` 라우트는 이미 `runtime = "nodejs"`이므로 여기에 실제 모델 추론을 추가해도 런타임 설정 변경이 필요 없다(Edge에서 절대 실행되지 않음, §1.1 재확인).

## 5. UI 설계

- **새 디자인 시스템을 만들지 않는다** — `SearchFilterBar.tsx`에 **검색 모드 토글**(레거시의 `st.radio` 그대로: "키워드 검색" / "AI 의미 검색") 하나만 추가하는 것을 제안. 토글이 "AI 의미 검색"일 때만 `mode=semantic`을 쿼리에 실어 보낸다.
- 카테고리/상태 필터는 **AI 의미 검색 모드에서도 그대로 유지**(§4.2의 신규 SQL 함수가 `extraWhere`로 이미 받도록 설계) — 사용자가 "카테고리=지갑이면서 의미로 검색"을 기대할 수 있으므로 끄지 않는다.
- 결과 없음: 기존 각 페이지의 "검색 결과가 없습니다" 문구 그대로 재사용 가능(빈 배열은 빈 배열).
- **유사도가 낮은 결과**: threshold로 자르지 않는 대신(§3.3), `PostCard` 옆에 유사도 점수를 `MatchPanel`이 이미 하는 방식(`유사도 {Math.round(score*100)}%`)과 동일하게 노출해 사용자가 스스로 판단하게 한다 — 이러려면 `PostCard`가 optional `score` prop을 받도록 아주 작게 확장하거나, semantic 검색 결과 전용의 얇은 wrapper를 만드는 정도로 충분하다(전면 개편 아님).
- 로딩 상태: 실제 모델 추론이 걸리므로(콜드 ~1초, §10) 검색 버튼에 기존 `MatchPanel`/`PostForm`이 이미 쓰는 "처리 중..." 스타일의 pending 상태를 그대로 재사용.
- 모바일: `SearchFilterBar`는 이미 `flex flex-wrap`이라 토글 하나 추가되어도 기존 반응형 동작이 깨지지 않는다(Phase 9에서 상태 필터 추가 때도 같은 컨테이너에 넣고 별도 브레이크포인트 변경 없이 확인된 패턴).

## 6. Keyword Search와의 관계

**병행(keyword + semantic 모드 전환), 완전 대체 아님.** 근거:

1. 레거시도 완전 대체가 아니라 **모드 선택**이었다(§1.2) — 이미 검증된 UX 패턴.
2. Semantic search는 매 요청마다 실제 모델 추론이 필요해(§10) 키워드 검색보다 느리고, 짧은 키워드(예: "지갑")에는 오히려 키워드 검색이 더 빠르고 예측 가능하다 — 완전 대체 시 이런 경우 사용자 경험이 나빠진다.
3. 두 모드 모두 category/status/location은 **DB WHERE 필터로 동일하게 적용**하고, `q`만 keyword(`contains`) 또는 semantic(임베딩+코사인)으로 갈리는 구조로 설계하면 필터 로직 중복이 없다.

## 7. DB/pgvector 변경 필요 여부

**필요 없다.** `vector(768)` 컬럼, HNSW 인덱스, `<=>` 연산자, `normalizeScore()` 전부 이미 존재하고 그대로 재사용된다. 신규 마이그레이션, 신규 컬럼, 신규 인덱스 없음.

- **embedding이 NULL인 게시글**: `WHERE embedding IS NOT NULL`로 자동 제외 — 이미 매칭 기능이 쓰는 패턴 그대로(임베딩 생성이 실패했거나 아직 안 된 게시글은 semantic 결과에 안 보일 뿐, 에러도 아니고 키워드 검색에서는 여전히 보임).
- **삭제/정지 게시글**: 게시글은 CASCADE로 실제 삭제되므로 애초에 테이블에 없다. 정지된 사용자의 기존 게시글은 — 실제 코드 확인 결과 이 앱 어디에도 "작성자가 정지됨"을 이유로 게시글을 목록에서 숨기는 로직이 없다(정지는 신규 액션만 차단, 기존 컨텐츠 열람은 항상 허용). Semantic 검색도 이 기존 정책과 동일하게 두는 것을 제안 — 별도 필터를 추가하지 않는다.
- **페이지네이션**: `ORDER BY embedding <=> vec, id LIMIT/OFFSET`으로 가능하나(§3.2의 `id` 타이브레이커), `type=all` 병합처럼 인메모리 재정렬이 필요 없어 오히려 키워드 검색의 `type=all`보다 구현이 단순하다. 단, `mode=semantic`은 `type=all`을 거부하도록 설계했으므로(§4.2) 이 페이지네이션은 항상 단일 테이블 대상이라 SQL `OFFSET`을 그대로 쓸 수 있다.

## 8. 예상 변경 파일 (Phase 12-2에서, 이번 Phase는 변경 없음)

- `src/lib/ai/vectorSearch.ts` — `findPostsBySemanticQuery()` 추가(§3.2)
- `src/lib/posts/schema.ts` — `listQuerySchema`에 `mode` 필드 추가 + `superRefine`에 `mode=semantic` 관련 규칙(예: `type=all` 조합 거부, `q` 필수) 추가
- `src/lib/posts/service.ts` — `searchPosts()`가 `mode=semantic`일 때 새 경로로 분기하는 로직 추가(신규 함수 또는 기존 함수 확장)
- `src/app/api/posts/route.ts` — 변경 없을 가능성 높음(이미 `searchPosts()`에 위임하는 구조이므로 스키마/서비스만 바뀌면 라우트 자체는 그대로일 수 있음) — 구현 시 재확인
- `src/components/search/SearchFilterBar.tsx` — 모드 토글 추가
- `src/components/post/PostCard.tsx` 또는 신규 wrapper — 유사도 점수 표시(선택적 prop)
- `src/app/(main)/lost/page.tsx`, `found/page.tsx`, `search/page.tsx` — `mode` 파싱/전달

## 9. 예상 테스트 전략

이 프로젝트의 기존 컨벤션(무거운 실제 모델은 유닛 테스트에서 절대 로드하지 않음, mock provider만 사용)을 그대로 따른다.

- **schema 레벨**: `mode=semantic`+`q` 조합 검증, `mode=semantic`+`type=all` 거부, `q` 없이 `mode=semantic`이면 거부 — `search.schema.test.ts`에 추가.
- **service 레벨**: `findPostsBySemanticQuery()`를 mock된 `prisma.$queryRaw`로 — 기존 `vectorSearch.test.ts`의 `boundValues()` 헬퍼(파라미터 바인딩 검증)를 그대로 재사용해 SQL 인젝션 불가함을 계속 증명.
- **embedding provider mock**: `embedding.test.ts`가 이미 하는 것처럼 `getEmbeddingProvider()`를 mock해 쿼리 임베딩 호출 여부/횟수만 검증(실제 모델 절대 로드 안 함).
- **실제 모델 검증**: Phase 6~7과 동일하게 **별도의, 빠른 테스트 스위트 밖의 실제 DB 통합 스크립트**(임시 게시글 생성 → 실제 검색 → 정리)로 필수 한국어 테스트 문장 쌍(이미 Phase 6에서 쓴 "검은색 에어팟..." 등)을 재사용해 순위 검증.

## 10. 성능/비용/Vercel Runtime 고려사항

- **비용**: 추가 비용 없음 — 자체 호스팅 모델(Phase 5~7에서 이미 결정), Supabase pgvector도 기존 DB 그대로.
- **Runtime**: `/api/posts`에 `runtime = "nodejs"`가 이미 선언되어 있어 추가 설정 불필요, Edge 실행 위험 없음.
- **지연 시간(실측치, `docs/AI_MATCHING_ARCHITECTURE.md` §16, §17 재인용)**: Vercel 실배포 기준 콜드 임베딩 ~997~1028ms, 웜 ~20~75ms, pgvector 검색 자체는 ~187ms 내외. **키워드 검색과 비교해 semantic 검색은 콜드 스타트 상황에서 체감 지연이 눈에 띄게 크다** — 검색은 게시글 작성보다 훨씬 빈번한 액션일 수 있으므로, 트래픽이 적은 초기에는 콜드 인스턴스 비율이 상대적으로 높아 체감 지연이 잦을 수 있다는 리스크를 이미 `AI_MATCHING_ARCHITECTURE.md` §17.9가 지적한 바 있고, 이번 기능에도 동일하게 적용된다.
- **동시 요청**: `TransformersEmbeddingProvider`는 이미 모듈 static 캐시로 프로세스당 1회만 모델을 로드 — 검색 기능 추가로 이 부분이 새로 필요해지는 것은 없다(기존 매칭 기능과 완전히 동일한 세션 재사용 이점을 그대로 얻는다).

## 11. 구현 난이도 및 위험요소

- **난이도: 낮음~중간.** 새 모델/새 인프라가 전혀 필요 없고, 기존 임베딩 파이프라인·pgvector 인덱스·Node.js runtime 설정을 그대로 확장하는 작업이라 Phase 6~7 대비 리스크가 훨씬 낮다. 가장 손이 많이 갈 부분은 `type=all` semantic을 어떻게 다룰지(이 설계는 거부로 단순화 제안, §4.2)와 UI 토글의 자연스러운 배치(§5) 정도다.
- **위험요소**:
  1. **콜드 스타트 체감 지연**(§10) — 완화책: 검색 버튼에 명확한 로딩 인디케이터, 필요하면 "AI 검색은 첫 요청이 느릴 수 있어요" 안내 문구.
  2. **`type=all` semantic의 병합 정렬 복잡도** — 이번 설계는 이를 피하기 위해 `type=all`+`mode=semantic` 조합 자체를 거부하는 것을 제안했다(status 필터가 이미 쓰는 것과 동일한 "모호한 조합은 아예 막는다" 원칙, Phase 9 선례).
  3. **레거시와의 UX 차이**(자동 반대편 검색이 아님, §4.1) — 사용자 혼란 가능성. 완화책: 검색 결과 안내 문구로 "선택한 게시판에서 의미가 비슷한 게시글을 찾습니다"처럼 명확히 표시.
  4. **빈 쿼리/공백만 있는 쿼리** — 레거시처럼 모델 호출 없이 조기에 빈 배열/400 처리해야 불필요한 추론 비용을 막는다(레거시 `search_similar_posts()`가 이미 이렇게 함, 그대로 재사용).

## 12. 권장 Phase 12-2 구현 순서

1. `listQuerySchema`에 `mode` 필드 + 유효성 규칙 추가(스키마 레벨 테스트 먼저 작성 — TDD로 진행 가능한 가장 안전한 시작점).
2. `vectorSearch.ts`에 `findPostsBySemanticQuery()` 추가(mock 기반 유닛 테스트로 SQL 파라미터 바인딩 검증).
3. `posts/service.ts::searchPosts()`가 `mode=semantic`일 때 새 경로로 분기하도록 확장.
4. `/api/posts` 라우트 동작 확인(변경이 필요 없다면 재확인만).
5. `SearchFilterBar`에 모드 토글 UI 추가, `PostCard`(또는 wrapper)에 유사도 표시 추가.
6. `npm test`/`lint`/`build` 통과 확인 후, **로컬에서 실제 모델로 필수 한국어 테스트 문장 쌍 검증**(Phase 6에서 쓴 것과 동일한 스모크 테스트 스크립트 패턴 재사용).
7. **실제 Vercel 배포로 최종 검증**(Phase 6~7과 동일한 우선순위 원칙 — 로컬 성공만으로 끝내지 않는다).

---

## 현재 Git 상태 (이번 Phase에서 변경한 것 — 이 문서 자체만)

- 브랜치: `vercel`
- 이번 Phase(12-1)는 **분석/설계만 수행했고, 이 문서(`docs/AI_SEMANTIC_SEARCH_DESIGN.md`) 신규 생성 외에는 어떤 코드도 수정하지 않았다.**
- 단, 이번 Phase 시작 시점에 **Phase 11의 변경사항이 아직 커밋되지 않은 상태**로 남아 있었다(사용자가 이번 요청에서 커밋을 지시하지 않았기 때문 — Phase 11 보고서에서 이미 "확인 후 진행하겠다"고 보고한 그 상태 그대로): 수정 6개(`src/app/(main)/notifications/page.tsx`, `src/components/layout/Header.tsx`, `src/lib/chat/service.ts`/`.test.ts`, `src/lib/match/service.ts`/`.test.ts`) + 신규 4개(`src/app/(main)/matches/`, `src/app/(main)/notifications/resolveHref.ts`/`.test.ts`, `src/components/match/MyMatchActions.tsx`).
- `main` 브랜치는 이번 Phase 동안 전혀 조회/수정하지 않았다(레거시 코드는 `git show main:<path>`로만 읽었다).
- `npm test`(451건)/`lint`/`build`는 이번 Phase에서 코드 변경이 없으므로 재실행하지 않았다 — Phase 11 종료 시점 상태 그대로 유효하다.
