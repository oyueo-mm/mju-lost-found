# Preview 검색 수정 및 배포 전 확인

## 원인과 수정 범위

기준 소스는 `51f60be`이며 그 이전 6개 로컬 커밋을 그대로 유지한다. GitHub push, Production 배포·DB 변경은 이번 작업 범위에 없다.

최초 조회한 오류 7건은 모두 기존 Preview `dpl_ecZpsJMf3Z8hWjb6ZR7hiVdg4SP1`의 `/search`에서 발생했다. 코드 위치는 `src/app/(main)/search/page.tsx`의 semantic 분기 → `src/lib/posts/searchApiClient.ts`의 `res.json()`이었다. 로그에는 `Failed to search posts SyntaxError: Unexpected token '<', "<!DOCTYPE "... is not valid JSON`이 남고 페이지 HTTP 상태는 200이었다. 과거 7개 응답의 전체 본문·검색 조건은 로그에 보존되지 않아 각각의 원본 응답까지 복원하지는 못했다.

같은 기존 Preview의 별칭 및 배포 고유 URL에서 일반 비인증 API 요청을 재현했다.

1. `/api/posts?type=found&mode=semantic&q=검은 지갑` → 302, `text/plain`, `https://vercel.com/sso-api`로 이동.
2. 기본 fetch처럼 redirect를 따라가면 최종 `https://vercel.com/login` → 200, `text/html; charset=utf-8`, 제목 **Login – Vercel**, 본문은 `<!DOCTYPE html>`로 시작한다.
3. 이전 helper는 `res.ok`만 확인해서 이 200 HTML을 JSON으로 읽었다. 따라서 해당 오류의 발생 메커니즘을 재현했으며, ONNX 추론 실패를 뜻하는 로그가 아니다.

사용자가 전달한 기존 Claude 검증(최적화된 Linux Function 파일만으로 텍스트·이미지 추론 성공, 최적화 Preview 자연어·이미지·결합 검색 정상 응답)은 기존 검증 근거로 인정한다. 이번 수정은 모델·tracing·CPU runtime 파일·검색 알고리즘을 변경하지 않는다. 이 결과는 정상 로그인 후 게시글 쓰기와 DB 임베딩 갱신의 통합 검증을 대신하지는 않는다.

수정은 구형 `mode=semantic` URL 경로에 집중했다. `/search`, `/lost`, `/found`의 서버 자기 호출을 제거하고 `SemanticSearchResults`가 브라우저에서 상대 경로 `/api/posts`를 호출한다. 기존 모델은 기존 AI 함수에만 남는다. 정상 same-origin 쿠키를 사용하고 보호 우회 헤더·토큰은 사용하지 않는다. redirect는 오류로 처리하며 HTML 응답은 JSON 파싱 전에 구분한다. 검색 조건과 페이지 링크를 유지하며, 이전 요청이 늦게 끝나 새 결과를 덮지 않도록 취소한다. `/search`의 구형 semantic 링크는 결과 영역이 실제로 보이도록 기본 UI 모드를 맞췄다. 현재 AI 검색창의 POST 경로는 변경하지 않았다.

서버 렌더링에서 제거한 semantic 결과는 브라우저가 로드한다. 해당 구형 링크는 JavaScript가 있어야 결과를 표시한다. 키워드 검색은 기존 서버 렌더링을 유지한다. 이미지를 붙일 때의 별도 내부 임베딩 갱신 요청은 기존처럼 요청 쿠키를 전달하며 이번에는 변경하지 않았다. 아래 사진 교체 검증에서 함께 확인한다.

## 필요한 수동 검증 — Preview에서만

이 세션에는 사용 가능한 브라우저가 없으므로 정상 Google 로그인이 필요한 단계는 운영자가 진행한다. Vercel 보호 로그인과 앱 Google 로그인은 별개다. 보호를 해제하거나 우회할 필요는 없다.

### 1. 검색 회귀 확인

1. `https://mju-lost-found-preview.vercel.app`에서 정상 Vercel 로그인 후 앱의 Google 로그인을 완료한다. 브라우저 개발자 도구 Network의 Preserve log를 켠다.
2. `/search?mode=semantic&type=found&q=검은%20지갑`을 연다. 로딩 뒤 결과 또는 정상적인 결과 없음 안내가 보여야 한다. Network의 `/api/posts` 응답이 200 JSON인지 확인한다. Vercel 로그인 HTML이나 JSON 파싱 오류가 보이면 실패다.
3. `/lost?mode=semantic&q=검은%20지갑`, `/found?mode=semantic&q=검은%20지갑`도 확인한다. 기간·카테고리 필터와 페이지 이동·새로고침·뒤로가기를 확인한다. `/search?mode=semantic&type=found&q=지갑&limit=1`로 페이지 링크를 확인할 수 있다(결과가 2건 이상인 경우).
4. 일반 키워드 검색과 현재 AI 검색창의 텍스트만·이미지만·텍스트+이미지 검색을 각각 1회 확인한다. 이미 완료된 대규모 모델 검증을 반복할 필요는 없다.

### 2. 작성 → 임베딩 → 추천 (가장 중요)

