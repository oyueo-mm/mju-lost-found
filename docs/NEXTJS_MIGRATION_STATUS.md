# Next.js Migration Status

> Phase 8 산출물. 작성 기준: `main` 브랜치(레거시 Streamlit, 커밋은 `git log main`으로 확인), `vercel` 브랜치(Next.js, 이 문서 작성 시점 최신 커밋 `de834db`), 2026-09-05.
> 이 문서는 기능 구현을 하지 않는다 — 실제 코드(`main:app.py`, `main:pages/*.py`, `main:db/database.py`, `main:ai/*.py`, `main:ui/*.py`, `vercel` 브랜치의 `src/app/**`, `src/lib/**`, `src/components/**`)를 직접 읽고 확인한 결과만 기록한다. 추측이 필요한 부분은 명시적으로 "미확인"으로 표기한다.

---

## 1. Overall Status

- **DB 스키마**: `prisma/schema.prisma`는 `main:db/schema.sql`의 모든 테이블(User, LostPost, FoundPost, Match, ChatRoom, Message, Report, ModerationAction, Notification)과 모든 컬럼·제약조건을 이미 1:1로 포함하고 있다. 스키마 레벨에서는 마이그레이션이 사실상 끝나 있다.
- **백엔드(서비스/API) 레벨**: 게시글 CRUD, 이미지 업로드(Supabase Storage), AI 임베딩/매칭(pgvector, Phase 6~7에서 실제 Vercel 배포로 검증됨), 채팅(매칭 기반), 신고, 관리자 조치(게시물 삭제/메시지 숨김/사용자 정지), 알림까지 **레거시의 핵심 도메인 로직 대부분이 이미 구현되어 있다.** 이는 이번 조사 전 예상보다 훨씬 진행된 상태였다.
- **가장 큰 실제 공백은 UI 레벨의 특정 기능들과, 서비스는 있지만 진입 지점(페이지/버튼)이 없는 경우**다: AI 자연어 의미 검색, 게시글 상태 변경 UI, "내 게시물" 전용 관리 페이지, direct 채팅(매칭 없이 게시글에서 바로 문의), 게시판 상태 필터, 카테고리 고정 목록.
- **배포 가능 상태**: `npm test`(391건 통과) / `npm run lint`(클린) / `npm run build`(클린) 모두 이번 조사 시점에 재확인했다(§ Overall Status 하단 근거 참고). Phase 6~7에서 실제 Vercel 배포까지 검증되었으므로, 현재 `vercel` 브랜치는 **배포 가능한 상태**다.
- **`main` 브랜치는 이번 Phase 동안 전혀 수정하지 않았다** (읽기 전용으로 `git show main:<path>`만 사용).

---

## 2. Streamlit Feature Inventory

`main` 브랜치의 `app.py`, `pages/1~8_*.py`, `ui/auth.py`, `ui/common.py`, `db/database.py`, `ai/embedding.py`, `ai/matching.py`, `ai/search.py`를 전부 읽고 정리한, 사용자 관점 기능 목록이다.

### 인증/사용자
- Google OIDC 로그인/로그아웃 (`st.login`/`st.logout`, `ui/auth.py`)
- `@mju.ac.kr` 도메인 제한 (`is_allowed_domain`)
- 최초 로그인 시 User row get-or-create (`resolve_user_id`)
- 닉네임 온보딩 — 1회만 설정 가능, 이후 변경 불가 (`set_initial_nickname`)
- 사이드바에 닉네임/이메일 상시 표시 + 로그아웃 버튼 (`render_sidebar_auth`)
- 관리자 여부는 매 요청마다 DB에서 재확인 (`db.is_admin`, session_state 신뢰 안 함)
- 정지 계정: 조회는 허용, 쓰기 액션(게시글/매칭/채팅)만 차단 (`_require_not_suspended`)

