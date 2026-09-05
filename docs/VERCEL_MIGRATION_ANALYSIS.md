# Vercel(Next.js) 마이그레이션 분석 및 설계 (Phase 0)

> 작성 기준: `main` 브랜치 (커밋 `e113c46`, 2026-09-05 기준 clone).
> 이 문서는 **분석/설계 문서**이며, `main`의 Streamlit 코드는 이번 Phase에서 전혀 수정하지 않았다.
> `vercel` 브랜치는 존재를 확인만 했고(§0), 폐기 대상으로 간주하여 설계에 재사용하지 않았다.
> 추측이 필요한 부분은 본문에 **[추측]** 으로 명시했고, 그 외 서술은 실제 코드(`db/database.py`, `ui/*.py`, `pages/*.py`, `ai/*.py`)를 근거로 한다.

---

## 0. 저장소/브랜치 상태

- 원격: `https://github.com/oyueo-mm/mju-lost-found`
- 로컬 clone 직후 `HEAD == main == origin/main`, working tree clean.
- 원격 브랜치: `main`, `vercel`, `deploy`, `hostinger`.
- `main` 최근 커밋 (최신순): `e113c46` Update README, `13908cc` 이미지 미리보기/새탭 상세보기, `a6226f2` AI 검색 결과 게시판 구분, `9e5ff57` 찾았어요→직접채팅, `e8fedab` direct chat 통합, `a2e1c09`~`0e33a0d`~`3a98012` 초기 구현.
- `git diff main origin/vercel --stat` 결과: **vercel 브랜치는 이미 상당량의 Next.js/Prisma/TypeScript 구현(208개 파일, +21,602/-14,771)을 갖고 있다** — `src/lib/{auth,chat,posts,match,moderation,notification,report,images}`, Prisma(`src/lib/db/prisma.ts`), NextAuth 타입, Vitest 테스트 등. 지시에 따라 이 구현은 신뢰하지 않고 재사용하지 않았으며, 참고용으로 "무엇이 이미 시도됐었는지"만 인지했다.
- `main`의 working tree에는 커밋되지 않은 변경사항 없음.

## 1. `main` 전체 구조 분석

```
app.py                  # Streamlit 진입점, 홈 대시보드
db/
  database.py (2410줄)  # 전체 데이터 접근 계층 + 마이그레이션 + 권한/검증 로직
  schema.sql             # SQLite DDL (CREATE TABLE IF NOT EXISTS만 포함, 최신 컬럼 일부는 마이그레이션 함수가 추가)
ai/
  embedding.py           # sentence-transformers 래퍼 (지연 로딩, 에러 격리)
  matching.py            # 코사인 유사도 기반 랭킹
  search.py              # 자연어 자유텍스트 검색 (matching.py 재사용)
ui/
  auth.py                # Streamlit 네이티브 OIDC 로그인 래퍼 + 페이지 게이트
  common.py              # 이미지 업로드/썸네일, AI 매칭 UI, 신고 UI 등 재사용 컴포넌트
pages/
  1_찾아요.py            # 분실물 게시판 (목록/검색/AI검색/상세/등록)
  2_찾았어요.py          # 습득물 게시판 (1_찾아요.py의 미러)
  3_내_게시물.py         # 내 게시물 CRUD(수정/삭제/상태변경)
  4_내_매칭.py           # 확정된 Match 목록, 채팅 진입, 매칭 취소
  5_채팅.py              # 1:1 채팅 (Match 기반 + Direct 기반 모두 처리)
  6_내_채팅.py           # 채팅방 목록
  7_관리자.py            # 신고 처리 + 제재(Moderation)
  8_알림.py              # 알림 목록/읽음 처리
tests/ (24개 파일, 9457줄) # UI 통합 테스트 + database.py 단위 테스트(test_database.py만 4028줄)
uploads/                 # 로컬 파일시스템 이미지 저장 디렉터리
requirements.txt         # streamlit, Authlib, httpx, sentence-transformers, numpy
.streamlit/              # config.toml(업로드 크기 제한), secrets.toml.example(OIDC 설정 템플릿)
```

**역할 요약**
- **진입점**: `app.py` — 인증 상태에 따라 4단계 분기(미설정/미로그인/도메인불일치/닉네임미설정/정상)로 홈 화면을 렌더링하고, 관리자에게만 관리자 링크를 노출.
- **페이지 구조**: Streamlit의 파일 기반 멀티페이지(`pages/N_이름.py`) — 사이드바에 자동 등록. 페이지 간 이동은 `st.switch_page` + `st.session_state`로 파라미터 전달(예: 매칭 목록에서 채팅방 클릭 시 `st.session_state["chat_room_id"]` 설정 후 `pages/5_채팅.py`로 전환).
- **DB**: `db/database.py` 하나에 모든 CRUD/권한검사/알림생성/마이그레이션이 응집. `sqlite3.Row` 기반, 커넥션은 `get_connection()` 컨텍스트 매니저로 매 호출마다 새로 열고 닫음(연결 풀 없음).
- **인증**: Streamlit 1.62+ 네이티브 `st.login()/st.user/st.logout()` (Authlib 기반 OIDC), Google 전용, `@mju.ac.kr` 도메인 화이트리스트를 애플리케이션 코드에서 검사.
- **AI**: `sentence-transformers`(`jhgan/ko-sroberta-multitask`, 768차원 한국어 모델)로 텍스트 임베딩 생성 → 코사인 유사도로 브루트포스 랭킹. 이미지 임베딩/멀티모달은 PRD상 "향후" 항목이며 **실제 코드에는 없음**.
- **파일 업로드**: `ui/common.py`의 `save_uploaded_image()` — 로컬 `uploads/` 디렉터리에 UUID 파일명으로 저장, 서버 사이드 확장자 화이트리스트 재검증.
- **사용자 권한**: `db.database.py` 전역에 걸쳐 "요청자 ID 재검증" 패턴 — 게시물 소유자, 채팅 참여자, 관리자 여부를 매 함수 호출마다 DB에서 다시 조회(세션 상태를 신뢰하지 않음).
- **관리자 기능**: 신고 목록 조회/필터/페이지네이션, 신고 처리(반려/조치완료), 실제 제재 적용(게시물 삭제/메시지 숨김/사용자 정지) — `Report`+`ModerationAction` 2단계 구조.
- **테스트**: pytest 기반, UI 레벨(Streamlit `AppTest` 추정 [추측: 실제 프레임워크명은 파일 미열람] 또는 함수 직접 호출)과 DB 레벨(`test_database.py`, 4028줄 — 사실상 스펙 문서에 가까움) 모두 존재. Next.js 마이그레이션 시 이 테스트들이 "재현해야 할 동작 명세" 역할을 한다.
- **환경변수/secrets**: `.streamlit/secrets.toml`(gitignore됨) — Google OAuth `client_id`/`client_secret`/`cookie_secret`/`redirect_uri`. 별도 `.env` 없음(Streamlit 고유 secrets 방식).
- **외부 서비스 의존성**: Google OAuth(OIDC), Hugging Face Hub(임베딩 모델 최초 다운로드, ~440MB). DB/스토리지는 모두 로컬 파일(SQLite 파일 + `uploads/` 디렉터리) — 외부 클라우드 서비스 없음.
- **requirements.txt 핵심 패키지**: `streamlit>=1.62`(네이티브 auth 필요 최소 버전), `Authlib`(OIDC 클라이언트), `httpx`, `sentence-transformers`+`numpy`(텍스트 임베딩).

