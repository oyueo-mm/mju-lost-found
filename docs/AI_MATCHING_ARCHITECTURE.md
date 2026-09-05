# AI 매칭 아키텍처 조사·설계 및 기술검증 (Phase 5)

> 작성 기준: `vercel` 브랜치 (커밋 `17eab46`), 2026-09-05.
> 이 문서는 **조사 → 비교 → 실측 PoC → 아키텍처 결정 → 구현 계획**의 결과물이다. 실제 매칭 기능 구현(Phase 6)은 포함하지 않는다.
> 추측이 필요한 부분은 **[추측]**으로 명시했다. 그 외는 실제 코드 근거 또는 이번 Phase에서 직접 실행한 PoC 결과다.

---

## 1. Executive Summary

**PostgreSQL(Supabase) + pgvector를 벡터 저장/검색 계층으로, 임베딩 생성은 "Next.js 서버 안에서 직접 실행하는 `@huggingface/transformers`(ONNX Runtime) — 레거시와 동일한 모델(`jhgan/ko-sroberta-multitask`)의 공식 int8 양자화 ONNX 파일"을 1차로 채택**할 것을 권장한다. 실제로 이 조합을 이번 Phase에서 직접 실행해 검증했다: 768차원 임베딩이 정상 생성되고(웜 추론 8~17ms, 프로세스 RSS 233MB), Supabase Postgres에 `vector(768)` 컬럼 + HNSW 인덱스로 저장되며, 코사인 유사도 검색이 실제로 정답 매칭 쌍을 1위로 반환했다. 외부 임베딩 API(OpenAI/Google/Cohere)는 비용 자체는 이 서비스 규모에서 무의미할 정도로 저렴하지만, 자체 실행 방식이 비용 0원·개인정보 미전송·외부 장애 의존성 없음이라는 점에서 더 낫다고 판단했다 — 단, Vercel 실제 배포 시 함수 번들 크기 제한을 반드시 재검증해야 한다는 단서를 붙인다(§13, §12 Risk 1).

---

## 2. 현재 프로젝트 상태 (실제 코드 근거)

| 항목 | 실제 값/구조 | 근거 |
|---|---|---|
| Next.js | 16.3.4, App Router | `package.json` |
| Prisma | 7.10.0, `provider = "prisma-client"`(신형 generator), 커스텀 output `src/generated/prisma` | `prisma/schema.prisma`, `package.json` |
| DB 연결 | `@prisma/adapter-pg`(node-postgres) 드라이버 어댑터, 앱 런타임은 `DATABASE_URL`(pooled, PgBouncer), Prisma Migrate는 `prisma7.config.ts`의 `DIRECT_URL`(unpooled) 사용 | `src/lib/db/prisma.ts`, `prisma7.config.ts` |
| Supabase 연결 | Postgres(`aws-0-ap-northeast-2.pooler.supabase.com`, 서울 리전) + Storage(`post-images` 공개 버킷, service-role 서명 업로드) | `src/lib/images/supabaseAdmin.ts`, Phase 3/4 보고 |
| 게시글 모델 | `LostPost`/`FoundPost` — 독립된 두 테이블, 별도 AUTOINCREMENT 시퀀스 (동일 id가 양쪽에 존재 가능) | `prisma/schema.prisma:118-163` |
| 게시글 필드(매칭에 쓸 수 있는 것) | `title`, `description`, `category`, `location`, `lostAt`/`foundAt`, `imageUrl`, `createdAt`, `status`(enum) | 동일 |
| CRUD 계층 | `src/lib/posts/service.ts` (Prisma 직접 호출, Server Component/Route Handler에서 사용) — Server Action이 아니라 REST 형태의 Route Handler(`src/app/api/posts/*`) | `src/lib/posts/service.ts`, `src/app/api/posts/route.ts` |
| 인증/권한 | NextAuth v5(JWT 세션) + `requireUserForApi()`(로그인+닉네임) + 각 서비스 함수 자체의 소유권/정지 재검증 — Phase 2 설계 그대로 | `src/lib/auth/*`, `src/lib/posts/http.ts` |
| 테스트 | Vitest, `environment: "node"`(컴포넌트 렌더링 테스트 없음), 381건 | `vitest.config.ts` |
| 환경변수 | `DATABASE_URL`/`DIRECT_URL`/`GOOGLE_CLIENT_*`/`AUTH_SECRET`/`NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY` | `.env.example` |

### 이미 존재하는 "AI 매칭" 스텁 (매우 중요 — 반드시 먼저 이해해야 함)

`vercel` 브랜치에는 이미 매칭 파이프라인 전체(`src/lib/ai/*`, `src/lib/match/*`, API 라우트, 알림 연동)가 **동작하는 형태로 구현되어 있다.** 다만 실제 임베딩 생성부는 의도적으로 진짜 AI 모델이 아니라 **결정론적 문자 bigram 해싱("lexical hash")** 스텁으로 대체되어 있다:

- `src/lib/ai/embedding.ts:1-71` — `LexicalHashEmbeddingProvider`: FNV-1a로 문자 bigram을 256차원 버킷에 카운트. 클래스 주석에 명시: *"This is explicitly NOT a semantic embedding model... swapping in a real hosted embedding API... only requires implementing this same `EmbeddingProvider` interface and changing `getEmbeddingProvider()`... no caller needs to change."* — 즉 **Phase 5/6이 채워야 할 자리가 이미 인터페이스 수준까지 설계되어 있다.**
- `src/lib/ai/openrouter.ts`, `src/lib/ai/vision.ts` — 둘 다 `export {}` 뿐인 빈 파일("아직 구현하지 않는다"는 주석만 있음).
- `src/lib/ai/matching.ts:1-77` — `cosineSimilarity()` + `rankCandidates()`: 후보 전체를 **매 요청마다 다시 임베딩**하는 brute-force 방식(§7에서 비교).
- `src/lib/match/candidates.ts:1-99` — `findMatchCandidates()`: 반대 유형 게시판에서 최근 50개(`CANDIDATE_POOL_SIZE`)를 가져와 위 brute-force로 순위 매김. `AI 매칭` 버튼을 누른 시점에만 실행(게시글 생성 시 자동 실행 아님 — 레거시와 동일한 정책).
- `src/lib/match/service.ts` — Match 테이블 생성/조회/삭제, 알림 연동까지 이미 완성(Phase 4까지의 산출물). **이번 Phase는 `Match` 테이블이나 이 서비스 계층을 바꾸지 않는다** — 오직 `EmbeddingProvider`의 실제 구현과 검색 방식(brute-force → pgvector)만 교체 대상이다.