### 게시글 (찾아요=분실물 / 찾았어요=습득물, 완전 대칭 구조)
- 게시판 목록 + 키워드 검색 + 카테고리 필터(고정 9종) + 상태 필터(각 보드의 2가지 상태)
- **AI 의미 검색**: 자연어 문장을 입력하면 임베딩으로 **반대편 게시판**에서 유사 게시글 top-10 검색 (`ai.search.search_similar_posts`)
- 게시글 상세보기 (같은 탭 선택 또는 "새 탭에서 보기" — query param으로 상태 복원)
- 게시글 등록: 제목/설명/카테고리(select)/장소/날짜+시간/이미지(선택)
- **작성자와 채팅하기** — 매칭 없이 바로 채팅 시작 (direct chat, `get_or_create_direct_chat_room`)
- 게시글 신고
- **AI로 유사한 OO 찾기** — 이 게시글 기준으로 반대편 게시판 후보 top-5 (`ai.matching.find_similar_*_posts`)
- 내 게시물 목록(분실/습득 탭 분리)
- 게시글 상태 변경 (찾는 중→찾음, 보관 중→완료) — 버튼 하나
- 게시글 수정(이미지 교체 포함, 날짜는 수정 불가 — 재등록 안내)
- 게시글 삭제(확인 다이얼로그)

### AI 매칭
- "내 물건 같아요" 버튼으로 후보를 Match로 확정 (`db.create_match`, idempotent)
- 내 매칭 목록(전용 페이지) — 역할 표시(분실자/습득자), 유사도 점수, 상대 신고, 상대 게시물로 이동, 채팅하기, 매칭 취소

### 채팅
- 매칭 기반 채팅방 (Match 1:1)
- **Direct 채팅방** — 게시글에서 바로 시작, Match 불필요
- 메시지 목록 — 커서 기반 페이지네이션("이전 메시지 불러오기"), 최신 메시지 병합 로직
- 들어갈 때 자동 읽음 처리(상대 메시지만)
- 메시지 신고
- 내 채팅 목록(매칭방+direct방 통합, 최근 대화순)

### 신고/관리자
- 게시글/메시지/사용자 신고 (사유 선택 + 상세 텍스트)
- 관리자: 신고 목록(상태/유형 필터, 페이지네이션, pending 우선 정렬)
- 신고 처리: 반려 또는 조치 완료
- 조치: 게시물 삭제 / 메시지 숨김 / 사용자 정지(7일/30일/영구 선택)
- 처리 결과가 신고자에게 알림으로 전달

### 알림
- 타입 6종: message, match, report_processed, post_deleted, message_hidden, user_suspended
- 목록(페이지네이션), 모두 읽음 처리
- 클릭 시 관련 화면으로 이동(message→채팅방, match→내 매칭) + 읽음 처리

### 홈
- 로그인 상태에 따라 분기(비로그인/도메인 불일치/닉네임 미설정/정상)
- 정상 상태: 6개 카드(찾아요/찾았어요/내 게시물/내 매칭/내 채팅/알림) + 각 카드에 안읽음 개수 배지
- 관리자에게만 관리자 페이지 링크 노출

---

## 3. Next.js Feature Inventory

`vercel` 브랜치의 `src/app/**`(페이지+API 라우트), `src/lib/**`(서비스), `src/components/**`를 전부 읽고 확인한 실제 구현 상태다.

### 인증/사용자 (`src/lib/auth/*`, `src/app/(auth)/*`)
- Auth.js(next-auth) + Google Provider, Server Component에서 `getCurrentUser()`/`requireUser()`/`requireReadyUser()`/`requireAdmin()`으로 게이트
- `@mju.ac.kr` 도메인 제한(`domain.ts`) — 실패 시 `AccessDenied` 에러 메시지
- 닉네임 온보딩(`onboarding/page.tsx` + `NicknameForm.tsx`) — 1회 제한은 `nickname.ts`가 DB 레벨에서 강제
- `Header.tsx`(Server Component)가 모든 페이지 상단에 닉네임/이메일/로그아웃 상시 표시
- 관리자 여부는 매 요청 `getCurrentUser()`(항상 fresh DB read)로 재확인 — 클라이언트 상태 신뢰 안 함
- 정지 계정: `isCurrentlySuspended()`가 게시글/매칭/채팅 서비스 함수 안에서 재확인, `/suspended` 전용 안내 페이지(레거시엔 없던 신규 페이지)