## 2. 사용자 기능 목록 (실제 코드 근거)

### 인증
1. **Google 로그인/로그아웃** — `app.py`, `ui/auth.py` `render_sidebar_auth()`. `st.login()`/`st.logout()` 호출, Authlib 경유 OIDC.
2. **도메인 제한** — `is_allowed_domain()`(`ui/auth.py:17-18`): `@mju.ac.kr`이 아니면 로그인은 됐어도 서비스 이용 불가, 로그아웃 버튼만 노출.
3. **최초 로그인 시 User 행 자동 생성** — `resolve_user_id()`→`db.create_user()`.
4. 권한 검사: 매 페이지가 `auth.require_ready_user()`(로그인+닉네임) 또는 `auth.require_admin()`(+is_admin) 호출.

### 사용자 프로필
5. **닉네임 최초 설정(1회, 변경 불가)** — `render_nickname_setup_notice()` + `db.set_initial_nickname()`(`db/database.py:528-563`). 2~20자, 한글/영문/숫자만(화이트리스트 정규식), UNIQUE 제약. **DB 레이어**: `UPDATE ... WHERE nickname IS NULL`로 원자적 "최초 1회"를 보장 — check-then-set 레이스 없음.
6. 실명/이메일은 내부 인증용으로만 저장, 어디에도 공개 표시되지 않음(닉네임만 공개).

### 분실물(찾아요) / 습득물(찾았어요) 게시판
7. **키워드 검색** — `db.search_lost_posts/search_found_posts`: 제목/설명 `LIKE`, 카테고리/상태 필터.
8. **AI 의미 검색(자연어)** — `pages/1_찾아요.py`의 "AI 의미 검색" 모드: 자유 텍스트 → `ai.search.search_similar_posts()` → **반대편 게시판**(찾아요 화면에서는 찾았어요 게시물)을 대상으로 임베딩 유사도 랭킹, top_k=10.
9. **게시물 상세보기** — 사진/제목/카테고리/장소/시간/상태/작성자(닉네임)/작성일. "새 탭에서 보기" 링크는 `?lost_id=` 쿼리 파라미터로 세션 없는 새 탭에서도 복원 가능.
10. **게시물 등록** — 제목/설명/카테고리(9종 고정)/장소/날짜+시간/이미지(선택). 클라이언트 검증 + 서버 측 재검증(`db.create_lost_post`).
11. **AI 자동 매칭 후보 조회** — 상세 페이지의 "AI로 유사한 OO 찾기" 버튼 → `ai.matching.find_similar_found_posts/find_similar_lost_posts` (top_k=5, 클릭 시점에 전체 후보 재조회 후 브루트포스 랭킹).
12. **매칭 확정("내 물건 같아요")** — AI 후보 카드에서 클릭 → `db.create_match()`. 요청자가 LostPost 또는 FoundPost 둘 중 하나를 소유해야 함, get-or-create(중복 방지, UNIQUE 제약 백업).
13. **작성자에게 직접 채팅 시작** — AI 매칭을 거치지 않고 게시물 상세에서 바로 채팅 시작(`db.get_or_create_direct_chat_room`) — Match 테이블에 기록 없음.
14. **게시물 신고** — 상세 페이지에서 `render_report_control("post", post_id)`.

### 검색/필터 (요약, 위 7-8과 동일 근거)
15. 카테고리 필터(9종: 전자기기/필기구/책/지갑/카드/의류/가방/액세서리/기타), 상태 필터.

### 내 게시물
16. **본인 게시물 목록**(찾아요/찾았어요 각각 탭) — `list_lost_posts_by_user`/`list_found_posts_by_user`.
17. **상태 변경** — 찾아요: "찾는 중"→"찾음", 찾았어요: "보관 중"→"완료" (단방향, 되돌리기 UI 없음).
18. **수정** — 제목/설명/카테고리/장소/이미지 교체 가능. **분실/습득 일시는 수정 불가**("삭제 후 재등록" 안내, `pages/3_내_게시물.py:32`).
19. **삭제** — 확인(2단계 버튼) 후 삭제. `ON DELETE CASCADE`로 연관 Match/ChatRoom/Message까지 연쇄 삭제.

### AI 매칭 (내 매칭 페이지)
20. **확정된 매칭 목록** — `db.list_matches_by_user()`: 내가 LostPost 또는 FoundPost 소유자인 모든 Match, 안읽은 메시지 수 포함.
21. **매칭 취소** — `db.delete_match()`, LostPost/FoundPost 상태 자체는 건드리지 않음(Match 행만 삭제).
22. **상대 게시물로 이동, 채팅 시작, 상대방 신고**.

### 채팅
23. **1:1 채팅** — 두 가지 방(room) 유형을 하나의 `ChatRoom` 테이블/UI로 통합 처리:
    - **Match 기반**: AI 매칭 확정 후에만 생성, `match_id` 소유.
    - **Direct(작성자 DM)**: 게시물 상세에서 바로 시작, `direct_lost_post_id`/`direct_found_post_id`+`initiator_user_id` 소유, Match 불필요.
24. **메시지 전송/조회**, **읽음 처리**(상대가 보낸 메시지만, 방 진입 시 자동), **커서 기반 페이지네이션**("이전 메시지 불러오기", `before_id` < 방식, `OFFSET` 아님 — 페이지 경계가 동시 신규 메시지에 흔들리지 않음).
25. **메시지 신고**.
26. **내 채팅 목록** — Match/Direct 두 종류를 병합 정렬(마지막 메시지 최신순, 메시지 없는 방은 생성일 최신순)해서 하나의 리스트로 표시.

### 알림
27. **알림 목록/페이지네이션**(20개/페이지), **읽지 않은 개수 배지**, **개별/전체 읽음 처리**.
28. **알림 타입 6종**: `message`(새 메시지), `match`(새 매칭), `report_processed`(신고 처리 결과), `post_deleted`/`message_hidden`/`user_suspended`(제재 통지).
29. **클릭 시 관련 화면으로 라우팅** — message/match만 해당 화면으로 이동, 나머지는 읽음 처리만.
30. 알림은 이벤트(메시지 전송/매칭 확정/신고 처리/제재)가 발생한 **동일 트랜잭션 내**에서만 생성(`_insert_notification`, 별도 폴링/크론 없음).

### 신고
31. **대상 3종**: 게시물(post, 부호로 Lost/Found 구분 — 양수=LostPost id, 음수=-(FoundPost id)), 메시지(message), 사용자(user).
32. **자기 자신 신고 금지**, **중복 신고 금지**(reporter+target 조합 UNIQUE), 사유 필수/상세 선택.

### 관리자
33. **신고 목록**(상태/유형 필터, 페이지네이션, N+1 회피 위한 배치 조회) — `db.is_admin()`으로 매번 DB 재확인, UI에서 숨기는 것은 보안 경계가 아님이 주석으로 명시.
34. **신고 처리** — "반려"(`process_report`, 실제 제재 없음) 또는 "조치 완료"(`apply_report_action`, 실제 제재까지 원자적으로 실행).
35. **제재 3종**(대상 타입과 1:1 고정 매핑): 게시물 삭제(`delete_post`)/메시지 숨김(`hide_message`, 내용은 물리삭제하지 않고 플레이스홀더로 마스킹)/사용자 정지(`suspend_user`, 기간제 또는 영구).
36. **처리 후 잠금** — 한 번 처리된 신고는 재처리 불가(원자적 `WHERE status='pending'` 가드), `ModerationAction`은 `UNIQUE(report_id)`로 신고당 정확히 1건.