이 발견은 설계 방향을 명확히 한다: **Phase 6은 "매칭 기능을 새로 만드는 것"이 아니라 "이미 있는 `EmbeddingProvider` 인터페이스의 진짜 구현체를 끼워 넣고, `rankCandidates()`의 brute-force 재임베딩을 pgvector 검색으로 바꾸는 것"**이다.

---

## 3. 기존 Streamlit AI 분석 (`main` 브랜치, 실제 코드 확인)

### Embedding — `main:ai/embedding.py`

- 모델: `jhgan/ko-sroberta-multitask` (상수 `MODEL_NAME`, 한 줄만 바꾸면 교체 가능하게 설계됨).
- 로딩 방식: 모듈 전역 싱글턴(`_model`), **lazy load** — 최초 호출 시에만 `sentence_transformers.SentenceTransformer(MODEL_NAME)` 실행. 실패 시 `_load_error`에 캐시하고 재시도 안 함(프로세스 재시작 전까지).
- 입력 텍스트 구성(`build_embedding_text()`, 25-38행): **`title` + `description` + `category` + `location`을 공백으로 join** — 비어있는 필드는 건너뜀. **`lostAt`/`foundAt`(시간)과 이미지는 임베딩 텍스트에 전혀 포함되지 않는다.**
- Embedding dimension: 768 (모델 카드 기준 문서화된 값, 코드 주석에도 명시).
- Normalize 여부: **명시적 정규화 없음** — `model.encode([text])[0]`을 그대로 반환(51행). 대신 `ai/matching.py::cosine_similarity()`가 직접 norm으로 나눠서 코사인을 계산하므로 결과 자체는 정확함.
- inference 방식: 동기 호출, 배치 지원(`get_embeddings()`가 여러 문장을 한 번에 encode).
- 모델 다운로드/캐시: Hugging Face Hub에서 최초 1회 다운로드 → `~/.cache/huggingface`. `requirements.txt` 주석: **"~440MB"**.

### Matching — `main:ai/matching.py`, `main:ai/search.py`

- 코사인 유사도: 수동 구현(`np.dot(a,b)/(||a||·||b||)`), 0-벡터 방어(0.0 반환).
- 후보 범위: 호출자가 넘겨준 리스트 전체 — **DB를 직접 조회하지 않음**(테스트 용이성을 위한 설계).
- Lost↔Found 규칙: `find_similar_found_posts(lost_post, found_posts)` / `find_similar_lost_posts(found_post, lost_posts)` — 항상 **반대 유형**만 비교.
- **Threshold: 없음.** `top_k`(매칭 3, 자연어 검색 10)만큼 무조건 반환 — 점수가 아무리 낮아도 잘라내지 않음.
- Ranking: 점수 내림차순 정렬 후 `top_k` 슬라이스.
- **카테고리/위치/시간 등 별도 rule-based 가중치: 존재하지 않는다.** PRD(`main:PRD.md` §12)는 "텍스트 유사도+이미지 유사도+장소 유사도+시간 유사도+카테고리 일치도"를 개념적으로 서술하지만, **실제 코드는 텍스트 임베딩 코사인 유사도 단일 값**뿐이다. 이는 Phase 0 분석에서도 이미 확인된 사실이며 이번 Phase에서 재확인했다.
- **이미지는 매칭에 전혀 사용되지 않는다.** `ai/` 디렉터리 어디에도 이미지 임베딩/CLIP 관련 코드가 없다.
- 매칭 결과 저장: `db.create_match(lost_post_id, found_post_id, score, requesting_user_id)` — 사용자가 "내 물건 같아요" 버튼을 눌러야 `Match` 테이블에 저장(자동 저장 아님). `UNIQUE(lost_post_id, found_post_id)`로 중복 방지, get-or-create.
- 매칭 실행 시점: 게시글 상세 페이지에서 **"AI로 유사한 OO 찾기" 버튼 클릭 시에만**(온디맨드). 게시글 생성/수정 시 자동 실행되지 않는다.

### 기존 코드의 한계 (실제 코드 기준)

| 문제 | 근거 |
|---|---|
| Brute-force 확장성 | 매 클릭마다 **후보 전체를 다시 임베딩**(`get_embeddings(candidate_texts)`) — 사전 계산/캐싱 없음. 게시글 수 O(n) 비례로 느려짐. |
| SQLite 환경 한계 | 벡터 검색 인덱스 없음(SQLite 자체가 벡터 타입/인덱스 미지원) — brute-force가 유일한 선택지였던 근본 원인. |
| Python 모델 의존성 | `sentence-transformers`(PyTorch 백엔드) — Vercel Node.js 서버리스 런타임과 근본적으로 다른 스택. |
| 서버 메모리/cold start | 440MB 모델을 매 프로세스마다 로드 — Streamlit Cloud처럼 상시 구동 서버에서는 1회 비용이지만, 서버리스 cold start마다 반복되면 치명적. |
| 동시 사용자 증가 | 임베딩 계산이 CPU-bound 동기 작업 — 다중 요청 시 GIL/스레드 경합(Python 특유의 제약). |
| Vercel로 그대로 이식 시 | 위 모든 문제가 그대로 발생 + Vercel Node.js 런타임엔 Python 자체가 없음(§4에서 대안 검토). |

---

## 4. Vercel 환경에서 기존 모델 직접 실행 가능성

### A. Node.js에서 직접 실행 — **실제 PoC로 검증함 (§10 참고)**