### 게시글 (`src/lib/posts/*`, `src/app/(main)/{lost,found}/*`, `src/app/(main)/post/[id]/*`)
- `/lost`, `/found` 목록 + `SearchFilterBar`(키워드 q + category + location + sort, **상태 필터 없음**)
- `/search` — 두 게시판 통합 검색(type=all/lost/found), 정렬(최신/오래된순), **날짜 범위(dateFrom/dateTo) 필터는 레거시에 없던 추가 기능**
- **AI 의미 검색은 어디에도 없음** — `listQuerySchema`의 `q`는 순수 키워드(ILIKE류) 검색이고, 자유 텍스트를 임베딩해 반대편 게시판을 검색하는 API/서비스 함수 자체가 존재하지 않음(확인: `postEmbedding.ts`는 게시글 저장용, 쿼리 문자열 임베딩 경로 없음)
- 게시글 상세(`/post/[id]`) — URL 기반이라 "새 탭에서 보기"는 브라우저 기본 기능으로 자연스럽게 대체됨(레거시의 session_state 우회 로직 자체가 불필요해짐)
- 게시글 등록/수정 — `PostForm.tsx`: 제목/설명/**카테고리(자유 텍스트 input, select 아님)**/장소/일시(datetime-local, **수정 가능** — 레거시는 수정 불가)/이미지
- 이미지 업로드/교체/삭제 — Supabase Storage 직접 업로드(Phase 4), 표시 비율 문제 수정 완료(이미지 Phase)
- 게시글 삭제(`DeletePostButton.tsx`, confirm 다이얼로그)
- **게시글 상태 변경 UI 없음** — `updateLostPostSchema`/`updateFoundPostSchema`는 `status` 필드를 받지만(PATCH API 레벨에서는 가능), 이를 호출하는 버튼/폼이 어디에도 없음
- **"내 게시물" 전용 페이지 없음** — `/lost`, `/found`에 "내가 쓴 글만 보기" 필터도 없음
- **작성자와 direct 채팅하기 버튼 없음** — 게시글 상세 페이지에는 소유자에게만 `MatchPanel`이 보이고, 비소유자에게는 `ReportButton` 외 상호작용이 없음

### AI 매칭 (`src/lib/ai/*`, `src/lib/match/*`, `src/components/match/MatchPanel.tsx`)
- 임베딩: `TransformersEmbeddingProvider`(jhgan/ko-sroberta-multitask, 768차원) — Phase 6~7에서 실제 Vercel 배포로 검증 완료
- Vector 검색: `vectorSearch.ts`(pgvector, HNSW, `$queryRaw`)
- `MatchPanel`(게시글 상세, 소유자 전용): 매칭된 게시물 목록 + AI 후보(자동 로드) + "매칭하기"(확정) + "채팅하기" + "매칭 해제" — **레거시보다 통합된 UX**(별도 페이지 이동 없이 한 화면에서 처리)
- **"내 매칭" 전체 목록을 한 화면에서 보는 페이지는 없음** — `listMatchesForUser()` 서비스 함수는 존재하지만 이를 쓰는 페이지가 없음(대신 각 게시글 상세의 `MatchPanel`로 분산됨)

### 채팅 (`src/lib/chat/*`, `src/app/(main)/chat/*`, `src/components/chat/ChatThread.tsx`)
- 매칭 기반 채팅방만 지원 — `chat/service.ts`의 `ChatRoomWithMatch` 타입과 `participantIdsOf()`가 `room.match`가 없으면 무조건 `null`(= not_found) 처리하도록 명시적으로 구현되어 있어, **direct 채팅(매칭 없이 게시글에서 바로 문의) 경로 자체가 코드에 없음**(주석에도 "this phase doesn't implement direct rooms"라고 명시)
- 메시지 목록 — cursor 기반 페이지네이션(`before` 파라미터), "이전 메시지 불러오기" 버튼
- 들어갈 때 자동 읽음 처리 — API route에서 `markMessagesAsRead` + `markMessageNotificationsReadForChatRoom` 호출(확인 필요 시 `src/app/api/chat/[id]/route.ts` 참고)
- 메시지 신고(`ChatThread` 내 `ReportButton`)
- 메시지 숨김 처리 반영 — `listMessages()`가 `hiddenAt` 있으면 플레이스홀더로 치환(관리자 조치와 정합적으로 연결되어 있음, 관련 주석은 구현 당시엔 맞았으나 이후 모더레이션이 실제로 구현되며 최신화되지 않은 상태)
- 내 채팅 목록(`/chat`) — 매칭방만 표시(direct방 없으므로 당연히 매칭방만)