### 기타
37. **정지된 계정 제약** — `_require_not_suspended()`: 신규 게시물 작성/매칭 확정/메시지 전송만 차단, 기존 데이터 열람과 알림 확인은 허용.
38. **이미지 미리보기(썸네일)** — 목록 카드에서 예외를 삼켜(swallow) 개별 이미지 오류가 전체 목록 렌더링을 막지 않게 함.

각 기능의 "필요 DB 데이터/권한 검사/외부 의존성"은 위 서술에 이미 포함(모든 쓰기 오퍼레이션이 `db/database.py` 함수 하나에 소유권/정지여부/관리자여부 검사를 내장).

## 3. DB 구조 심층 분석

### 3.1 실제 스키마 (schema.sql + 마이그레이션 함수 반영본)

`schema.sql`은 **신규 DB 기준 스키마**만 담고, 기존 DB에 컬럼을 추가하는 로직은 전부 `database.py`의 `_migrate_*()` 함수들에 있다. 즉 **schema.sql만 보면 실제 운영 스키마를 오판한다** — 예: `Report.status`/`processed_at`/`ModerationAction` 관련 컬럼, `ChatRoom.direct_*` 컬럼, `User.nickname`/`is_admin`/`is_suspended`는 모두 `CREATE TABLE IF NOT EXISTS` 본문에 있거나(신규 DB) 마이그레이션이 별도로 추가(기존 DB) — 두 경로가 동일한 최종 스키마로 수렴하도록 설계되어 있다.

| 테이블 | PK | FK | UNIQUE | NOT NULL | DEFAULT | CHECK | 비고 |
|---|---|---|---|---|---|---|---|
| **User** | id | - | email, nickname(부분 마이그레이션으로 추가) | email, name, is_admin, is_suspended | is_admin=0, is_suspended=0, created_at=now | is_admin∈{0,1}, is_suspended∈{0,1} | nickname은 NULL 허용(미설정 상태 의미), suspended_until은 NULL=미정지 또는 영구정지 판별용 |
| **LostPost** | id | user_id→User | - | user_id,title,description,category,location,lost_at,status | status='찾는 중', created_at/updated_at=now | status∈{'찾는 중','찾음'} | category는 CHECK 없음(애플리케이션 상수 `CATEGORIES` 9종만 UI가 강제, DB는 자유 텍스트) |
| **FoundPost** | id | user_id→User | - | 동일 구조 | status='보관 중' | status∈{'보관 중','완료'} | 위와 동일 패턴 |
| **Match** | id | lost_post_id→LostPost(CASCADE), found_post_id→FoundPost(CASCADE) | (lost_post_id, found_post_id) | 3필드+score | created_at=now | - | score는 CHECK 없음(코사인 유사도, 이론상 -1~1) |
| **ChatRoom** | id | match_id→Match(CASCADE, nullable), direct_lost_post_id→LostPost(CASCADE), direct_found_post_id→FoundPost(CASCADE), initiator_user_id→User | match_id(UNIQUE), (direct_lost_post_id, initiator_user_id) 부분 UNIQUE, (direct_found_post_id, initiator_user_id) 부분 UNIQUE | - | created_at=now | 없음(2가지 "모양"을 애플리케이션 코드가 상호배타적으로 관리, DB는 강제하지 않음 — 주석에 명시된 의도적 설계) | Match 기반 vs Direct 두 가지 row shape가 한 테이블에 공존 |
| **Message** | id | chat_room_id→ChatRoom(CASCADE), sender_user_id→User, hidden_by_user_id→User | - | chat_room_id,sender_user_id,content | created_at=now | - | read_at/hidden_at/hidden_by_user_id/hidden_reason은 모두 nullable(마이그레이션으로 추가된 컬럼) |
| **Report** | id | reporter_user_id→User, processed_by_user_id→User | (reporter_user_id, target_type, target_id) | reporter_user_id,target_type,target_id,reason,status | status='pending' | target_type∈{post,message,user}, status∈{pending,dismissed,actioned} | target_id는 FK 없음(post/message/user 테이블을 아우르는 폴리모픽 참조라 불가능) — 대상 삭제 후에도 신고 기록은 남음 |
| **ModerationAction** | id | report_id→Report(UNIQUE), admin_user_id→User | report_id(UNIQUE) | report_id,target_type,target_id,action_type,admin_user_id | created_at=now | target_type 동일 3종, action_type∈{delete_post,hide_message,suspend_user} | 신고 1건당 조치 정확히 1건 |
| **Notification** | id | user_id→User | (user_id, type, related_type, related_id) | user_id,type,title,content,is_read | is_read=0, created_at=now | type∈6종(§2.29), is_read∈{0,1} | related_type/related_id는 둘 다 NULL이거나 둘 다 값이 있어야 함(애플리케이션 레벨 검증, DB CHECK 아님) |

**인덱스**: `idx_lostpost_user_id`, `idx_foundpost_user_id`, `idx_match_lost_post_id`, `idx_match_found_post_id`, `idx_message_chat_room_id`, `idx_message_chat_room_created_id`(복합, 커서 페이지네이션 지원), `idx_report_reporter_user_id`, `idx_notification_user_read_created`(복합), `idx_user_nickname`, `idx_report_status`, `idx_chatroom_direct_lost_unique`/`idx_chatroom_direct_found_unique`(부분 UNIQUE 인덱스).

**ON DELETE 동작**: Match/ChatRoom(via match_id, direct_*)은 게시물 삭제 시 CASCADE. User 삭제 경로는 코드상 없음(회원 탈퇴 기능 자체가 없음). Message는 ChatRoom CASCADE에 종속.

**Enum에 해당하는 값(애플리케이션 상수, DB CHECK와 병행)**:
- `LOST_STATUSES = {"찾는 중","찾음"}`, `FOUND_STATUSES = {"보관 중","완료"}` (database.py 상수, schema.sql CHECK와 이중 관리)
- `CATEGORIES`(9종, `ui/common.py`) — **DB 레벨 제약 없음**, UI 상수만 강제. Prisma 이전 시 enum으로 승격할지, 자유 텍스트 유지할지 결정 필요.
- `REPORT_REASONS`(6종, `ui/common.py`) — 마찬가지로 DB 제약 없음(Report.reason은 TEXT).

### 3.2 실제 코드와 스키마의 괴리(주목할 부분)