1. Preview에만 테스트 글을 만든다. 임의 테스트 사진을 준비하고, 테스트 글 제목 앞에 `[배포확인]`을 붙여 식별한다. 기존 사용자 글은 수정하지 않는다.
2. 먼저 **습득물 A**를 작성한다. 예: 검은 가죽 지갑, 학생회관 1층, 지갑 카테고리, 구체적인 외형 설명과 사진. 상태는 `보관 중`으로 둔다. URL의 ID를 기록하고 임베딩 완료를 기다린다.
3. 그다음 **분실물 B**를 작성한다. A와 같은 물건·카테고리·장소·사진으로 작성하고 상태는 `찾는 중`으로 둔다. B URL의 ID를 기록한다. A가 준비된 뒤 B를 작성해야 기존 추천 캐시의 갱신 시점 문제와 혼동하지 않는다.
4. B 상세의 AI 추천 로딩이 종료되고 A가 추천되는지 확인한다. 자동 재시도가 끝났어도 백그라운드 처리가 늦을 수 있으므로 잠시 뒤 새로고침한다. 계속 추천이 없으면 성공 처리하지 말고 글 ID·시각과 함께 보고한다. HTTP 작성 성공만으로 임베딩 성공을 판정하지 않는다.
5. Preview Vercel Logs에서 두 ID에 대해 `Failed to generate embedding`, `Failed to generate image embedding`, `Image embedding trigger responded`, `Failed to trigger image embedding` 및 ONNX 파일/네이티브 로드 오류가 없는지 확인한다.

### 3. 수정·사진·댓글

1. B의 제목·설명을 다른 물건으로 바꿔 저장한다. 글 내용뿐 아니라 아래 DB 검증에서 text hash가 바뀌는지 확인한다. 단순 상태 변경은 text 임베딩을 갱신하지 않는 것이 정상이다. 다시 A와 맞는 설명으로 되돌린 뒤 추천을 확인한다.
2. B 사진을 **실제로 다른 사진**으로 교체한다. 화면 반영과 image hash 변경을 확인한다. 이미지가 여러 장이면 대표 사진을 바꿨을 때도 확인한다.
3. B의 사진을 모두 제거하고 이미지 임베딩이 비워지는지 확인한다. 다시 사진을 추가해 이미지 임베딩 재생성을 확인한다.
4. 테스트 댓글을 작성하고 해당 댓글만 삭제한다. 편집·삭제 권한이 정상인지 확인한다.
5. 생성한 테스트 글·댓글만 앱의 정상 UI로 정리한다. 정리 전 필요한 ID와 결과를 기록한다.

### 4. 운영 UI

로그인 전후 홈페이지 공통 디자인, 관리자 카테고리·방문·로그인·활동 통계, 몽골어 화면의 날짜·새로고침 콘솔 오류를 확인한다. Production 전체 관리자 열람은 ID 150으로만 정상 확인한다. 이번 작업에서는 Production에 테스트 글을 쓰지 않는다.

## 임베딩 DB 증거 (ID를 받은 뒤 읽기 전용으로 확인 가능)

글 작성 응답은 먼저 반환되고 임베딩은 `after()`에서 best-effort로 생성된다. 그래서 UI 저장 성공과 임베딩 성공을 별도로 확인한다. Preview DB에서 지정한 테스트 ID만 SELECT한다. 세션 단위 READ ONLY는 사용하지 않는다.

```sql
-- $1에 실제 테스트 분실물 B ID를 바인딩한다. 습득물 A는 FoundPost로 동일하게 확인한다.
SELECT id,
       embedding IS NOT NULL AS text_ready,
       "imageEmbedding" IS NOT NULL AS image_ready,
       md5(embedding::text) AS text_hash,
       md5("imageEmbedding"::text) AS image_hash
FROM "LostPost"
WHERE id = $1;
```

작성 후 text_ready=true, 사진 첨부 완료 후 image_ready=true가 기준이다. 텍스트·대표 사진을 실제로 바꾸면 해당 hash가 바뀌고, 모든 사진 제거 후 image_ready=false가 되어야 한다. 사용자 내용이나 벡터 원문을 출력할 필요는 없다. 추천 결과와 로그를 함께 보아야 end-to-end 성공을 판정할 수 있다.

## Production 배포 게이트

- 이전 전체 테스트 2,312개 통과는 재사용한다. 이번에는 변경한 검색 전송·세 페이지·페이지 링크와 기존 날짜 복원·bundle tracing 테스트에 집중한다.
- Function Storage는 새 Preview의 실제 lambda digest별 size 합계를 확인한다. 모델 포함 범위는 유지하며 목표는 약 500MiB다.
- Production 사용자 150의 관리자 권한과 `ADMIN_ACTIVITY_VIEWER_IDS`의 Production sensitive 변수 존재는 확인했다. 단일 변수 읽기 API에서도 값이 반환되지 않아 **정확히 150인지 확인 불가**다. 변수는 변경하지 않았다. Vercel 프로젝트 Settings → Environment Variables에서 해당 Production 값을 운영자가 확인하고, ID 150의 정상 로그인 전체 보기로 확인한다. 값을 채팅에 붙일 필요는 없다.
- 정상 로그인 쓰기 및 임베딩·추천 검증이 확인되기 전에는 Production 배포 가능 판정을 내리지 않는다. 이전 Claude ONNX 검증 자체를 다시 배포 차단 항목으로 삼지는 않는다.
- 실제 Production 배포 때만 기존 암호화 백업·복원 검증 → 대상 DB 재확인 → `20261106000000_admin_visit` 적용 → 방침 시행일을 실제 KST 배포일로 확정 → 검증된 소스 push·Production 배포 → 오류·기능 확인 순서를 따른다. 이번에는 이 작업을 실행하지 않는다.
