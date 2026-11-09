# 통합 검색: 로컬 구현 및 검증

## 구조와 동작

기존 키워드 검색은 제목·설명의 전체 검색어 `contains`와 기존 정렬을 사용한다. 의미 검색은 로컬 ONNX 텍스트 모델과 저장된 pgvector 임베딩을 사용하고, 정규화 유사도 0.65 이상인 상위 10개에 기존 제목 토큰 보너스를 적용한다. 기존 텍스트+사진 검색의 D3 융합은 RRF와 별개이며 유지했다.

검색·분실물·습득물 화면의 모드 전환을 없애고 하나의 입력창과 사진 첨부로 통합했다. 홈 검색은 페이지 이동 없이 기존 추천 게시글 자리에 결과를 표시한다. 통합 텍스트 검색은 브라우저에서 기존 `/api/posts`를 한 번 호출한다. 짧은 검색은 키워드부터 조회하고 **전체 결과가 0건일 때만** 의미 검색을 추가한다. 긴 자연어는 키워드·의미 후보를 병렬 조회한다. 검색어 없는 게시판 목록과 명시적 `mode=keyword`는 기존 SSR을 유지한다. 페이지 서버 함수는 모델 모듈을 가져오거나 자체 API를 다시 호출하지 않는다.

홈의 `HomeSearchProvider`는 Hero 안에서 검색 조건과 첨부 파일만 로컬 상태로 관리한다. 최초 진입에는 제목·설명·검색창·인기 검색어만 표시하고 추천 및 결과 영역은 렌더링하지 않는다. 검색 실행 시에만 Hero 내부의 `HomeSearchResults`를 표시한다. 조회·사진 검색·카드·결과 개수·빈 결과 안내는 기존 공통 컴포넌트를 사용하며, 홈에서는 필터·정렬 화면을 표시하지 않는다. 검색은 페이지당 6개를 표시한다. `SearchNavigationContext`는 Hero 페이지 이동만 로컬 상태로 처리한다. 검색어를 비우거나 초기화하면 진행 중 요청을 취소하고 결과 영역을 제거해 Hero 높이를 복원한다. Hero 아래 바로가기·카테고리·최근 게시글·통계·푸터와 상단 검색 메뉴 및 일반 검색 페이지는 그대로 유지한다.

상단 데스크톱 검색 드롭다운을 단일 `/search` 링크로 바꾸고 모바일 헤더에도 같은 직접 링크를 제공한다. 하단 탭 구성과 기존 URL의 파라미터 처리는 유지한다.

사진 첨부 시 같은 결과 영역에서 기존 POST 이미지/텍스트+이미지 검색을 사용한다. 사진 검색은 특정 게시판을 선택해야 한다. 기존 카드, 사진 없는 카드의 텍스트 확장, 공통 Select, 기간·카테고리·상태·캠퍼스 필터를 재사용한다.

## 판별 및 순위

- 판별만 NFKC·공백을 정규화하며 실제 키워드 검색어는 변경하지 않는다. 공백 제외 18자 미만은 키워드 우선 검색이다.
- 한국어는 18자 이상, 문장 표현(에서·근처에·잃어버렸·주웠 등), 4어절 이상을 사용한다. 분실·습득 동사가 명확하면 띄어쓰기 없는 긴 문장도 허용한다.
- 영어는 28자 이상, 6단어 이상, `I/my/lost/found/left/looking/dropped/someone` 표현을 요구한다. 보수적 규칙이며 별도 LLM 판별은 없다.
- 키워드 상위 100개 + 의미 상위 10개를 먼저 통합한다. 키워드 관련도는 기존 검색의 최신순을 재사용한다.
- RRF는 `Σ weight/(k+rank)`, 기본 `k=60`, 가중치 각각 1이다. 함수 인자로 조정 가능하다. 각 소스 내부 중복도 제거한다.
- 게시판별 ID가 겹칠 수 있어 `type:id`로 식별한다. 동점은 생성일 내림차순 → ID 내림차순 → 게시판 종류 → 키로 결정한다.
- 관련도순은 RRF를 사용한다. 최신·오래된·조회·댓글순을 명시하면 통합 후보에 기존 정렬을 적용한다.
- 전체 후보를 정렬한 뒤 페이지를 자르므로 각 페이지의 순위·개수가 같은 후보 풀을 기준으로 한다. 결과 개수는 전체 DB 추정치가 아닌 실제 통합 후보 수다. 키워드 후보가 잘리면 안내를 표시한다. 최대 110개이며 중복 제거 후 줄어든다.
- AI 실패·제한 시 원래 키워드 총개수와 페이지를 복원한다. 이미 조회한 키워드 후보를 재사용하고 필요한 깊은 페이지에서만 추가 조회한다.
- 짧은 검색의 0건 대체는 같은 의미 후보·필터·명시적 정렬을 사용하고 페이지를 나누며 `semantic-fallback`으로 구분한다. 현재 페이지가 비었어도 전체 키워드 결과가 있으면 AI를 실행하지 않는다. 빈 검색어에는 AI를 실행하지 않는다.