### 신고/관리자 (`src/lib/report/*`, `src/lib/moderation/*`, `src/app/(main)/admin/reports/*`)
- 게시글/메시지/사용자 신고 — `ReportButton.tsx`, `createReport()`
- 관리자 신고 목록(`/admin/reports`) — 상태/유형 필터, 페이지네이션, pending 우선 정렬 — **레거시와 사실상 동일한 로직**(두 개 쿼리 concat 방식까지 동일하게 재현)
- 신고 처리(`/admin/reports/[id]` + `ReportProcessForm.tsx`) — 반려/조치완료, 조치 종류(게시물 삭제/메시지 숨김/사용자 정지), 정지 기간(7일/30일/영구) — **레거시와 완전히 동일한 옵션 구성**
- 조치 시 신고자에게 결과 알림, 대상자에게 제재 알림 — 트랜잭션으로 원자적 처리

### 알림 (`src/lib/notification/*`, `src/app/(main)/notifications/*`)
- 타입 6종 라벨까지 레거시와 완전히 동일(`NOTIFICATION_TYPE_LABELS`)
- 목록(페이지네이션), 모두 읽음 처리(`MarkAllReadButton`)
- 클릭 시 이동 — **`match` 타입만 지원**(`getOwnedPostRefForMatch`로 게시글 상세로 이동). **`message` 타입은 관련 채팅방으로 이동하지 않음** — `resolveHref()`가 `relatedType !== "match"`이면 무조건 `null` 반환, 주석은 "chat isn't implemented"라고 되어 있으나 이는 이제 사실이 아님(채팅은 구현됨) — 이 부분만 뒤늦게 갱신되지 않은 것으로 보임
- Header에 안읽음 개수 배지 상시 표시(홈페이지 한정이 아니라 모든 페이지)

### 홈 (`src/app/(main)/page.tsx`)
- 정적 네비게이션 카드 2개(분실물 찾기/습득물 등록·조회)뿐 — 로그인 상태 분기, 6개 카드 대시보드, 안읽음 카운트 배지는 **모두 Header로 이전되었거나(로그인 상태·안읽음 카운트) 아예 없음(6개 카드 대시보드 자체)**
- "최근 게시물" 섹션은 "추후 실제 데이터 연동 예정"이라는 정적 문구만 있는 미완성 placeholder — 레거시에는 없던, Next.js 쪽에서 스스로 예고만 해둔 기능

### 테스트
- `main`: `tests/` 아래 pytest 23개 파일(UI 시나리오 중심 — Streamlit `AppTest` 기반으로 추정, 파일명만 확인함)
- `vercel`: Vitest, 44개 테스트 파일 391 케이스, 전부 서비스/스키마 레벨 유닛 테스트(컴포넌트 렌더링 테스트는 없음 — Vitest node 환경, `CLAUDE.md`/session 설정과 일치)

---

## 4. Feature Gap Matrix