1. **schema.sql만으로는 불완전** — 위에서 언급한 대로, `status`/`processed_at`/`processed_by_user_id`/`admin_note`(Report), `direct_lost_post_id`/`direct_found_post_id`/`initiator_user_id`(ChatRoom), `read_at`(Message), `hidden_at`/`hidden_by_user_id`/`hidden_reason`(Message), `nickname`/`is_admin`/`is_suspended`/`suspended_until`(User)는 **`_migrate_*()` 함수가 실제 컬럼 추가를 담당**. Prisma 마이그레이션 설계 시 "최종 수렴 상태"를 기준으로 삼아야 하며, `schema.sql` 원본 그대로 옮기면 불완전하다.
2. **Report.target_id의 부호 인코딩** — `target_type="post"`일 때 `target_id`가 양수면 LostPost, 음수면 `-target_id`가 FoundPost id (`_validate_report_target`, `database.py:1614-1655`). LostPost/FoundPost가 **독립된 AUTOINCREMENT 시퀀스**라 id 충돌이 흔하기 때문에 나온 우회책. PostgreSQL/Prisma로 옮길 때 이 인코딩을 그대로 유지할지, `target_post_type`을 별도 컬럼으로 분리해 정규화할지는 **설계 결정이 필요한 지점**(§12 위험요소에 재기재).
3. **ChatRoom의 두 가지 row shape** — Match 기반과 Direct 기반이 CHECK 제약 없이 애플리케이션 코드로만 상호배타 관리됨(주석에 명시된 의도적 설계, `schema.sql:53-61`). Prisma에서는 discriminated union을 강제할 CHECK 제약을 추가하거나, 두 종류를 별 테이블로 정규화하는 옵션을 검토할 수 있다.
4. **category/reason은 자유 텍스트** — DB에는 CHECK가 없고 UI 상수(`CATEGORIES`, `REPORT_REASONS`)만 강제. 과거 데이터에 다른 값이 남아있을 가능성은 낮지만(신규 서비스), enum 승격 시 기존 값과의 정합성 확인 필요.
5. **알림의 멱등성** — `Notification`의 `UNIQUE(user_id, type, related_type, related_id)`가 "같은 이벤트에 대한 중복 알림 방지"를 DB 레벨에서 보장. Prisma 스키마에서도 동일한 복합 unique가 필요.
6. **정지 판정은 read-time 계산** — `is_user_suspended()`가 만료된 기간제 정지를 "정지 아님"으로 판단하되 DB에 auto-clear 하지 않음(`is_suspended`/`suspended_until` 컬럼 값은 그대로 남음, 감사 목적). Prisma/PostgreSQL로 옮겨도 이 read-time 계산 로직(쿼리 또는 애플리케이션 코드)을 그대로 유지해야 함.

### 3.3 Prisma 모델 구조 제안 (설계 수준, 미구현)

```prisma
// 설계 스케치 — 실제 schema.prisma는 이번 Phase에서 작성하지 않음
enum PostStatusLost { FINDING FOUND }        // '찾는 중'/'찾음' 매핑 방식은 별도 결정 필요(한글 값 유지 vs enum 라벨링)
enum PostStatusFound { KEEPING DONE }        // '보관 중'/'완료'
enum ReportTargetType { POST MESSAGE USER }
enum ReportStatus { PENDING DISMISSED ACTIONED }
enum ModerationActionType { DELETE_POST HIDE_MESSAGE SUSPEND_USER }
enum NotificationType { MESSAGE MATCH REPORT_PROCESSED POST_DELETED MESSAGE_HIDDEN USER_SUSPENDED }

model User {
  id              Int       @id @default(autoincrement())
  email           String    @unique
  name            String
  nickname        String?   @unique
  isAdmin         Boolean   @default(false)
  isSuspended     Boolean   @default(false)
  suspendedUntil  DateTime?
  createdAt       DateTime  @default(now())
  lostPosts       LostPost[]
  foundPosts      FoundPost[]
  // ... 역참조 다수 (messages, reports, notifications 등)
}

model LostPost { /* User와 동일 필드 구조 + status enum + ON DELETE CASCADE 대상 매치 */ }
model FoundPost { /* 위와 대칭 */ }

model Match {
  id           Int      @id @default(autoincrement())
  lostPostId   Int
  foundPostId  Int
  score        Float
  createdAt    DateTime @default(now())
  lostPost     LostPost  @relation(fields: [lostPostId], references: [id], onDelete: Cascade)
  foundPost    FoundPost @relation(fields: [foundPostId], references: [id], onDelete: Cascade)
  chatRoom     ChatRoom?
  @@unique([lostPostId, foundPostId])
}

model ChatRoom {
  id                 Int      @id @default(autoincrement())
  matchId            Int?     @unique
  directLostPostId   Int?
  directFoundPostId  Int?
  initiatorUserId    Int?
  createdAt          DateTime @default(now())
  // 부분 UNIQUE(direct_*, initiator_user_id)는 Prisma가 직접 지원하지 않으므로
  // @@unique + nullable 조합의 한계 검토 필요 -- 미해결 사항(§14)으로 별도 기재
  messages           Message[]
}

model Message {
  id               Int       @id @default(autoincrement())
  chatRoomId       Int
  senderUserId     Int
  content          String
  createdAt        DateTime  @default(now())
  readAt           DateTime?
  hiddenAt         DateTime?
  hiddenByUserId   Int?
  hiddenReason     String?
  chatRoom         ChatRoom  @relation(fields: [chatRoomId], references: [id], onDelete: Cascade)
}

model Report { /* target_id 부호 인코딩 유지 여부가 미해결 사항 -- §12 참고 */ }
model ModerationAction { /* report_id @unique 등 1:1 관계 */ }
model Notification { /* @@unique([userId, type, relatedType, relatedId]) */ }
```

**주의**: 이는 설계 스케치이며 실제 `schema.prisma` 파일은 Phase 2에서 작성한다. 특히 다음은 이번 Phase에서 확정하지 않는다: (a) 한글 status 값을 그대로 저장할지 enum 라벨로 정규화할지, (b) `Report.target_id` 부호 인코딩을 유지할지 정규화할지, (c) `ChatRoom`의 부분 UNIQUE 인덱스를 Prisma/PostgreSQL에서 어떻게 표현할지(PostgreSQL은 partial unique index를 지원하므로 raw SQL migration으로 추가 가능 — Prisma `@@unique`만으로는 `WHERE ... IS NOT NULL` 조건을 못 담음).

## 4. 인증 및 권한 분석

### 실제 동작 (ui/auth.py, app.py 근거)

- **Google OIDC 흐름**: Streamlit 1.62+ 네이티브 `st.login()`/`st.user`/`st.logout()`(Authlib 기반). `.streamlit/secrets.toml`의 `[auth]` 섹션(`client_id`/`client_secret`/`cookie_secret`/`redirect_uri`/`server_metadata_url`)으로 구성. **커스텀 콜백 핸들러나 세션 저장 로직은 애플리케이션 코드에 없음** — Streamlit 프레임워크가 통째로 담당.
- **허용 이메일 도메인**: `ALLOWED_EMAIL_DOMAIN = "@mju.ac.kr"`(하드코딩 상수, `ui/auth.py:12`), `is_allowed_domain()`이 대소문자 무시하고 접미사 검사.
- **최초 로그인 처리**: `resolve_user_id()` — email로 User 조회, 없으면 `db.create_user(email, name)`으로 즉시 생성(별도 "가입" 단계 없음, 로그인=가입).
- **닉네임 설정**: 로그인+도메인 통과 후 `nickname IS NULL`이면 전 기능이 닉네임 설정 화면으로 막힘(`require_ready_user()`). 설정 후 변경 불가.
- **세션 관리**: Streamlit이 쿠키(`cookie_secret`)로 세션을 유지 — 애플리케이션은 `st.user`만 읽음. **커스텀 세션 스토어/JWT 발급 로직 없음.**
- **로그아웃**: `st.logout()` 콜백.
- **인증되지 않은 사용자 접근**: 각 페이지가 `require_ready_user()`/`require_admin()` 호출 후 `None`이면 즉시 안내 렌더링 + `st.stop()`(호출부 책임) — 게시판 목록조차 로그인 없이는 볼 수 없음(`pages/1_찾아요.py:26-29`: `require_ready_user()`가 `None`이면 목록 렌더링 전에 `st.stop()`).
- **권한 계층**:
  1. **비로그인/도메인불일치**: 아무 기능도 사용 불가, 안내만 표시.
  2. **일반 사용자(닉네임 설정 완료)**: 게시물 CRUD(본인 것만 수정/삭제), 매칭 확정/취소(본인이 소유한 쪽), 채팅(본인이 참여자인 방만), 신고, 알림.
  3. **정지된 사용자**: 열람은 가능하나 신규 게시물/매칭확정/메시지전송 차단(`_require_not_suspended`).
  4. **관리자(`User.is_admin=1`)**: 위 전체 + 신고 처리/제재. **셀프서비스 승급 API 없음** — DB를 직접 `UPDATE`해야 함(운영자 수동 작업, `_migrate_user_table_add_is_admin` docstring에 명시).