기존 `/api/posts`의 기본 모드는 `keyword`로 보존했다. `mode=keyword` URL은 통합 UI에서도 필터 변경 후 유지하므로 기존 동작으로 비교·복귀할 수 있다. 기존 `mode=semantic`, POST `mode=ai/image`도 유지한다. 저장 데이터·환경 변수·DB 스키마는 변경하지 않았다.

## 비용 및 측정

짧은 검색의 키워드 결과가 있으면 모델 추론 0회다. 0건 대체와 긴 자연어는 캐시 미스에서 질의 임베딩 1회다. AI 호출 제한은 실제 의미 검색 직전에만 확인하므로 키워드 적중은 AI 제한을 소모하지 않는다. 제한 확인 실패도 키워드 결과로 대체한다. RRF 계산에 AI 호출은 없다. 동일 질의는 프로세스별 120초·최대 64개 벡터 캐시로 페이지·필터 변경 및 동시 요청에서 추론을 공유한다. 키는 SHA-256이며 게시글 결과나 공개 여부는 캐시하지 않는다. 서버리스 인스턴스가 달라지거나 만료되면 다시 추론한다. 게시글 임베딩을 재생성하지 않는다.

외부 유료 임베딩 API가 아닌 기존 로컬 모델을 사용한다. 자연어는 기존 키워드 검색보다 의미 벡터 조회·모델 CPU 비용이 추가된다. 사진 검색의 기존 추론은 유지한다.

249개 기존 합성 평가 게시글을 Preview에서 **READ ONLY 트랜잭션**으로 읽어 제목·ID를 기존 정답 파일과 대조했다. 저장 임베딩을 재사용하고 이후 비교·브라우저 검증은 DB 연결 없이 로컬 스냅샷으로 실행했다. Production 접근·데이터 쓰기는 없다.

상위 5개 비교는 [UNIFIED_SEARCH_COMPARISON.json](./UNIFIED_SEARCH_COMPARISON.json)에 있다. 정답이 있는 자연어 7건에서 기존 의미 검색과 통합 검색 모두 Hits@5 **4/7**이다. 자유 입력 예시에는 정답이 없어 정확도/NDCG를 계산하지 않았다. `핑크색 무언가`, `분홍색 무언가`, `검은색 지갑`, `C타입 충전기`는 키워드 0건에서 의미 결과 10건으로 복구했고 상위 5개의 순서가 기존 의미 검색과 일치한다. 핑크 검색에는 분홍 마우스·장우산·키보드 등이 나온다. 이는 현재 로컬 평가 자료이며 사용자가 이전에 본 필통·휴대전화의 운영 데이터 검증은 아니다. `에어팟 한쪽`, `파란색 텀블러`, 정확한 제목은 키워드 적중으로 모델 추론 0회를 유지한다. 의미 모델·임계값은 바꾸지 않았으므로 기존 AI의 색상 불일치·무의미한 검색어에 대한 오탐도 남아 있다.

모델 준비 후 캐시 없는 자연어의 로컬 코어 실행은 약 **13–24ms**, 페이지 이동의 추가 임베딩은 0회였다. 두 번의 브라우저 실행에서 로컬 HTTP 헤더 응답 시간은 키워드 약 **0.8–1.9ms**, 캐시된 자연어 약 **1–5ms**, 사진 검색 약 **247–476ms**였다. 새 프로세스의 첫 자연어 요청은 모델 로딩을 포함해 약 **966ms**였다. 단일 환경 측정이며 운영 SLA·통계적 벤치마크가 아니다. 실제 pgvector HNSW 대신 평가 자료 내 정확 코사인 검색을 사용했으므로 운영 DB·네트워크·서버리스 콜드 스타트의 지연이나 품질을 나타내지 않는다.

## 검증