| 기능 | Streamlit | Next.js | 상태 | 비고 |
|---|---|---|---|---|
| Google OAuth 로그인/로그아웃 | O | O | **A** | Auth.js로 완전 이식 |
| @mju.ac.kr 도메인 제한 | O | O | **A** | |
| 닉네임 온보딩(1회, 불변) | O | O | **A** | |
| 사용자 정보/로그아웃 상시 표시 | 사이드바 | Header(모든 페이지) | **A** | 위치만 이동 |
| 정지 계정 쓰기 차단 | O | O | **A** | |
| 정지 안내 화면 | 인라인 경고만 | 전용 `/suspended` 페이지 | **A** | Next.js가 더 명확, 레거시엔 없던 개선 |
| 분실물/습득물 게시판 목록 | O | O | **A** | |
| 키워드 검색(제목/설명 등) | O | O | **A** | |
| 카테고리 필터(검색) | O(고정 9종) | O(자유 텍스트) | **B** | 검색 자체는 되나 값 일관성 보장 없음 |
| 카테고리 선택(등록/수정) | select 고정 목록 | 자유 텍스트 input | **B** | 데이터 일관성 저하, 필터 정확도에 영향 |
| 상태 필터(찾는중/찾음 등) | O | 없음 | **C** | 스키마·API는 지원, UI/쿼리스키마 모두 없음 |
| 날짜 범위 검색 | 없음 | O(dateFrom/dateTo) | — | Next.js가 추가한 신규 기능(레거시엔 없음) |
| 게시글 상세보기 | O(+새 탭 우회 로직) | O(URL 기반) | **A** | 구조적으로 더 자연스러움 |
| 게시글 등록 | O | O | **A** | |
| 게시글 수정 | O(날짜 불가) | O(날짜도 가능) | **A** | Next.js가 더 유연 |
| 게시글 삭제 | O | O | **A** | |
| 게시글 상태 변경 | 버튼 1개 | 없음 | **C** | 백엔드(PATCH API)는 가능, 진입 UI 없음 |
| 이미지 업로드/표시 | 로컬 uploads/ | Supabase Storage | **A** | 스토리지까지 완전히 재설계·검증됨 |
| 내 게시물 목록(전용 페이지) | O | 없음 | **C** | `/lost`, `/found`에 "내 글만" 필터도 없음 |
| 작성자에게 direct 채팅(문의) | O | 없음 | **C** | 게시글 상세에 버튼 자체가 없음 |
| 게시글/메시지/사용자 신고 | O | O | **A** | |
| AI 매칭 후보 찾기(게시글 기준) | O(별도 섹션) | O(`MatchPanel`) | **A** | Phase 6~7 실배포 검증 완료 |
| AI 자연어 의미 검색(자유 텍스트) | O | 없음 | **C** | 서비스/API 자체가 없음 |
| 매칭 확정("내 물건 같아요") | O | O | **A** | |
| 매칭 취소 | O | O | **A** | |
| 매칭 상대 신고 | O | O | **A** | |
| 내 매칭 전체 목록(전용 화면) | O(별도 페이지) | 없음(게시글별 `MatchPanel`로 분산) | **D** | 기능은 있으나 legacy 구조 그대로 옮기면 안 되고, 크로스 게시글 조회 화면으로 재설계 필요 |
| 매칭 기반 채팅 | O | O | **A** | |
| Direct 채팅(매칭 없이) | O | 없음 | **C** | 코드 주석에 명시적으로 미구현 |
| 메시지 페이지네이션 | O | O | **A** | |
| 메시지 읽음 처리 | O | O | **A** | |
| 메시지 신고 | O | O | **A** | |
| 메시지 숨김(모더레이션 연동) | O | O | **A** | |
| 내 채팅 목록 | O | O(매칭방만, direct 없어서 당연) | **B** | direct 채팅 미구현의 파생 결과 |
| 관리자 신고 목록(필터/페이지) | O | O | **A** | 정렬 로직까지 동일 |
| 신고 처리(반려/조치완료) | O | O | **A** | |
| 조치 - 게시물 삭제 | O | O | **A** | |
| 조치 - 메시지 숨김 | O | O | **A** | |
| 조치 - 사용자 정지(기간 선택) | O | O | **A** | 옵션(7일/30일/영구) 동일 |
| 알림 목록/모두읽음 | O | O | **A** | |
| 알림 클릭 시 이동 - match | O | O | **A** | |
| 알림 클릭 시 이동 - message | O(채팅방으로 이동) | 없음(이동 안 됨) | **B** | 채팅은 구현됐는데 알림 링크만 못 따라감 — 소규모 수정으로 해결 가능 |
| 홈 대시보드(6개 카드+안읽음 배지) | O | 없음(카드 2개+안읽음 배지는 Header로 이전) | **B** | 안읽음 표시는 Header가 대체하지만 대시보드형 홈은 없음 |
| 홈 "최근 게시물" | 없음(레거시에 없는 개념) | placeholder만 존재 | — | Next.js 자체 계획 항목, 레거시 갭 아님 |

**분류 개수(표의 행 기준)**: A(완료) 30행 · B(부분 구현) 4행 · C(미구현) 6행 · D(재설계 필요) 1행 · 신규/해당없음 2행.
**중복 제거한 실제 기능 갭 개수(최종 보고서 기준)**: B(부분 구현) 4개(카테고리 검색 필터, 카테고리 등록/수정, 내 채팅 목록, 알림→메시지 이동) · C(미구현) 5개(상태 필터, 게시글 상태 변경 UI, 내 게시물 페이지, direct 채팅, AI 자연어 검색 — 표의 direct 채팅 관련 2행은 하나의 기능으로 합산) · D(재설계 필요) 1개.