- **핵심 보안 패턴(반드시 유지해야 할 규칙)**: 모든 소유권/관리자/정지 여부 검사는 **UI 게이트가 아니라 `db/database.py` 함수 내부에서 매번 DB로부터 재검증**된다. UI의 `require_*()`/버튼 숨김은 "1차 방어선/UX 편의"일 뿐 실제 보안 경계가 아니라는 점이 여러 주석에서 명시적으로 강조됨(`app.py:77-79`, `ui/auth.py:161-171`, `pages/7_관리자.py:12-14`). **Next.js로 옮길 때도 클라이언트/미들웨어 레벨의 라우트 가드만으로 끝내지 말고, 반드시 서버 액션/API 라우트 내부에서 세션의 user id로 매번 소유권·관리자·정지 여부를 재조회해야 한다.**

### 유지해야 할 규칙 요약
| 규칙 | 근거 |
|---|---|
| `@mju.ac.kr` 도메인만 허용 | `ui/auth.py:12,17-18` |
| 로그인=가입(별도 회원가입 없음) | `resolve_user_id` |
| 닉네임은 최초 1회만 설정, 이후 변경 불가 | `set_initial_nickname`의 `WHERE nickname IS NULL` 원자적 가드 |
| 닉네임만 공개 표시, 이메일/실명은 절대 노출 금지 | `ui/common.py`, `database.py` 전역 주석 다수 |
| 모든 쓰기 작업은 서버(API/서버 액션)에서 소유권 재검증 | `_check_lost_post_owner`, `_match_participant_ids` 등 |
| 관리자 여부는 항상 DB 재확인, 세션/클라이언트 클레임 불신 | `is_admin()`, `_require_admin()` |
| 정지 사용자는 열람 가능, 신규 작성만 차단 | `_require_not_suspended` 호출 지점(4곳: create_lost_post, create_found_post, create_match, send_message, get_or_create_direct_chat_room) |

## 5. AI 기능 분석

### 실제 구조
- **모델**: `jhgan/ko-sroberta-multitask`(한국어 특화 STS/NLI 멀티태스크 sentence embedding, 768차원). `ai/embedding.py:21`.
- **로딩 방식**: 지연 로딩(lazy singleton) — 최초 호출 시 `SentenceTransformer(MODEL_NAME)`로 Hugging Face Hub에서 다운로드(최초 1회, ~440MB, `requirements.txt` 주석). 실패 시 `_load_error`에 캐시하고 재시도하지 않음(프로세스 재시작 전까지) — `EmbeddingUnavailableError`로 통일해서 던짐.
- **입력 텍스트 구성**: `build_embedding_text()` — `title + description + category + location`을 공백으로 이어붙인 단일 문자열(`ai/embedding.py:75-90`). 시간(lost_at/found_at)은 임베딩 텍스트에 **포함되지 않음** — PRD의 "시간 유사도" 가중치 개념은 **코드에 구현되어 있지 않다**.
- **similarity 계산**: 코사인 유사도(`ai/matching.py:33-42`), 벡터 노름이 0이면 0.0 반환(방향 미정의 안전 처리).
- **threshold**: **없음.** top_k(매칭 5, 검색 10)만큼 항상 반환하며, 유사도 점수가 아무리 낮아도 잘라내지 않는다(사용자가 점수를 보고 스스로 판단). PRD의 "가중치 합산 매칭 점수(텍스트+이미지+장소+시간+카테고리)"는 **코드상 텍스트 임베딩 코사인 유사도 단일 값**으로만 구현되어 있다 — 장소/시간/이미지 가중치는 미구현.
- **매칭 결과 생성 방식**: 브루트포스 — 매 요청마다 후보 전체(예: 전체 FoundPost)를 DB에서 재조회 → 전부 임베딩 → 정렬 → top_k. **사전 계산/캐싱/벡터 인덱스 없음.**
- **AI 매칭이 실행되는 이벤트**:
  1. 게시물 상세 페이지의 "AI로 유사한 OO 찾기" 버튼 클릭(`render_ai_match_section`, on-demand, 자동 실행 아님).
  2. 찾아요/찾았어요 게시판의 "AI 의미 검색" 모드에서 검색 버튼 클릭.
  - **게시물 등록 시점에 자동으로 매칭이 실행되지 않는다** — PRD의 "게시물 등록 → AI 자동 매칭" 흐름은 **미구현**(사용자가 상세 페이지에서 수동으로 버튼을 눌러야 함).
- **성능 병목**:
  - 모델 최초 로드 시간(다운로드 포함, 네트워크 필요) — 콜드 스타트/서버리스 환경에서 특히 문제.
  - 매 검색/매칭 요청마다 후보 전체 재임베딩(브루트포스) — 게시물 수 증가 시 선형으로 느려짐(PRD §21에서 이미 "게시물 수 증가에도 대응 가능한 구조"를 비기능요구로 명시했으나 현재 구현은 대응하지 않음).
  - `sentence-transformers`는 PyTorch 기반 — 메모리 사용량이 크고 콜드 스타트가 느림.
- **Python 전용 의존성**: `sentence-transformers`(PyTorch 백엔드), `numpy`. 순수 JS/TS로 이식 불가능한 무거운 ML 런타임.

### Vercel + Next.js 이전 시 선택지 (미확정, 검토만)

| 구분 | 내용 |
|---|---|
| **바로 Next.js에서 구현 가능** | 코사인 유사도 계산 자체(`ai/matching.py`의 순수 수치 연산)는 JS/TS로 그대로 이식 가능. top_k 정렬, threshold 없는 랭킹 로직도 동일. |
| **별도 AI inference 서버/API 필요** | 텍스트 임베딩 생성(`sentence-transformers` 모델 추론) 자체는 Vercel Serverless/Edge Function에서 직접 실행하기 어렵다(콜드스타트, 함수 실행시간/메모리 제한, PyTorch 미지원). 검토 가능한 방향(모두 미확정): (a) 호스티드 임베딩 API(OpenAI/Cohere/HuggingFace Inference Endpoints 등, 한국어 성능 별도 검증 필요) 로 교체, (b) 별도 Python 마이크로서비스(예: FastAPI on Fly.io/Render/Cloud Run)를 두고 Next.js가 HTTP로 호출, (c) `Xenova/transformers.js` 등으로 브라우저/Node에서 직접 추론(단, 동일 한국어 모델의 변환판 존재 여부와 정확도는 **검증 필요**). |
| **추가 검증 필요** | (1) `jhgan/ko-sroberta-multitask`와 동등한 임베딩 품질을 내는 상용 API/JS 대안이 있는지, (2) 벡터 저장을 pgvector(Supabase Postgres 확장)로 옮겨 브루트포스 대신 인덱스 검색으로 전환할지(게시물 수 증가 대응), (3) 이미지 기반 검색(PRD §11)은 애초에 미구현이므로 신규 기능으로 별도 스코프 산정 필요. |