- `jhgan/ko-sroberta-multitask` 저장소에는 **이미 공식 ONNX 파일 3종**이 올라와 있다: `onnx/model.onnx`(420MB, fp32), `onnx/model_O4.onnx`(210MB, O4 그래프 최적화), `onnx/model_qint8_avx512_vnni.onnx`(**106MB, int8 양자화**) — [jhgan/ko-sroberta-multitask/tree/main/onnx](https://huggingface.co/jhgan/ko-sroberta-multitask/tree/main/onnx). ONNX 변환이 이미 되어 있어 별도 변환 작업이 필요 없다.
- `@huggingface/transformers`(구 `transformers.js`, npm 4.2.0)로 이 int8 양자화 파일을 직접 로드해 실제 추론에 성공했다(§10 PoC A).
- 서버리스 bundle 제한: Vercel 공식 문서([vercel.com/docs/functions/limitations](https://vercel.com/docs/functions/limitations), 2026-08-24 갱신) 기준 Node.js 함수 표준 한도는 **압축 해제 250MB**(대용량 함수는 Fluid Compute 옵트인 시 **5GB**까지). 실측: `onnxruntime-node` npm 패키지 자체는 3-플랫폼 바이너리 포함 211MB이지만 **Linux x64 바이너리만은 53MB**, `@huggingface/transformers` JS 코드 32MB, 양자화 모델 106MB → 실제 배포 시 필요한 부분만 합치면 약 **191MB**로 표준 한도 안에 들어올 가능성이 높다. 다만 Next.js의 output file tracing이 다른 플랫폼 바이너리를 실제로 제외하는지는 **실제 Vercel 배포로만 최종 확인 가능**([추측] 아님 — 실측했지만 로컬 확인이며 Vercel 배포 확인은 아님, §12 Risk 1 참고).
- 메모리: 실측 프로세스 RSS **233MB**(모델 로드 + 추론 3회 후) — Vercel Hobby 2GB/Pro 4GB 한도에 충분히 여유.
- cold start: 모델 파일이 이미 로컬(캐시/번들)에 있을 때 **417ms**, 네트워크 다운로드가 필요하면(첫 배포 직후 등) 약 5초. → **모델 파일을 함수 배포에 직접 포함**(런타임 다운로드에 의존하지 않음)하는 것이 운영상 필수.
- inference latency: 웜 상태에서 문장 1건당 **8~17ms** — 매우 빠름.
- Vercel Functions 자체 실행 가능성: Node.js 런타임에서 네이티드 addon(`onnxruntime-node`)을 쓰므로 Edge Runtime(브라우저 유사 V8 격리 환경, 네이티브 addon 불가)에서는 동작하지 않는다 — **반드시 Node.js 런타임(`export const runtime = "nodejs"`)으로 지정**해야 한다.

### B. Python inference 서비스 (별도 서버)

- Vercel과의 통신: HTTP(S) API 호출 — 왕복 지연(네트워크 RTT) 추가, Vercel Function이 외부 서비스를 기다리는 시간도 요금(active CPU는 I/O 대기 중 과금 안 됨 — Vercel 문서: *"Waiting for I/O... does not count towards active CPU time"* — 이는 오히려 이 방식의 비용 이점이 될 수 있음).
- 무료/저비용 배포처: Render/Fly.io/Railway 등의 무료 티어는 콜드 스타트가 매우 길거나(수십 초) 일정 시간 후 슬립하는 경우가 많음 — 소규모 캠퍼스 서비스엔 응답 지연이 사용자 경험을 해칠 위험.
- 운영 복잡성: **인증서비스가 2벌**(Next.js + Python) 되어 배포/모니터링/버전 관리 이중화 — 1인 또는 소규모 팀 운영에 부담.
- 장기 유지보수: Python 런타임/의존성 별도 관리 필요 — 이 프로젝트가 Phase 1~4를 거치며 Python을 완전히 떠나 TypeScript로 통일한 방향(Phase 0~4 전체)과 어긋남.
- **결론: 후보로는 유효하나, A(Node 직접 실행)가 실제로 동작함이 확인된 이상 우선순위가 낮다.**

### C. 외부 embedding API

§6(비용 분석)에서 구체적 수치와 함께 다룬다. 여기서는 기술적 통합 난이도만 요약:

- 공통적으로 서버 사이드에서만 호출(API 키 노출 금지) — Route Handler 안에서 `fetch()` 한 번으로 통합 가능, 난이도는 낮음.
- 한국어 성능: OpenAI/Google/Cohere 모두 다국어 모델이며 한국어를 명시적으로 지원한다고 광고하지만, **이 서비스의 실제 도메인(분실물 짧은 설명문)에 대한 정성적 품질은 실측하지 않았다** — 이는 §12 Open Question으로 남긴다.
- rate limit/무료 티어 제한은 §6.

---

## 5. Supabase PostgreSQL + pgvector — **실제 PoC로 검증함**

- **사용 가능 여부**: 가능. 이번 Phase에서 실제 Supabase 프로젝트에 `create extension vector with schema extensions;`를 실행해 **pgvector 0.8.2**가 정상 활성화됨을 직접 확인했다.
- extension 활성화 방법: 대시보드(Database → Extensions) 또는 SQL 한 줄 — [Supabase pgvector 문서](https://supabase.com/docs/guides/database/extensions/pgvector). Supabase 관례대로 `public`이 아니라 **`extensions` 스키마**에 설치했다(대시보드 기본 동작과 동일, 마이그레이션/덤프 충돌 방지 목적).
- Prisma와의 호환성: Prisma ORM은 `vector` 타입을 네이티브로 지원하지 않는다(2026년 현재도 진행형 — [prisma/prisma#26546](https://github.com/prisma/prisma/issues/26546), Prisma 공식 블로그가 "Prisma Postgres"(별도 호스팅 상품) 한정으로 pgvector 지원을 발표했을 뿐, 우리가 쓰는 일반 PostgreSQL 데이터소스에는 해당 없음). 공식 권장 패턴은 `Unsupported("vector(N)")` + raw SQL 마이그레이션 + `$queryRaw`/`$executeRaw` 또는 TypedSQL — [Prisma 공식 문서](https://www.prisma.io/docs/postgres/database/postgres-extensions).
- migration 전략: `prisma migrate dev --create-only`로 빈 마이그레이션 생성 → 그 안에 직접 `CREATE EXTENSION`/`ALTER TABLE ... ADD COLUMN embedding vector(768)`/`CREATE INDEX ... USING hnsw` SQL 작성 → 적용 → `prisma db pull`로 스키마에 `Unsupported("vector(768)")` 반영(타입 힌트 용도, 실제 CRUD는 여전히 raw SQL로).
- **SQL Injection 방지**: `$queryRaw`/`$executeRaw`를 **태그드 템플릿 리터럴**로 사용하면 Prisma가 자동으로 파라미터 바인딩한다(문자열 결합 아님). 이번 PoC에서 실제로 `` `INSERT INTO ... VALUES ($1, $2::vector)` ``를 파라미터 배열과 함께 실행해 검증했다 — 벡터 값이 아무리 커도 문자열 이스케이프 문제가 생기지 않는다.
- HNSW/IVFFlat: **둘 다 가능.** 이번 PoC에서 `CREATE INDEX ... USING hnsw (embedding vector_cosine_ops)`를 실제로 생성해 `pg_indexes`로 확인했다. (IVFFlat은 사전에 클러스터 개수(lists)를 데이터 분포 기준으로 정해야 하고 데이터가 늘어나면 재구축이 필요한 반면, HNSW는 그런 튜닝 없이도 무난한 성능을 내는 것으로 알려져 있어 — 이 서비스처럼 초기 데이터가 적고 서서히 느는 상황엔 HNSW가 운영 부담이 적다.)
- vector dimension: pgvector는 최대 2000차원까지 인덱싱 가능(그 이상은 인덱스 없이 저장만 가능) — 768차원은 전혀 문제없다.
- embedding 저장 방식: PoC에서 `INSERT ... VALUES ($1, $2::vector)`로 JS 배열을 `[0.01,0.02,...]` 형태 문자열로 만들어 `::vector`로 캐스팅 — 정상 동작 확인.
- **실측 검증 결과**: 5개의 실제 임베딩(레거시와 동일 모델로 생성)을 저장하고 `embedding <=> $1::vector`(코사인 거리) 검색을 실행 — **진짜 매칭 쌍("검은색 에어팟" ↔ "검정색 무선 이어폰")이 1위로 정확히 반환됨**(cosine_similarity 0.6685, 그 다음 후보 0.56, 0.38). `EXPLAIN`으로 실행계획도 확인했다(§10 PoC B, 인덱스가 이 정도 소규모 데이터에선 Seq Scan으로 대체되는 것도 정상 동작임을 함께 확인 — 아래 §7 참고).

---

## 6. 비용 분석 (2026년 기준 공식 자료)

먼저 핵심 전제: **아키텍처를 "임베딩 생성"과 "검색"으로 분리하면(§8), 게시글당 임베딩 API 호출은 딱 1번(생성/수정 시)뿐이다.** 매칭 요청은 DB 쿼리 1번(대상 게시글 자체 임베딩은 이미 저장돼 있으므로 재계산 불필요)이므로, "매칭을 몇 번 눌렀는가"가 아니라 "게시글이 몇 개 생성/수정되었는가"에 비용이 비례한다.

토큰 추정: 분실물 설명문(제목+설명+카테고리+위치) 평균 길이를 한국어 기준 약 100~150 토큰으로 가정(단문 위주 서비스 특성).

| 월 게시글 수 | 총 토큰(추정) | OpenAI `text-embedding-3-small`($0.02/1M) | Google `gemini-embedding-001`($0.15/1M, 무료 티어 있음) | Cohere `embed-v4` multilingual($0.10/1M) | 자체 실행(transformers.js) |
|---|---|---|---|---|---|
| 100 | 15,000 | $0.0003 | $0.00225 (무료 티어로 충분) | $0.0015 | **$0** (Vercel active-CPU 몇 ms 과금만) |
| 1,000 | 150,000 | $0.003 | $0.0225 | $0.015 | $0 |
| 10,000 | 1,500,000 | $0.03 | $0.225 | $0.15 | $0 |

**중요 — "무료"의 실제 제한 (공식 문서/2026 자료 기준, 반드시 확인해야 할 항목):**

- **OpenAI**: 무료 티어 없음(항상 종량제, 결제수단 등록 필수). 다만 단가 자체가 매우 낮아 이 규모에서는 사실상 무의미한 비용.
- **Google Gemini (`gemini-embedding-001`)**: Google AI Studio를 통해 **결제수단 등록 없이** 무료로 사용 가능([공식 발표](https://developers.googleblog.com/gemini-embedding-available-gemini-api/)). 단, 이번 조사에서 **무료 티어의 정확한 분당/일일 요청 제한(RPM/RPD/TPM) 수치와 "무료 티어 데이터가 모델 학습에 사용되는지" 여부는 가격 페이지에서 확정적으로 확인하지 못했다** — Google 공식 자료 일부는 "무료 티어 콘텐츠는 제품 개선에 활용될 수 있음"을 시사하나, 이는 이 서비스가 다루는 분실물 설명(개인 소지품 특징, 위치, 시간)이 그대로 Google 학습 데이터가 될 가능성을 의미할 수 있어 **§7 개인정보 검토와 직결**된다. **[추측 아님, 다만 미확정 — 실제 채택 전 Google 공식 ToS/DPA 재확인 필수, §12 Open Question 3.]**
- **Cohere**: 체험용 Trial 키는 월 1,000회 호출 한도이며 **"상업적/프로덕션 사용 불가"가 공식 정책**([Cohere rate-limits 문서](https://docs.cohere.com/docs/rate-limits)) — 실제 서비스에 쓰려면 반드시 유료 Production 키 필요.
- **Hugging Face Inference API**: 무료 서버리스 티어가 있으나 **하루 약 1,000회 수준의 rate limit**, 공유 인프라라 지연시간 변동 큼, "역사적으로 중요한(historically important)" 소형 모델 위주로 운영 방침이 바뀌는 중 — 우리가 원하는 `jhgan/ko-sroberta-multitask`가 계속 서빙될지 보장되지 않음([HF Inference Providers 문서](https://huggingface.co/docs/inference-providers/index)).
- **자체 실행(transformers.js)**: API 비용 자체가 없음 — 유일한 비용은 Vercel Function의 **active CPU 시간**(실측 8~17ms/건)과 **provisioned memory time**(실측 233MB) 뿐이며, Vercel Hobby(무료) 플랜 한도 안에서도 이 정도 사용량은 여유가 크다. **카드 등록**은 Vercel 자체 가입 정책과 별개(이미 Vercel 사용 중이므로 추가 부담 없음).

**결론**: 이 서비스 규모(캠퍼스 분실물, 월 최대 수천 건)에서는 **어떤 후보를 선택해도 순수 금전 비용은 무시할 수준**이다. 비용이 결정 요인이 아니라, **무료 티어의 상업적 사용 제한(Cohere)**, **데이터 전송/학습 이용 가능성(외부 API 공통)**, **번들 크기/운영 복잡성(자체 실행)** 이 실질적 결정 요인이다.

---

## 7. 기존 brute-force vs pgvector — 시간복잡도

| 게시글 수 | brute-force (현재 방식, `rankCandidates()`) | pgvector (HNSW) |
|---|---|---|
| 100 | 후보 최대 50개(코드 상 `CANDIDATE_POOL_SIZE`) 재임베딩 — 사실상 O(50) 고정, 체감 지연 적음 | O(log n) 근사 검색, 마찬가지로 빠름 |
| 1,000 | 여전히 pool 상한(50)에 걸려 있어 **표면적으로는 안 느려 보임 — 그러나 이는 "최근 50개만 본다"는 임의 컷 때문이지, 진짜 확장성이 있어서가 아니다.** 최근 50개 밖에 있는 진짜 매칭 후보는 애초에 후보군에 들어오지도 못한다. | 테이블 전체를 인덱스로 검색 — 최근 50개라는 인위적 제한이 필요 없음 |
| 10,000 | 위 문제가 누적: "최근 50개"가 전체의 0.5%에 불과 — 매칭 정확도 자체가 게시글 수 증가에 따라 저하 | HNSW 인덱스가 근사 최근접 이웃을 O(log n) 수준으로 찾음 — 정확도 저하 없이 확장 |
| 100,000 | 여전히 pool=50 고정이라 "느려지지는" 않지만 **매칭 정확도가 사실상 무의미해짐**(전체의 0.05%만 후보) | 인덱스 크기는 커지지만 HNSW는 이 규모에서도 실용적 — pgvector 공식 문서가 언급하는 전형적 사용 규모 |

**핵심 시사점**: 현재 brute-force 구현(`src/lib/match/candidates.ts:12` `CANDIDATE_POOL_SIZE = 50`)의 "느려지지 않는 이유"는 애초에 최근 50개로 후보를 인위적으로 제한하기 때문이다 — 이는 성능 문제를 감추는 동시에 **매칭 누락(false negative)** 문제를 만든다: 두 달 전에 등록된 진짜 습득물이 있어도 그사이 50개 넘게 새 글이 올라왔다면 후보에 아예 오르지 못한다. pgvector 전환은 "빠르게 만드는 것"이자 **"놓치던 진짜 매칭을 찾아내는 것"**이기도 하다.

이번 PoC(§5, §10)에서 5건짜리 소규모 데이터로는 Postgres 플래너가 HNSW 인덱스 대신 Seq Scan을 선택했는데(`EXPLAIN` 결과), 이는 **버그가 아니라 정상 동작**이다 — pgvector/Postgres 모두 테이블이 아주 작을 때는 인덱스 오버헤드가 스캔보다 크다고 판단해 인덱스를 스킵한다. 인덱스의 실제 효과는 최소 수백~수천 행 규모에서 검증해야 하며, 이는 Phase 6 이후 실 데이터가 쌓인 뒤 재확인할 사항이다(§12 Open Question 2).

---

## 8. Matching Score 설계

기존(legacy) 및 현재 스텁(`rankCandidates`) 모두 **rule-based 가중치가 전혀 없다** — 순수 의미 유사도(코사인) 하나뿐이다. 따라서 이번 문서가 제안하는 hybrid scoring은 **레거시에서 추출한 것이 아니라 신규 제안**임을 명확히 한다.

**Phase 6 MVP 제안: 우선 semantic-only로 시작한다.** 이유:
1. 레거시가 실제로 이렇게 동작해왔고, 그 자체로 이미 검증된(실사용자 대상) 정책이다 — 갑자기 여러 요소를 섞으면 "왜 이 순위인지" 설명하기 어려워지고 튜닝 근거도 없다.
2. 실 데이터 없이 임의 가중치(예: 카테고리 20%, 위치 15%...)를 정하는 것은 **근거 없는 확정**이며, 이번 지시사항이 명시적으로 금지한 것이다.

**Phase 7+에서 검토할 hybrid 후보(제안, 미확정)**:

```
final_score = semantic_score × 0.7
            + category_exact_match_bonus × 0.15   (같은 카테고리면 1, 아니면 0)
            + time_proximity_score × 0.15          (분실~습득 시간차가 가까울수록 1에 근접, 지수감쇠)
```

- **위치(location)를 가중치에서 제외한 이유**: `location`은 자유 텍스트(enum 아님, `prisma/schema.prisma:128` 주석 참고)라 "인문캠퍼스 도서관"과 "도서관 3층"처럼 같은 곳을 가리켜도 문자열이 다를 수 있다 — 이미 `build_embedding_text()`에 location이 포함되어 있으므로(§3) **semantic_score 안에 이미 어느 정도 녹아 있다**. 별도 rule을 추가하면 이중 반영(double counting)이 될 위험이 있어, 이번 제안에서는 제외했다.
- 위 0.7/0.15/0.15는 **근거가 있는 출발점이지 확정값이 아니다**: semantic이 이 서비스의 핵심 차별화 요소(PRD §24)이므로 지배적 가중치를 주고, category/time은 "동점 상황을 가르는 보조 신호" 정도로만 작게 반영한다는 설계 의도다. 실 데이터로 A/B 검증 후 조정해야 한다(§12 Open Question 4).

---

## 9. 이미지 자체를 AI 매칭에 사용할지

**결론: Phase 5/6에서는 텍스트 임베딩만 사용한다.** 근거:
1. 레거시 서비스가 실제로 이미지를 매칭에 쓴 적이 없다(§3) — "포팅"이 아니라 "신규 기능 확장"에 해당하므로 이번 지시사항 범위 밖.
2. CLIP류 멀티모달 임베딩은 검증된 한국어 특화 모델 선택지가 텍스트보다 훨씬 적고, Vercel 환경 실행 가능성(번들 크기 등)도 별도로 검증해야 하는 추가 리스크.
3. 비용/복잡도 대비 이 서비스 규모에서 우선순위가 낮다 — 텍스트만으로도 충분히 유의미한 매칭이 가능함을 이번 PoC가 보여줬다(§10).

향후(Phase 7 이후) 이미지 매칭을 추가한다면 별도 Phase로 분리해 CLIP 계열 ONNX 모델(예: `Xenova/clip-vit-base-patch32`, transformers.js에서 이미 검증된 모델)의 Vercel 실행 가능성을 똑같은 방식(실측 PoC)으로 재검증할 것을 권장한다.

---

## 10. 실제 기술검증 (PoC) 결과

### PoC A — Node.js에서 레거시와 동일한 모델 실행

**목표**: `jhgan/ko-sroberta-multitask`를 Vercel과 같은 Node.js 환경에서 `@huggingface/transformers`로 실제 로드/추론할 수 있는가.

**방법**: `@huggingface/transformers@4.2.0` + `onnxruntime-node`를 임시 설치, 해당 모델의 공식 int8 양자화 ONNX(`onnx/model_qint8_avx512_vnni.onnx`, 106MB)를 `model_file_name` 옵션으로 직접 지정해 로드. 실제 분실물 도메인 한국어 문장 3개(분실물 1건 + 진짜 매칭 습득물 1건 + 무관한 습득물 1건)로 추론.

**결과(실측)**:
| 항목 | 값 |
|---|---|
| 임베딩 차원 | **768** (레거시와 동일) |
| 모델 로드(콜드, 캐시 없이 최초 다운로드 포함) | 5,071ms |
| 모델 로드(캐시 있음 — 배포에 파일 포함 시나리오에 해당) | **417ms** |
| 추론 지연(웜, 문장 1건) | 8~17ms |
| 프로세스 RSS(로드+추론 3회 후) | 233MB |
| cosine(분실물, 진짜 매칭 습득물) | **0.6830** |
| cosine(분실물, 무관한 습득물) | **0.2056** |

→ 실제 의미 기반 구분이 뚜렷하게 작동함을 확인(진짜 매칭 0.68 vs 무관 0.21 — 차이가 커서 threshold를 두더라도 여유가 있음).

**패키지/파일 크기 실측**: `onnxruntime-node`(전체 3-플랫폼) 211MB, 그중 **Linux x64만은 53MB**; `@huggingface/transformers` 32MB; 양자화 모델 106MB. → 배포 시 필요한 부분만 합쳐 약 191MB로 Vercel 표준 한도(250MB) 안에 들어올 가능성이 높으나, **실제 Vercel 배포로 최종 확인 필요**(이번 Phase 범위 밖 — §12 Risk 1).

### PoC B — Supabase pgvector 저장/검색

**목표**: PoC A에서 만든 진짜 768차원 임베딩을 실제 Supabase Postgres에 저장하고 코사인 유사도 검색이 정확한 순위를 내는가.

**방법**: 실제 Supabase 프로젝트(DIRECT_URL)에 `create extension vector`, 임시 테이블(`_poc_embeddings`, 작업 후 즉시 DROP)에 `vector(768)` 컬럼 생성, HNSW 인덱스 생성, 5건(분실물 1 + 진짜 매칭 습득물 1 + 무관 습득물 3) 삽입 후 `embedding <=> $1::vector`로 top-3 검색.

**결과(실측)**:
```
pgvector 버전: 0.8.2 (정상 활성화 확인)
HNSW 인덱스: CREATE INDEX ... USING hnsw (embedding vector_cosine_ops) — 정상 생성 확인 (pg_indexes로 조회)
Top-3 검색 결과 (질의: 분실물 "검은색 에어팟..."):
  1위 found:airpods-match  cosine_similarity=0.6685  ← 진짜 매칭, 정확히 1위
  2위 found:textbook        cosine_similarity=0.5606
  3위 found:wallet          cosine_similarity=0.3840
```
파라미터 바인딩(`$1::vector`, 문자열 결합 아님)으로 SQL Injection 위험 없이 동작 확인. `EXPLAIN`으로 실행계획도 확인(5건 규모라 Seq Scan 선택 — §7에서 설명한 정상 동작).

**정리(완료 후)**: 임시 테이블 DROP 완료, 실사용자 게시글은 전혀 건드리지 않음, PoC용 npm 패키지(`@huggingface/transformers`, `onnxruntime-node` 등)와 `scripts/` 하위 임시 파일 전부 삭제, `package.json`은 원상 복구. **pgvector extension 자체는 계속 활성화된 채로 남겨두었다** — Postgres extension 활성화는 되돌릴 이유가 없는 멱등적 인프라 설정이며(비활성 시 아무 영향 없음), 오히려 Phase 6이 그대로 이어받을 수 있는 이점이 있다고 판단해 의도적으로 유지했다.

---

## 11. 개인정보 및 보안 검토

게시글에 포함될 수 있는 정보: 분실물 설명(때로 매우 구체적인 개인 소지품 특징), 습득/분실 위치, 시간, 사진(단, §9에 따라 이번 설계는 사진을 임베딩에 사용하지 않음).

- **자체 실행(transformers.js) 채택 시**: 어떤 게시글 텍스트도 Vercel/Supabase 인프라 밖으로 나가지 않는다 — 외부 API로의 데이터 전송 문제 자체가 발생하지 않는다. **이것이 자체 실행을 1차 후보로 미는 가장 강한 근거 중 하나다.**
- **외부 API 채택 시(대안)**: 어떤 데이터가 나가는가 → `build_embedding_text()` 결과물(제목+설명+카테고리+위치, 즉 사실상 게시글 텍스트 전체)이 그대로 provider에 전송된다. provider가 이를 저장/학습에 쓸 가능성은 provider별 ToS를 반드시 재확인해야 한다(§6에서 Google 무료 티어 관련 불확실성을 이미 명시). 최소한의 데이터만 보내는 방법은 "제목+카테고리+위치만 보내고 description은 로컬 해시로 대체" 같은 절충안이 있으나, 이는 매칭 품질을 떨어뜨리므로 권장하지 않는다 — 대신 **자체 실행을 택해 이 트레이드오프 자체를 없애는 것**을 권장한다.
- **Embedding을 클라이언트에 노출하지 않는 구조**: 이미 현재 아키텍처가 이를 보장한다 — `EmbeddingProvider.embed()`는 서버 전용 모듈(`src/lib/ai/embedding.ts`)에만 있고, 임베딩 벡터 자체는 어떤 API 응답에도 포함되지 않는다(`EnrichedCandidate`/`MatchDTO` 등 응답 DTO에 벡터 필드 없음, `src/lib/match/candidates.ts:14-22`). Phase 6도 이 경계를 그대로 지켜야 한다 — 벡터 컬럼은 오직 서버 사이드 `$queryRaw` 안에서만 다뤄야 하며, 어떤 Route Handler 응답에도 원본 벡터를 실어 보내면 안 된다.
- **SUPABASE_SERVICE_ROLE_KEY**: pgvector 컬럼 자체는 이 키가 없어도 일반 Prisma/`$queryRaw` 연결(앱의 기존 `DATABASE_URL`)로 다룰 수 있다 — 이미지 Storage 때와 달리 **service role key가 매칭 기능에 새로 필요해지지 않는다.**

---

## 12. 위험 요소 및 미해결 문제

| # | 항목 | 내용 |
|---|---|---|
| 1 | **[BLOCKER 후보]** Vercel 실제 번들 크기 | 로컬 실측(§10)은 유망하지만 Next.js의 output file tracing이 `onnxruntime-node`의 non-Linux 바이너리를 실제로 제외하는지, 다른 라우트와 같은 함수로 묶이며 한도를 넘기지 않는지는 **실제 Vercel 배포 전까지 확정 불가**. Phase 6 착수 시 가장 먼저 Preview 배포로 확인해야 함. 초과 시 대안: `outputFileTracingExcludes`로 불필요 플랫폼 바이너리 명시적 제외, 또는 Vercel "Large Functions"(5GB, Fluid Compute 옵트인) 사용. |
| 2 | HNSW 인덱스 실효성 | 5건 규모 PoC에서는 Postgres가 Seq Scan을 선택(§7) — 실제 인덱스 사용/성능 이득은 최소 수백~수천 행 규모에서 재검증 필요. |
| 3 | 외부 API 무료 티어의 데이터 이용 약관 | Google Gemini 무료 티어의 정확한 rate limit과 "무료 데이터가 학습에 쓰이는지"를 가격 페이지에서 확정하지 못함(§6) — 자체 실행을 1차로 채택하면 이 이슈 자체가 무의미해지지만, Risk 1이 실제로 막힐 경우의 폴백(§13 대안 경로)으로 외부 API를 쓴다면 재조사 필요. |
| 4 | Hybrid scoring 가중치 미검증 | §8의 0.7/0.15/0.15는 근거 있는 제안이지만 실 데이터 기반 검증 없이 확정값으로 취급해서는 안 됨. |
| 5 | 이미지 매칭 미포함 | 의도된 범위 제외(§9)이지만, 서비스 기획상 이미지 매칭 수요가 있다면 별도 Phase로 재검토 필요. |
| 6 | 임베딩 재계산 정책 | 게시글 **수정** 시 임베딩을 언제 재생성할지(모든 필드 변경 시? title/description만? category/location만?) 아직 미정 — Phase 6 설계 시 결정 필요. |
| 7 | Prisma `Unsupported` 타입의 한계 | HNSW 인덱스를 Prisma의 스키마 파일이 인식하지 못해 `prisma migrate dev`가 이를 드랍할 수 있다는 커뮤니티 이슈가 보고됨([prisma/prisma#28414](https://github.com/prisma/prisma/issues/28414)) — Phase 6에서 마이그레이션 워크플로우를 짤 때 이 함정을 인지하고 있어야 함(예: 인덱스 생성을 별도의, migrate가 건드리지 않는 위치에 두거나 배포 스크립트로 관리). |

---

## 13. 최종 권장 아키텍처

```
[게시글 작성/수정]
        ↓
[Next.js Server (Route Handler, Node.js runtime)]
        ↓
[Embedding 생성: @huggingface/transformers + onnxruntime-node]
        (모델: jhgan/ko-sroberta-multitask, 공식 int8 양자화 ONNX, 768차원)
        ↓
[Supabase PostgreSQL: LostPost/FoundPost.embedding vector(768)]
        ↓
[pgvector HNSW 인덱스 (vector_cosine_ops)]
        ↓
[Similarity Search: $queryRaw로 코사인 거리 top-K, 파라미터 바인딩]
        ↓
[AI Matching 후보 (기존 EnrichedCandidate/MatchDTO 그대로 재사용)]
```

```
Embedding Provider : @huggingface/transformers (Node.js, onnxruntime-node), 모델 jhgan/ko-sroberta-multitask (int8 ONNX, 768-dim)
Vector DB          : Supabase PostgreSQL + pgvector 0.8.2 (HNSW, vector_cosine_ops)
ORM/Query          : Prisma 7 (일반 컬럼) + $queryRaw/$executeRaw 파라미터 바인딩(벡터 컬럼 전용)
Execution          : Vercel Functions, Node.js 런타임(Edge 불가 — 네이티브 addon 때문)
폴백(Risk 1 발생 시): 외부 API(1순위 후보 OpenAI text-embedding-3-small — 최저 비용, 무료 티어 없음/카드 필요; 2순위 Google gemini-embedding-001 — 진짜 무료지만 §12 Risk 3 재확인 필요)
```

### Why (선택 이유)

1. **레거시와 동일한 모델 → 동일한 매칭 품질**을 유지하면서 스택만 TypeScript/Vercel로 옮긴다 — "포팅"이 아니라 "동일 두뇌, 새 몸통"에 가깝다.
2. **비용 0, 개인정보 미전송** — 외부 API의 ToS/데이터 이용 불확실성(§12 Risk 3) 자체를 없앤다.
3. **실측으로 검증된 성능**(웜 추론 8~17ms, 메모리 233MB)이 API 왕복 지연보다 오히려 빠를 가능성이 높다.
4. **이미 있는 `EmbeddingProvider` 인터페이스**(`src/lib/ai/embedding.ts`)에 그대로 꽂을 수 있어, `rankCandidates()`/`findMatchCandidates()`/API 라우트 등 호출부를 전혀 건드리지 않고 교체 가능 — 이는 이 코드베이스를 만든 이전 단계가 정확히 이 시나리오를 위해 설계해 둔 것이다.
5. 유일한 미확정 리스크(Risk 1, 실제 Vercel 번들 크기)는 **Phase 6 첫 스텝에서 즉시 확인 가능**하고, 막히더라도 동일 인터페이스로 외부 API로 전환하는 폴백 경로가 이미 명확하다 — "선택이 잘못되면 되돌릴 수 없는" 구조가 아니다.

---

## 14. Phase 6 구현 계획 (제안)

1. **pgvector 마이그레이션**: `prisma migrate dev --create-only`로 빈 마이그레이션 생성 → `LostPost`/`FoundPost`에 `embedding vector(768)` 컬럼 + HNSW 인덱스를 raw SQL로 추가 → `prisma db pull`로 `Unsupported("vector(768)")` 반영. (Risk 7 인지하고 진행)
2. **Embedding Provider 교체**: `src/lib/ai/embedding.ts`의 `LexicalHashEmbeddingProvider`를 대체할 `TransformersEmbeddingProvider` 구현 — 같은 `EmbeddingProvider` 인터페이스, `EMBEDDING_DIMENSIONS`를 768로 변경.
3. **Vercel 번들 크기 실측**(Risk 1) — Preview 배포 1회로 실제 함수 크기 확인. 초과 시 대안 경로(§13 폴백) 재검토.
4. **임베딩 생성 서비스**: 게시글 생성/수정 훅에서 `buildEmbeddingText()` → `embed()` → DB 저장을 캡슐화하는 별도 모듈(`src/lib/ai/embeddingService.ts` 등, 이름은 구현 시 확정) — `createLostPost`/`updateLostPost` 등 기존 서비스 함수 내부에서 호출.
5. **Vector similarity 쿼리**: `$queryRaw`로 반대 유형 테이블 전체 대상 top-K 코사인 검색 함수 작성 — `src/lib/match/candidates.ts`의 brute-force 루프를 대체.
6. **Matching 서비스 갱신**: `findMatchCandidates()`가 위 쿼리를 쓰도록 교체 — 반환 타입(`EnrichedCandidate`)은 그대로 유지해 호출부(API 라우트, `MatchPanel` 컴포넌트) 무변경.
7. **Threshold/ranking 정책 결정**: 레거시처럼 threshold 없이 top-K만 반환할지, 최소 유사도 컷을 둘지 실 데이터로 재검토(현재는 레거시와 동일하게 threshold 없음을 기본으로 제안).
8. **기존 게시글 백필**: Phase 6 배포 시점에 이미 존재하는 게시글(현재는 실사용자 게시글 소수)에 대한 임베딩 일괄 생성 스크립트.
9. **매칭 UI**: 기존 `MatchPanel`/후보 카드 UI는 그대로 두되, 응답 속도가 빨라진 만큼 로딩 스피너 UX를 재검토할 여지.
10. **알림 연동**: 이미 존재(`src/lib/match/service.ts`)하므로 변경 불필요.
11. **테스트**: `TransformersEmbeddingProvider`는 실제 모델 로드가 느리므로 유닛 테스트에서는 mock, 결정론성 검증(같은 입력 → 같은 벡터)과 pgvector 쿼리 빌더는 별도 통합 테스트로 분리.

---

## 15. 참고한 공식 문서

- [Vercel Functions Limits](https://vercel.com/docs/functions/limitations) (2026-08-24 갱신)
- [Supabase: pgvector](https://supabase.com/docs/guides/database/extensions/pgvector)
- [Supabase: HNSW indexes](https://supabase.com/docs/guides/ai/vector-indexes/hnsw-indexes)
- [Prisma: Postgres extensions](https://www.prisma.io/docs/postgres/database/postgres-extensions)
- [Prisma issue #26546 — First class Vector support](https://github.com/prisma/prisma/issues/26546)
- [Prisma issue #28414 — HNSW index dropped by migrate](https://github.com/prisma/prisma/issues/28414)
- [jhgan/ko-sroberta-multitask (Hugging Face)](https://huggingface.co/jhgan/ko-sroberta-multitask)
- [Hugging Face Inference Providers docs](https://huggingface.co/docs/inference-providers/index)
- [Google: Gemini Embedding now generally available](https://developers.googleblog.com/gemini-embedding-available-gemini-api/)
- [Google Gemini API Pricing](https://ai.google.dev/gemini-api/docs/pricing)
- [Cohere: Rate Limits](https://docs.cohere.com/docs/rate-limits)
- [OpenAI: New embedding models and API updates](https://openai.com/index/new-embedding-models-and-api-updates/)