---

## 5. Architecture Migration Status

### Authentication — Streamlit OIDC(`st.login`/`st.user`) → Auth.js
**완료.** `next-auth`(Auth.js v5 beta) + Google Provider. `src/lib/auth/session.ts`가 `getCurrentUser()`/`requireUser()`/`requireReadyUser()`/`requireAdmin()` 4단계 게이트를 제공하며, 각각 레거시의 `is_logged_in()`/`is_authorized()`/`require_ready_user()`/`require_admin()`과 1:1 대응한다. 세션은 매 요청 DB 재조회(fresh) — 클라이언트 상태를 신뢰하지 않는 레거시 원칙 그대로 유지.

### Database — SQLite → PostgreSQL/Prisma
**스키마 레벨 완료.** `prisma/schema.prisma`가 `db/schema.sql`의 9개 테이블·모든 제약조건(UNIQUE, CHECK→enum, 부분 유니크 인덱스의 NULL 시맨틱 대체 포함)을 반영. Prisma 7 + `@prisma/adapter-pg`(driver adapter 방식, 별도 쿼리 엔진 바이너리 불필요) 구조로 Phase 3에서 이미 전환 완료, Phase 6에서 `vector(768)` 컬럼까지 추가됨. 남은 작업은 스키마가 아니라 그 위의 서비스/UI 레이어(§4의 C/D 항목들).

### Storage — local uploads/ → Supabase Storage
**완료.** Phase 4에서 전환, 이미지 표시 비율 문제도 별도 Phase로 수정 완료. `src/lib/images/*`(service, supabaseAdmin, supabaseBrowser, pathname, config)로 서버 전용 업로드·삭제·경로 검증 로직이 분리되어 있다.

### AI — 기존 Python SentenceTransformer → Transformers.js + pgvector
**부분 완료.** "게시글 기준 유사 후보 찾기"는 완료(Phase 6~7, 실제 Vercel 배포에서 모델 로딩·추론·pgvector 검색까지 전부 검증됨). 반면 레거시의 또 다른 AI 기능인 **"자유 텍스트 자연어로 반대편 게시판 검색"(`ai/search.py`)은 Next.js에 대응물이 없다** — 백엔드(쿼리 문자열 임베딩 → 검색) 자체가 구현되어 있지 않아 UI 이전에 서비스 레이어부터 필요하다.

### Authorization — 소유권/관리자 검사
**완료.** 레거시의 "UI 게이트는 편의고, 실제 검증은 항상 서버(DB) 레이어에서 다시 한다"는 원칙이 Next.js에서도 그대로 유지되고 있음을 각 서비스 함수에서 확인했다(예: `createMatch`가 `isCurrentlySuspended`를 재확인, `applyReportAction`이 `isAdmin`을 재확인 등). 클라이언트 상태를 신뢰해 권한을 판단하는 코드는 발견되지 않았다.

### Testing — pytest(Streamlit) → Vitest
**전략이 다르다(재설계).** 레거시는 `tests/test_*_ui.py` 다수가 Streamlit `AppTest` 기반 UI 시나리오 테스트로 추정된다(파일명만 확인, 내용은 이번 Phase 범위 밖). Next.js는 서비스/스키마 레벨 유닛 테스트(Vitest, node 환경) 391건으로, 컴포넌트 렌더링이나 E2E 브라우저 테스트는 없다 — 이는 프로젝트의 기존 방침(세션 설정: "no component rendering tests")이며, 실제 배포 검증(Phase 6~7)이 그 공백을 실측으로 메워온 방식이다.

---

## 6. Missing Features (C — 미구현)

1. **게시판 상태 필터** — `listQuerySchema`에 `status` 필드 자체가 없음, `SearchFilterBar`에도 UI 없음.
2. **AI 자연어 의미 검색** — 자유 텍스트 질의 → 반대편 게시판 임베딩 검색. 서비스/API 레벨부터 없음.
3. **게시글 상태 변경 UI** — API(`PATCH .../route.ts` + `updateLostPostSchema`의 `status`)는 이미 지원하지만, 이를 호출하는 버튼/폼이 어디에도 없음.
4. **"내 게시물" 전용 관리 페이지** — 목록에서 "내 글만" 필터도 없고, 내 분실/습득물을 한 화면에서 관리하는 페이지 자체가 없음.
5. **Direct 채팅(작성자에게 바로 문의)** — 매칭 없이 게시글 작성자와 채팅을 시작하는 경로가 코드에 없음(`chat/service.ts`가 매칭 기반 방만 다루도록 구조화되어 있음). §4 매트릭스에는 "게시글 상세의 문의 버튼 없음"과 "채팅 도메인 자체에 direct 방 로직 없음" 두 행으로 나눠 기재했지만, 실제로는 하나의 기능 갭이다.