**이번 Phase에서는 위 선택지 중 어느 것도 확정하지 않는다.**

## 6. 이미지 및 파일 처리 분석

- **업로드 위치**: 프로젝트 루트의 `uploads/` 디렉터리(로컬 파일시스템), `ui/common.py:11-13`.
- **파일명 생성**: `f"{uuid.uuid4().hex}{suffix}"` — 원본 파일명은 버림(경로 조작 방지).
- **파일 형식 검증**: `st.file_uploader(type=["jpg","jpeg","png"])`는 **클라이언트(브라우저 피커) 제한일 뿐** — 서버 측에서 `Path(name).suffix.lower()`를 `ALLOWED_IMAGE_SUFFIXES = {.jpg,.jpeg,.png}`와 재대조(`save_uploaded_image`, 주석에 "크래프트된 멀티파트 요청 우회 가능성"을 명시하며 실제 강제 지점임을 밝힘). **매직바이트/실제 이미지 디코딩 검증은 없음** — 확장자만 검사.
- **파일 크기 제한**: `.streamlit/config.toml`의 `maxUploadSize = 10`(10MB, 서버 설정 — Streamlit 자체 기본 200MB에서 축소).
- **DB에 저장되는 정보**: `LostPost.image_url`/`FoundPost.image_url` — **프로젝트 루트 기준 상대경로 문자열**(`uploads/xxxx.jpg`) 단 하나만(다중 이미지 미지원, `ui/common.py:50-58` 주석에 명시).
- **파일 삭제 방식**: **없음.** 게시물 삭제/이미지 교체 시에도 기존 파일이 디스크에서 지워지지 않는다(고아 파일 누적 — 마이그레이션 시 점검 필요).
- **이미지 표시 방식**: `resolve_image_path()`가 파일 존재 여부를 확인 후 `st.image(path)`로 로컬 파일을 직접 읽어 렌더링 — Streamlit 프로세스와 파일시스템이 같은 서버라 가능한 방식.
- **보안 관련 처리**: UUID 파일명(경로/이름 추측 방지), 확장자 화이트리스트(서버 재검증), 업로드 크기 제한. **MIME 스니핑/이미지 콘텐츠 검증/바이러스 스캔 없음.**

### Vercel 환경에서 영구 Storage가 필요한 이유
Vercel의 서버리스 함수는 **읽기 전용 파일시스템**(`/tmp`만 쓰기 가능하고 휘발성, 함수 인스턴스 재사용/종료 시 사라짐)이며, 다중 리전/인스턴스 간에도 파일시스템이 공유되지 않는다. 따라서 현재처럼 "로컬 `uploads/` 디렉터리"에 저장하는 방식은 Vercel에서 전혀 동작하지 않으며, 반드시 외부 영구 오브젝트 스토리지가 필요하다.

### Supabase Storage 사용 시 권장 구조 (설계 수준)
- 버킷 분리: `post-images`(공개 읽기, 인증된 쓰기) 등 단일 버킷 + prefix(`lost/`, `found/`)로 충분 — 현재 요구사항이 게시물당 이미지 1장뿐이라 복잡한 버킷 구조는 불필요.
- 파일 경로: `{postType}/{postId}/{uuid}.{ext}` 형태로 소유 게시물을 경로에서 바로 식별 가능하게(현재 UUID만 쓰는 방식보다 운영상 추적 용이).
- 업로드 흐름: 클라이언트 → Next.js 서버 액션/API 라우트(파일 형식 재검증) → Supabase Storage 업로드 → 반환된 public URL(또는 signed URL)을 `image_url` 컬럼에 저장.
- 삭제: 게시물 삭제 시 스토리지 파일도 함께 삭제하는 로직을 **새로 추가**(기존 Streamlit 버전에 없던 기능이지만, 클라우드 스토리지 비용/정리 관점에서 이번 마이그레이션에 포함하는 것을 권장 — 확정은 아님, 사용자 확인 필요).
- 검증 강화 후보(확정 아님): 매직바이트 기반 실제 이미지 검증, 크기 제한을 Supabase 정책 + 애플리케이션 레벨 이중 검사.

## 7. Streamlit → Next.js 매핑 설계

| Streamlit | Next.js (App Router) |
|---|---|
| `pages/1_찾아요.py`(파일 기반 페이지) | `app/lost/page.tsx`(목록/검색), `app/lost/[id]/page.tsx`(상세) — 목록/상세를 라우트로 분리(현재는 한 페이지 내 탭+session_state로 상세를 관리하지만, URL 기반 라우팅이 Next.js의 자연스러운 방식) |
| `pages/2_찾았어요.py` | `app/found/page.tsx`, `app/found/[id]/page.tsx` |
| `pages/3_내_게시물.py` | `app/my-posts/page.tsx` (탭은 클라이언트 컴포넌트로 유지 가능) |
| `pages/4_내_매칭.py` | `app/my-matches/page.tsx` |
| `pages/5_채팅.py` | `app/chat/[roomId]/page.tsx` |
| `pages/6_내_채팅.py` | `app/chat/page.tsx`(목록) |
| `pages/7_관리자.py` | `app/admin/reports/page.tsx` |
| `pages/8_알림.py` | `app/notifications/page.tsx` |
| `st.session_state`(전역 딕셔너리) | 서버 상태는 URL 파라미터/서버 컴포넌트 props로, 클라이언트 전용 UI 상태(모달 열림 등)만 `useState`/URL search params. **"새 탭에서도 복원 가능"해야 하는 상태(선택된 게시물 등)는 애초에 URL 경로/쿼리로 표현** — Streamlit의 `?lost_id=` 우회 패턴이 필요 없어짐(Next.js에서는 라우트 자체가 그 역할) |
| `ui/auth.py`(Streamlit 네이티브 auth) | NextAuth.js(또는 Auth.js) Google Provider + 커스텀 `signIn callback`에서 도메인 검사, 세션 콜백에서 User 테이블 조회/생성 |
| `db/database.py`(2410줄 단일 모듈) | 기능별 서버 전용 모듈로 분해: `lib/posts/service.ts`, `lib/match/service.ts`, `lib/chat/service.ts`, `lib/report/service.ts`, `lib/moderation/service.ts`, `lib/notification/service.ts`, `lib/auth/*` — 각 서비스가 Prisma로 DB 접근 + 기존과 동일한 소유권/권한 재검증 패턴 유지 |
| SQLite(`db/lost_found.db`) | Supabase PostgreSQL |
| `uploads/`(로컬 파일) | Supabase Storage |
| `ai/embedding.py`+`ai/matching.py`+`ai/search.py`(Python, sentence-transformers) | §5에서 검토한 대안 중 확정 필요 — 순수 랭킹/코사인유사도 로직만 우선 TS로 이식, 임베딩 생성부는 별도 결정 |
| `st.form`+`st.button` 등 위젯 | React Hook Form(또는 네이티브 form) + Server Actions |
| `st.spinner` | React `useTransition`/로딩 스켈레톤 |
| 서버 사이드 렌더링(Streamlit은 매 상호작용마다 스크립트 전체 재실행) | Next.js Server Components(초기 데이터) + Server Actions(mutation) — Streamlit의 "매번 소유권 재검증" 패턴은 Server Action 내부에서 그대로 유지 |