- 검색·AI·API·홈·번역 관련 45개 파일, **683개 테스트 통과**. 판별, RRF 수식·중복·동점, 게시판 ID 충돌, 후보 제한, 정렬·페이지·필터, AI 예외·제한 대체, 캐시 만료·오류·동시 요청, 이미지 전송, 기존 의미·이미지 회귀를 포함한다.
- 후속 수정: 메뉴·짧은 검색 대체·RRF·캐시·이미지 전송 관련 **10개 파일 111개 테스트 통과**. AI 제한·예외, 빈 검색어, 빈 페이지와 전체 0건 구분, 명시적 정렬 및 필터 전달을 검증했다.
- `npx tsc --noEmit` 통과. 후속 수정 파일 ESLint 통과.
- Edge 실제 브라우저에서 입력창 하나/토글 제거, 검색당 요청 1회, 자연어 통합 목록, 페이지 중복 제거·총개수 유지, 최신순, 카테고리 자동 적용, 쿼리 유지, 키워드 복귀 경로, 실패 대체, 실제 SigLIP 사진 검색 POST, 사진 제거, 홈 진입을 확인했다.
- 320/390/768/1024/1440px에서 가로 넘침 없음. 데스크톱·320px 스크린샷을 확인했다. 사진 없는 카드는 이미지 컨테이너 없이 텍스트가 확장된다. 브라우저 미처리 오류 0건.
- 후속 브라우저 검증: 데스크톱·모바일마다 보이는 검색 링크 1개, 검색 드롭다운 없음, `/search` 직접 이동, 핑크 검색 단일 GET·10건 복구, 모바일 폭에서 Enter 검색을 확인했다. 필터·정렬·페이지·이미지 검색과 320~1440px 검증도 재확인했다.
- 전체 테스트와 프로덕션 빌드는 이번 검증 범위에서 실행하지 않았다. 실제 Next 서버의 인증·운영 DB 검색·운영 권한, 실제 HNSW 검색 지연, 사용자 관련성 평가는 미검증이다. 로컬 미리보기는 라우터 어댑터와 읽기 전용 후보 어댑터를 사용하므로 실제 Next 배포 검증을 대체하지 않는다. 메뉴 검증은 실제 DesktopNav·MobileSearchLink 컴포넌트를 사용하며 인증 정보까지 포함한 전체 Header 검증은 아니다.

## 직접 확인

현재 실행 주소: **http://127.0.0.1:4210/search**

```powershell
# 검증된 로컬 스냅샷과 기존 .next CSS·로컬 모델 파일이 있는 현재 작업 공간
node scripts/preview-unified-search.mjs

# 같은 자료로 비교 재실행: DB 연결 없음
node scripts/compare-unified-search.mjs
```

`/home`, `/lost`, `/found`도 제공한다. `?limit=5`로 페이지 이동을 확인한다. `?mode=keyword&q=...`로 기존 키워드 검색을 비교한다. 미리보기 전용 `aiFailure=1`은 AI 없는 대체 경로를 확인하는 옵션이며 제품 API에 추가하지 않았다. 파일 선택은 `docs/ai-eval-seed/query-images/Q01.jpg`로 확인할 수 있다. 카드 사진은 로컬 예시 사진으로 대체되며 실제 각 게시글 사진을 검증한 것은 아니다. 상세 링크는 로컬 안내 화면이다.

로컬 스냅샷은 `.vercel/unified-search-preview/posts.json`에만 있으며 Git에서 제외된다. 이를 다시 얻는 `--read-preview`는 Preview 식별 확인·READ ONLY 쿼리만 수행하지만 이미 저장된 자료로 실행하면 네트워크 접근이 필요 없다. 환경 변수 파일이나 배포 설정은 수정하지 않는다.

## 이번 검색 작업의 변경 파일

이전 카드·Select 수정은 별도 기존 변경으로 유지했다. 이번 변경은 다음과 같다.

- 검색 코어: `src/lib/posts/{searchIntent,reciprocalRankFusion,unifiedSearch,postSort}.ts`, `src/lib/ai/queryEmbedding.ts`
- 기존 검색 연결: `src/lib/posts/{service,aiService,schema,searchApiClient}.ts`, `src/app/api/posts/route.ts`
- 화면: `src/app/(main)/{search,lost,found}/page.tsx`, `src/components/search/{SearchFilterBar,UnifiedSearchInput,ImageSearchResults,SemanticSearchResults,AISearchPanel}.tsx`, `src/components/search/searchModeParams.ts`, `src/components/home/HomeSearchBar.tsx`
- 번역: `src/lib/i18n/messages/{ko,en,ja,zh,fr,vi,mn}.ts`
- 후속 메뉴 수정: `src/components/layout/{NavLinks.ts,Header.tsx,MobileSearchLink.tsx,NavLinks.test.ts,SearchNavigation.test.tsx}`
- 테스트: 신규 코어 4개 `.test.ts`, `src/lib/posts/searchApiClient.test.ts`, `src/app/api/posts/route.test.ts`, `src/components/search/{searchModeParams.test.ts,semanticPages.test.tsx}`, `src/components/home/HomeSearchBar.test.tsx`, `src/lib/i18n/messages/localeParity.test.ts`
- 로컬 검증: `scripts/{compare-unified-search,preview-unified-search,search-preview-build}.mjs`, `scripts/fixtures/{UnifiedSearchPreview.tsx,searchPreviewBackend.ts,searchPreviewRetrievers.ts,searchPreviewMetrics.ts,searchPreviewNavigation.ts,searchPreviewLink.tsx}`, 본 문서와 비교 JSON

원격 push, Preview/Production 배포, 마이그레이션은 수행하지 않았다.