(알림→채팅방 딥링크는 채팅 자체는 이미 동작하므로 미구현이 아니라 부분 구현으로 분류 — §7 참고.)

## 7. Partial Features (B — 부분 구현)

1. **카테고리(검색 필터/등록 모두)** — 자유 텍스트로 대체되어 있어 값 일관성이 보장되지 않음(레거시는 select 고정 9종).
2. **내 채팅 목록** — 매칭 기반 채팅방만 나오고 direct 채팅방이 없어 항상 부분집합만 보임(6번 항목의 직접적 결과).
3. **홈 대시보드** — 로그인 상태 분기와 안읽음 카운트는 Header로 옮겨져 기능적으로는 유지되지만, 레거시의 "6개 카드 한눈에 보기" 대시보드 자체는 없음.
4. **알림 클릭 이동** — match 타입은 되지만 message 타입은 안 됨(6번과 동일 근거, 별도 행으로 §4에 기재).

## 8. Features Requiring Redesign (D — 재설계 필요)

1. **"내 매칭" 전체 목록 화면** — 레거시는 별도 페이지에서 모든 매칭을 한 번에 보여주지만, Next.js는 이미 게시글 상세의 `MatchPanel`에 (그 게시글에 대한) 매칭 관리 기능을 통합해 넣었다. 레거시 구조를 그대로 복제(별도 "내 매칭" 페이지 추가)하는 것보다는, 기존 `listMatchesForUser()`를 재사용해 **크로스 게시글 요약 페이지**(예: `/matches`)를 Next.js식 정보구조에 맞게 새로 설계하는 편이 일관성이 높다 — `MatchPanel`을 없애고 대체하는 것이 아니라 보완하는 방향.

---

## 9. Recommended Implementation Order

우선순위 판단 기준: (a) 서비스 핵심 기능인가, (b) 다른 기능의 선행 조건인가, (c) 사용자에게 직접 보이는가, (d) 이미 구현된 Auth/DB/Storage/AI와 자연스럽게 연결되는가, (e) 구현 난이도.

**Phase 9 — 게시글 관리 UX 보강 (상태 변경 + 내 게시물 페이지 + 카테고리 고정 목록 + 상태 필터)**
근거: 넷 다 이미 있는 `posts` 도메인 위에 UI/쿼리스키마만 추가하면 되는, 이번 조사에서 발견된 것 중 **난이도가 가장 낮고 사용자 체감이 가장 큰** 항목들이다. 카테고리를 select로 고정하면 §4의 검색 필터 정확도 문제(B)도 같이 해결된다. 다른 어떤 Phase보다 먼저 해도 리스크가 없다(AI/채팅 등 다른 도메인과 무관).

**Phase 10 — Direct 채팅 (매칭 없이 작성자에게 바로 문의)**
근거: `chat/service.ts`의 기존 구조(참가자 판별, 메시지 CRUD, 알림 발송)를 그대로 재사용할 수 있고, `ChatRoom` 스키마도 이미 `directLostPostId`/`directFoundPostId`/`initiatorUserId`를 갖추고 있다(스키마 낭비 상태 해소). "내 채팅 목록"의 B등급 부분 구현도 자동으로 해결된다. 게시글 상세 페이지에 버튼 하나 추가가 핵심이라 UI 난이도도 낮다.

**Phase 11 — 알림→채팅 딥링크 수정 + "내 매칭" 요약 페이지 (§8의 재설계)**
근거: 둘 다 이미 있는 서비스 함수(`getOwnedPostRefForMatch`, `listMatchesForUser`)를 새 화면/로직에 연결하는 수준이라 작다. Phase 10에서 direct 채팅이 생기면 알림 딥링크 로직을 한 번에 정리하는 게 효율적이다.