단순 파일 1:1 대응이 아니라, **"목록/상세 뷰", "쓰기 오퍼레이션(소유권 검사 포함)", "실시간성이 필요한 채팅/알림"** 세 가지 책임 축으로 재설계하는 것이 핵심이다.

## 8. 권장 프로젝트 아키텍처 (App Router 기준, 설계 수준)

```
app/
  (auth)/
    login/page.tsx
  lost/
    page.tsx                 # 목록 + 키워드/AI 검색
    [id]/page.tsx            # 상세 (+ AI 매칭 후보, 신고, 직접채팅)
    new/page.tsx             # 등록 폼
  found/                     # lost/와 대칭 구조
  my-posts/page.tsx
  my-matches/page.tsx
  chat/
    page.tsx                 # 내 채팅 목록
    [roomId]/page.tsx
  notifications/page.tsx
  admin/
    reports/page.tsx
  api/                       # 웹훅/외부 콜백 등 Server Action으로 못 푸는 경우만
actions/                     # "use server" 서버 액션 (쓰기 오퍼레이션의 진입점)
  posts.ts  match.ts  chat.ts  report.ts  moderation.ts  notification.ts
lib/
  auth/                      # NextAuth 설정, 세션 헬퍼, 도메인 검사, requireUser()/requireAdmin()
  posts/service.ts           # database.py의 LostPost/FoundPost 섹션에 대응
  match/service.ts
  chat/service.ts
  report/service.ts
  moderation/service.ts
  notification/service.ts
  ai/                        # 임베딩/매칭 랭킹 (§5 선택지 확정 후 구현)
  storage/                   # Supabase Storage 업로드/삭제 래퍼
  db/prisma.ts               # PrismaClient 싱글턴
components/
  posts/  match/  chat/  admin/  ui/(공용 버튼/카드 등)
prisma/
  schema.prisma
  migrations/
types/
  (도메인 타입, next-auth.d.ts 등)
```

- `actions/`(서버 액션)가 기존 `db/database.py`의 "쓰기 함수 + 권한검사"에 대응하는 **진짜 보안 경계**이며, `lib/*/service.ts`는 그 안에서 호출되는 재사용 가능한 순수 로직.
- 채팅/알림처럼 "실시간성"이 요구되는 영역은 폴링(짧은 간격 재조회) vs Supabase Realtime 구독 여부를 Phase 8에서 별도 결정(이번 Phase에서 미확정).

## 9. 기술 스택 확정 후보

| 기술 | 채택 이유 | 대안 검토 필요 여부 |
|---|---|---|
| Next.js (App Router) | Vercel 배포 최적화, 서버 컴포넌트로 초기 로딩 성능 확보, 기존 페이지 기반 구조를 라우트로 자연 대응 | 낮음 — Vercel 대상이 이미 확정된 요구사항 |
| TypeScript | 2410줄 규모의 DB 접근 계층을 옮기며 타입 안정성 필요(Prisma와 궁합) | 낮음 |
| React | Next.js 기본 | 낮음 |
| Tailwind CSS | 빠른 스타일링, 컴포넌트 재사용 용이 | 낮음(단, 디자인 시스템 요구사항이 별도로 있다면 재검토) |
| Prisma | 타입 안전 쿼리, 마이그레이션 관리, PostgreSQL과 궁합 | 낮음 |
| Supabase PostgreSQL | Vercel Postgres 대비 무료 티어/pgvector 확장(향후 AI 검색 성능 개선 시 유용) 등 장점, 사용자가 이미 Phase 로드맵에서 지정 | **중간** — Vercel Postgres, Neon 등도 후보가 될 수 있음(이번 Phase에서 확정하지 않음, Phase 2에서 실제 프로비저닝 시 재확인 권장) |
| Supabase Storage | Postgres와 동일 프로젝트에서 관리 편의성 | 낮음 |
| Google OAuth | 기존 서비스와 동일 IdP 유지가 사용자 경험/도메인 정책 연속성에 중요 | **높음 — 성급히 확정 금지.** Streamlit 네이티브 auth(Authlib)와 NextAuth.js/Auth.js의 Google Provider는 내부 구현이 다르므로, `@mju.ac.kr` 도메인 검사와 "로그인=가입" 흐름을 어느 레이어(콜백 vs 미들웨어 vs 서버 액션)에서 재구현할지 Phase 3에서 별도로 설계 필요 |
| Vercel | 요구사항으로 이미 확정 | - |
| **AI 임베딩 실행 방식** | 미확정 | **높음 — §5, §12 참고. 이번 Phase에서 절대 확정하지 않음** |

## 10. 마이그레이션 로드맵 (제안)

- **Phase 0**: 분석/설계 (본 문서) — 완료.
- **Phase 1**: Next.js 프로젝트 초기화, 기본 디렉터리 구조(§8), ESLint/Prettier, CI 골격.
- **Phase 2**: Supabase 프로젝트 생성, Prisma 스키마 확정(§3.3 스케치 → 실제 `schema.prisma`), 초기 마이그레이션.
- **Phase 3**: 인증(Google OAuth + `@mju.ac.kr` 도메인 검사 + 닉네임 최초설정 플로우) — §4의 "유지해야 할 규칙" 전부 재현.
- **Phase 4**: 핵심 게시물 기능(찾아요/찾았어요 CRUD, 키워드 검색, 상태관리, 내 게시물).
- **Phase 5**: 이미지 Storage(Supabase Storage 연동, 업로드/표시/삭제).
- **Phase 6**: AI 텍스트 매칭/검색(§5 선택지 확정 후 구현 — 자연어 검색 + 게시물 상세의 AI 후보 + 매칭 확정).
- **Phase 7**: 매칭 목록("내 매칭") + 채팅(Match 기반 + Direct 기반), 읽음 처리, 페이지네이션.
- **Phase 8**: 알림(이벤트 연동 트랜잭션 처리), 신고, 관리자(신고 처리/제재).
- **Phase 9**: 통합 테스트(기존 pytest 테스트 스위트를 "동작 명세"로 삼아 Vitest/Playwright 등으로 재현).
- **Phase 10**: 기존 데이터 마이그레이션 리허설(SQLite → PostgreSQL, §12 참고) — 실제 운영 데이터가 있다면.
- **Phase 11**: Vercel Preview 배포, 환경변수/시크릿 구성.
- **Phase 12**: Production 배포.

실제 진행하며 Phase 6(AI)이 §5의 선택지 확정 여부에 따라 더 세분화되거나 뒤로 밀릴 수 있음.

## 11. 위험 요소 및 미해결 문제

| # | 문제 | 영향 | 현재 판단 | 해결 방향 | 추가 검증 필요 |
|---|---|---|---|---|---|
| 1 | SQLite→PostgreSQL 타입 차이(TEXT 날짜, INTEGER 불리언, AUTOINCREMENT→SERIAL/IDENTITY) | 마이그레이션 스크립트/Prisma 타입 매핑 오류 가능성 | Prisma가 대부분 흡수하나 날짜 포맷(`YYYY-MM-DD HH:MM` 문자열 vs `DateTime`)은 명시적 변환 필요 | Prisma `DateTime` 타입으로 정규화, 마이그레이션 시 문자열 파싱 | 예 |
| 2 | FK/Cascade 구조(ChatRoom의 3-way nullable FK, 부분 UNIQUE 인덱스) | PostgreSQL/Prisma로 그대로 표현 어려움(§3.3) | 표준 Prisma로는 부분 unique index 미지원, raw migration 필요 | Prisma migration에 raw SQL 추가(`CREATE UNIQUE INDEX ... WHERE ...`) | 예 |
| 3 | 인증 방식 전면 교체(Streamlit 네이티브 auth → NextAuth) | 로그인=가입/닉네임 최초설정/도메인검사 로직 재구현 필요 | 로직 자체는 단순하나 구현 위치(콜백/미들웨어)가 미확정 | Phase 3에서 별도 설계 | 예, 성급히 확정 금지(§9) |
| 4 | 파일 Storage 전면 교체(로컬 파일 → Supabase Storage) | 기존 "고아 파일 미삭제" 버그를 그대로 옮길지, 이번에 삭제 로직 추가할지 | 클라우드 스토리지 비용 관점에서 삭제 로직 추가를 권장하나 스코프 확대이므로 확정 아님 | 사용자와 재확인 후 Phase 5에서 결정 | 예 |
| 5 | Python AI 모델 실행 환경(Vercel Serverless의 PyTorch 미지원/콜드스타트) | AI 매칭/자연어검색 기능 전체가 영향받음 | §5 참고, 3가지 선택지 중 미확정 | 별도 검증 스파이크(호스티드 API 성능/비용 비교, transformers.js 정확도 비교) 필요 | **예, 강함** |
| 6 | 실시간 채팅(Streamlit은 매 상호작용마다 전체 재실행 + 세션 상태로 "새 메시지" 근사 폴링; Next.js에서는 별도 설계 필요) | 폴링 vs WebSocket/Supabase Realtime 선택에 따라 UX/비용 차이 | 미확정 | Phase 7에서 결정 | 예 |
| 7 | Vercel Serverless/Edge 제약(함수 실행시간, cold start, 파일시스템 read-only) | 이미지 처리·AI 추론 등 무거운 작업에 직접 영향 | §5, §6에서 이미 반영 | 무거운 작업은 외부 서비스로 위임하는 방향이 유력하나 미확정 | 예 |
| 8 | 환경변수/시크릿 구조 전면 교체(`.streamlit/secrets.toml` → Vercel 환경변수) | 배포 파이프라인 설계에 영향 | 단순 이관이나 Preview/Production 분리 정책 필요 | Phase 11에서 결정 | 아니오(단순) |
| 9 | 기존 데이터 마이그레이션(현재 SQLite 파일이 `.gitignore`되어 있어 저장소에 실제 데이터가 없을 가능성) | 마이그레이션 스크립트 필요 여부 자체가 불확실 | **[추측] 운영 중인 실제 데이터가 존재하는지 미확인** — 사용자에게 확인 필요 | 사용자 확인 후 Phase 10에서 결정 | **예, 최우선 확인 필요** |
| 10 | 비용(Supabase/Vercel/AI API 사용량에 따른 과금) | 예산 계획 필요 | 이번 Phase에서 산정하지 않음 | AI 이전 방식 확정 후 비용 추정 | 예 |
| 11 | 성능(AI 브루트포스 방식이 게시물 수 증가 시 선형 저하) | §5 참고, 기존 구현부터 이미 존재하던 한계 | pgvector 등 벡터 인덱스 도입 여부 미확정 | Phase 6에서 결정 | 예 |
| 12 | 보안(§4의 "서버에서 매번 재검증" 원칙을 Next.js Server Action에서도 동일하게 지키지 못할 위험) | 클라이언트 신뢰 실수 시 권한 우회 가능 | 설계 원칙은 명확(§4 표) | 코드 리뷰/테스트로 강제 | 아니오(원칙은 확정, 구현 시 검증) |
| 13 | `Report.target_id` 부호 인코딩을 Prisma/PostgreSQL로 그대로 옮길지, 정규화(별도 `postType` 컬럼)할지 | 스키마 설계와 쿼리 복잡도에 영향 | 미확정(§3.2-2, §3.3) | Phase 2에서 결정 | 예 |
| 14 | PRD의 "가중치 합산 매칭 점수(텍스트+이미지+장소+시간+카테고리)"가 애초에 구현되어 있지 않음 | 신규 기능으로 볼지, 스코프 밖으로 유지할지 | 마이그레이션은 "현재 구현 기준"이 원칙이므로 기본적으로 스코프 제외, 확장 여부는 사용자 결정 | 사용자 확인 필요 | 예 |

## 12. 검증 체크리스트

- [x] `main` 브랜치의 기존 코드를 수정하지 않았는가 — clone 후 read-only 조사만 수행, `git status`로 clean 확인.
- [x] 기존 기능을 빠뜨리지 않았는가 — `app.py`, `ui/auth.py`, `ui/common.py`, `db/database.py`(전체 2410줄), `pages/1,3,4,5,6,7,8`을 모두 실제로 읽고 §2를 작성(`pages/2_찾았어요.py`는 `pages/1_찾아요.py`의 대칭 구조임을 라인 수 일치로 확인, 상세 미독은 아래 미해결 사항에 기재).
- [x] DB 테이블과 실제 코드의 사용 방식이 일치하는지 확인했는가 — §3.2에서 `schema.sql`과 `_migrate_*()` 함수 간 괴리를 구체적으로 기술.
- [x] 인증/권한 로직을 실제 코드에서 확인했는가 — `ui/auth.py` 전체 통독, `database.py`의 `_require_admin`/`_require_not_suspended`/소유권 검사 함수 확인.
- [x] AI 기능을 실제 코드에서 확인했는가 — `ai/embedding.py`, `ai/matching.py`, `ai/search.py` 전체 통독.
- [x] 추측으로 작성한 내용을 명확히 표시했는가 — 본문 내 **[추측]** 태그(§11 #9), § 5/9/11에서 "미확정"으로 명시.
- [x] 아직 확정할 수 없는 기술 선택을 확정된 것처럼 쓰지 않았는가 — AI 실행 방식(§5), 인증 구현 세부 위치(§9), Supabase vs 대안 DB(§9)를 모두 "미확정"으로 명시.

### 미확인/미열람 항목 (정직하게 기재)
- `pages/2_찾았어요.py`는 전문을 확인했다 — `pages/1_찾아요.py`와 완전히 대칭인 구조(찾아요↔찾았어요, lost↔found, `render_report_control("post", -post["id"])`로 FoundPost는 음수 인코딩)임을 라인 단위로 검증 완료.
- `tests/*.py` 24개 파일은 목록과 규모(파일명, 줄 수)만 확인했고 전문을 읽지 않았다 — Phase 9(통합 테스트)에서 실제 명세로 활용하기 전에 전수 검토 필요.
- `vercel`/`deploy`/`hostinger` 브랜치는 `git diff --stat`으로 파일 목록만 확인했고, 각 파일 내용은 열람하지 않았다(지시에 따라 재사용하지 않을 것이므로 상세 검토는 실익이 낮다고 판단).
- 운영 중인 실제 사용자 데이터(SQLite DB 파일) 존재 여부는 **확인하지 않았다** — `db/lost_found.db`는 `.gitignore` 대상으로 저장소에 없으며, 실제 배포 환경(Streamlit Cloud 등)에 데이터가 쌓여 있는지는 사용자에게 확인이 필요하다.