**Phase 12 — AI 자연어 의미 검색**
근거: 나머지 항목과 달리 **새로운 서비스 레이어**(쿼리 문자열 임베딩 → pgvector 검색)가 필요해 난이도가 가장 높다. 다만 Phase 6~7에서 이미 임베딩 파이프라인과 pgvector 인프라가 실제 배포로 검증되어 있으므로, 새 인프라 도입 리스크는 없고 순수하게 "기존 임베딩 함수에 게시글이 아닌 자유 텍스트를 넣는" 확장 작업이다. 우선순위가 낮은 이유는 필수 기능이라기보다 부가 기능(키워드 검색으로도 서비스는 성립)이기 때문.

**Phase 13 (선택) — Vercel Git 자동배포 연결, Git LFS/모델 배포 장기 전략 재검토**
근거: 기능 갭은 아니지만 Phase 7-B에서 사용자 결정으로 보류된 항목(Vercel Git 연동 배포 검증)과, `docs/AI_MATCHING_ARCHITECTURE.md` §17.9에 남아 있는 운영 리스크(HF Hub 가용성 의존)를 정리할 시점으로 제안.

---

## 10. Risks / Dependencies

- **카테고리 고정 목록 도입(Phase 9) 시 기존 자유 텍스트 데이터와의 정합성**: 이미 자유 텍스트로 등록된 게시글의 category 값이 새 고정 목록에 없는 값일 수 있다 — 마이그레이션 없이 select로 바꾸면 기존 게시글이 필터에서 누락될 수 있으므로, select 옵션에 "기타"를 포함하거나 데이터 정리가 선행되어야 한다.
- **Direct 채팅(Phase 10) 도입 시 스키마 재사용**: `ChatRoom.directLostPostId`/`directFoundPostId`/`initiatorUserId` 컬럼은 이미 존재하지만 지금까지 한 번도 쓰인 적이 없다 — 실제 채팅방 생성 로직을 붙이기 전에 `@@unique([directLostPostId, initiatorUserId])` 등 기존 제약조건이 의도대로 동작하는지 실제 DB로 검증 필요(Prisma 스키마 코멘트에 이미 관련 설명이 있음).
- **AI 자연어 검색(Phase 12)**: 매 검색 요청마다 실시간 임베딩 추론이 발생 — Phase 6~7에서 측정한 warm 추론 지연(~20-75ms)은 낮지만, 검색은 게시글 저장보다 훨씬 빈번한 요청일 수 있어 실제 트래픽 하에서 콜드 인스턴스 비율을 관찰할 필요가 있다(§ AI_MATCHING_ARCHITECTURE.md §17.9의 기존 리스크와 연결됨).
- **알림→채팅 딥링크(Phase 11)**: `resolveHref()` 수정 자체는 작지만, 관련 채팅방이 이미 삭제된 경우(매칭 취소 등으로 CASCADE 삭제) 알림은 남아있는데 링크만 죽은 상태가 될 수 있다 — 레거시도 동일한 경합을 "관련 메시지를 찾을 수 없습니다" 안내로 처리하므로 동일한 패턴을 따르면 된다.
- **테스트 전략의 구조적 차이**: Next.js는 UI/E2E 자동 테스트가 없으므로, 위 Phase들에서 새 UI를 추가할 때마다 실제 브라우저 확인이 각 Phase의 필수 검증 단계로 남는다(이 프로젝트의 기존 관행).

---

## 11. Phase 8 Conclusion

레거시 Streamlit 서비스와 현재 Next.js 구현을 실제 코드 기준으로 전수 비교한 결과, **핵심 도메인(인증/게시글/이미지/AI 매칭 백엔드/채팅 기반 구조/신고·관리자/알림)은 이미 상당히 완성되어 있고, 남은 갭은 대부분 "이미 있는 서비스에 UI만 연결"하거나 "누락된 필터 하나 추가"하는 수준의 작업**이다. 진짜 새로운 설계가 필요한 것은 AI 자연어 검색(신규 서비스 레이어)과 "내 매칭" 요약 화면(정보구조 재설계) 정도다.

이 결과에 따라 Phase 9부터는 난이도 낮고 사용자 체감 높은 게시글 관리 UX부터 시작해, direct 채팅 → 알림 연결 정리 → AI 검색 순으로 진행할 것을 권장한다.
