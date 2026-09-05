# 명지 스마트 분실물 센터

명지대학교 교내 분실물·습득물을 등록하고 **AI 의미 유사도로 자동 매칭**해주는 서비스입니다.
바이브코딩 경진대회 출품작이며, 원래 Streamlit(Python)으로 만들었던 것을
**React(Vite) + Node.js(Express) 단일 서버 구조**로 옮겼습니다.

---

## 1. 이 프로젝트의 구조

React를 빌드해서 나온 정적 파일을 **Express가 직접 서빙**하고, 같은 서버가 `/api/*` 요청도
처리합니다. 서버가 하나뿐이라 Railway에 한 번만 배포하면 되고, CORS 설정도 필요 없습니다.

```
브라우저 ──▶ Express (BE/server.js, 포트 하나)
                ├── /api/*     → JSON API
                ├── /uploads/* → 업로드된 이미지
                └── 그 외 전부  → dist/index.html (React 앱)
```

### 폴더

**프론트엔드는 `FE/` 폴더, 백엔드는 `BE/` 폴더** 로 완전히 나뉘어 있습니다.
두 쪽 모두 기능별로 파일이 하나씩이라, 고칠 곳을 파일 이름만 보고 찾을 수 있습니다.

```
mju-lost-found/
├── package.json          FE+BE 의존성과 스크립트가 한 곳에
├── vite.config.js        FE 빌드 설정 (+ 개발용 API 프록시)
├── index.html            React가 붙을 HTML 껍데기 (FE/main.jsx 를 불러옴)
├── nixpacks.toml         Railway 빌드 방식 지정
├── railway.json          Railway 배포 설정
├── .env.example          환경변수 견본 (복사해서 .env 로 사용)
│
├── BE/                   ★ 백엔드 (Node.js + Express)
│   ├── server.js           진입점 -- 조립만 한다 (미들웨어 + 라우터 + 정적 서빙)
│   ├── db.js               SQLite 데이터 계층 (권한/검증이 전부 여기 있음)
│   ├── ai.js               AI 유사도 매칭
│   ├── auth.js             Google 로그인 + 로그인 가드
│   ├── session.js          세션 쿠키 설정
│   ├── upload.js           이미지 업로드(multer) 설정
│   ├── helpers.js          라우트 공통 도구 (에러 처리 등)
│   └── routes/             기능별 API  ← 새 API는 여기에 추가
│       ├── index.js          라우터 조립
│       ├── auth.js           /me, /auth/*
│       ├── posts.js          /posts/:kind*, /my/posts
│       ├── ai.js             /ai/search, /ai/match
│       ├── matches.js        /matches*
│       ├── chats.js          /chats*
│       ├── reports.js        /reports
│       ├── notifications.js  /notifications*
│       └── admin.js          /admin/*
│
├── FE/                   ★ 프론트엔드 (React + Vite)
│   ├── main.jsx            React 진입점
│   ├── App.jsx             앱 껍데기 (로그인 게이트 + 레이아웃)
│   ├── Routes.jsx          경로 → 화면 연결표
│   ├── navigation.js       화면 이동 (navigate / useRoute)
│   ├── api.js              fetch 헬퍼
│   ├── constants.js        게시판 설정표·라벨·날짜 헬퍼
│   ├── styles.css          전역 스타일 (라이트/다크 모두 지원)
│   ├── components/         여러 화면이 함께 쓰는 부품
│   │   ├── Banner.jsx  Empty.jsx  Loading.jsx  Thumb.jsx  StatusPill.jsx
│   │   ├── ConfirmModal.jsx     되돌릴 수 없는 동작 확인창
│   │   ├── ReportButton.jsx     신고 버튼 + 폼
│   │   ├── MatchCandidates.jsx  AI 결과 카드 목록
│   │   ├── ConfirmMatchButton.jsx  "내 물건 같아요"
│   │   └── TopBar.jsx           상단 내비게이션
│   └── screens/            화면 하나 = 파일 하나
│       ├── LoginScreen.jsx  NicknameScreen.jsx  DomainBlockedScreen.jsx
│       ├── HomeScreen.jsx
│       ├── BoardScreen.jsx  BoardList.jsx  NewPostForm.jsx
│       ├── PostDetailScreen.jsx
│       ├── MyPostsScreen.jsx  MyPostCard.jsx
│       ├── MatchesScreen.jsx
│       ├── ChatsScreen.jsx  ChatRoomScreen.jsx
│       ├── NotificationsScreen.jsx
│       └── AdminScreen.jsx  AdminReportCard.jsx
│
├── data/                 DB 파일 + 업로드 이미지 (git에 올라가지 않음)
├── dist/                 npm run build 결과물 (git에 올라가지 않음)
└── legacy-python/        마이그레이션 이전 Streamlit 코드 (참고용 보관)
```

### 어디를 고쳐야 하나요?

| 하고 싶은 일 | 고칠 파일 |
|---|---|
| 화면 문구·디자인 바꾸기 | `FE/screens/` 의 해당 화면 |
| 색·여백 등 전체 스타일 | `FE/styles.css` |
| API 응답 내용 바꾸기 | `BE/routes/` 의 해당 파일 |
| DB 규칙·권한 바꾸기 | `BE/db.js` |
| 새 화면 추가 | `FE/screens/새화면.jsx` + `FE/Routes.jsx` 에 한 줄 |
| 새 API 추가 | `BE/routes/새기능.js` + `BE/routes/index.js` 에 한 줄 |

> `legacy-python/`은 예전 Python 코드를 그대로 옮겨 둔 것입니다. 실행에는 쓰이지 않지만,
> 로직을 대조해보고 싶을 때 참고하시라고 남겼습니다. 지워도 서비스는 정상 동작합니다.
> (루트에 `requirements.txt`가 있으면 Railway가 Python 앱으로 오인할 수 있어서 옮겼습니다.)

### 기존 Python 코드와의 대응표

| 기존 (Python/Streamlit) | 새 코드 |
|---|---|
| `db/database.py` (2,409줄) | `BE/db.js` |
| `db/schema.sql` | `BE/db.js` 안의 `SCHEMA` 상수 |
| `ai/embedding.py`, `matching.py`, `search.py` | `BE/ai.js` |
| `ui/auth.py` | `BE/auth.js` |
| `ui/common.py` | `FE/components/` 전체 |
| `app.py` | `FE/screens/HomeScreen.jsx` |
| `pages/1_찾아요.py`, `2_찾았어요.py` | `FE/screens/BoardScreen.jsx` + `BoardList` + `NewPostForm` + `PostDetailScreen` |
| `pages/3_내_게시물.py` | `FE/screens/MyPostsScreen.jsx` + `MyPostCard.jsx` |
| `pages/4_내_매칭.py` | `FE/screens/MatchesScreen.jsx` |
| `pages/5_채팅.py` | `FE/screens/ChatRoomScreen.jsx` |
| `pages/6_내_채팅.py` | `FE/screens/ChatsScreen.jsx` |
| `pages/7_관리자.py` | `FE/screens/AdminScreen.jsx` + `AdminReportCard.jsx` |
| `pages/8_알림.py` | `FE/screens/NotificationsScreen.jsx` |

찾아요/찾았어요는 화면 구조가 완전히 대칭이라 파일을 두 벌 만들지 않고
`kind` 값으로 갈라 쓰는 한 벌만 뒀습니다. 두 게시판의 차이(라벨·필드명·상태 목록)는
`FE/constants.js` 의 `BOARD_META` 한 곳에 모여 있습니다.

DB 스키마(9개 테이블), 권한 규칙, 검증 규칙, 에러 메시지는 원본을 그대로 유지했습니다.

---

## 2. 내 컴퓨터에서 실행하기 (VS Code)

### 준비물

- **Node.js 22 이상** — https://nodejs.org 에서 LTS 버전 설치
  (설치 후 VS Code 터미널에서 `node -v` 를 쳐서 버전이 나오면 성공)

### 순서

**① 터미널 열기** — VS Code에서 이 폴더를 열고 `Ctrl` + `` ` ``

**② 패키지 설치** (처음 한 번만)

```bash
npm install
```

**③ 환경변수 파일 만들기**

`.env.example`을 복사해서 `.env`로 이름을 바꾸고, 아래 값을 채웁니다.

```bash
cp .env.example .env
```

최소한 `SESSION_SECRET`만 채우면 됩니다. 아무 긴 문자열이나 넣어도 되고,
아래 명령으로 만들어도 됩니다:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

> Google 로그인 설정(`GOOGLE_CLIENT_ID` 등)은 **로컬에서는 비워둬도 됩니다.**
> 비어 있으면 화면에 "개발용 로그인" 칸이 자동으로 나타나서, 아무 `@mju.ac.kr`
> 이메일이나 입력해 바로 들어가볼 수 있습니다. (배포 환경에서는 자동으로 잠깁니다.)

**④ 개발 서버 실행**

```bash
npm run dev
```

이 한 줄이 두 개를 동시에 띄웁니다:
- Express API 서버 → `http://localhost:3000`
- React 개발 서버 → **`http://localhost:5173`** ← **브라우저로 여기에 접속하세요**

React 개발 서버는 코드를 저장하는 즉시 화면에 반영되고(HMR), `/api` 요청은 알아서
Express로 넘겨줍니다.

**⑤ 실제 배포 형태로 확인해보기** (선택)

```bash
npm run build   # React를 dist/ 로 빌드
npm start       # Express가 dist/를 서빙 -> http://localhost:3000
```

Railway에서 실제로 도는 모습과 동일합니다. 배포 전에 한 번 확인해보면 좋습니다.

### 자주 쓰는 명령

| 명령 | 하는 일 |
|---|---|
| `npm run dev` | 개발 모드 (프론트 + 백엔드 동시 실행) |
| `npm run build` | React를 `dist/`로 빌드 |
| `npm start` | 빌드 결과를 Express로 서빙 (배포와 동일) |
| `npm run db:reset` | DB를 완전히 비우고 새로 만듦 (**데이터 전부 삭제**) |

### 나를 관리자로 만들기

관리자 화면(`/admin`)은 DB의 `is_admin` 값이 1인 사용자만 볼 수 있습니다.
한 번 로그인해서 계정을 만든 뒤, 아래 명령을 실행하세요.

```bash
node -e "import('./BE/db.js').then(m=>{m.db.prepare('UPDATE User SET is_admin=1 WHERE email=?').run('본인이메일@mju.ac.kr');console.log('완료')})"
```

---

## 3. Railway 배포하기

### ① GitHub에 올리기

```bash
git add .
git commit -m "React + Express로 마이그레이션"
git push
```

> `.env`, `data/`, `dist/`, `node_modules/`는 `.gitignore`에 있어서 자동으로 제외됩니다.
> **`.env`는 절대 커밋하지 마세요.** 비밀 키가 들어 있습니다.

### ② Railway 프로젝트 만들기

1. https://railway.app 에 GitHub 계정으로 로그인
2. **New Project → Deploy from GitHub repo** → 이 저장소 선택
3. Railway가 `nixpacks.toml`을 읽고 자동으로 이렇게 진행합니다:
   `npm ci` → `npm run build` → `npm start`

### ③ ⚠️ Volume 연결하기 (가장 중요, 빼먹으면 데이터가 다 날아갑니다)

이 앱은 SQLite 파일과 업로드 이미지를 디스크에 저장합니다. Railway 컨테이너의 기본
디스크는 **재배포할 때마다 초기화**되므로, 반드시 Volume을 붙여야 합니다.

1. 서비스 화면에서 **Settings → Volumes → New Volume**
2. **Mount path** 에 `/data` 입력
3. 아래 ④에서 `DATA_DIR=/data` 환경변수를 함께 설정

이걸 안 하면 배포할 때마다 게시글·채팅·계정이 전부 사라집니다.

### ④ 환경변수 설정 (Variables 탭)

| 변수 | 값 | 필수 |
|---|---|---|
| `SESSION_SECRET` | 길고 랜덤한 문자열 | **필수** (없으면 서버가 시작되지 않음) |
| `DATA_DIR` | `/data` | **필수** (③의 Volume 경로와 같아야 함) |
| `NODE_ENV` | `production` | 권장 (보안 쿠키가 켜집니다) |
| `GOOGLE_CLIENT_ID` | 구글에서 발급받은 값 | 실서비스라면 필요 |
| `GOOGLE_CLIENT_SECRET` | 구글에서 발급받은 값 | 실서비스라면 필요 |

`PORT`는 Railway가 자동으로 넣어주므로 **직접 설정하지 마세요.**

### ⑤ 도메인 만들기

**Settings → Networking → Generate Domain** 을 누르면
`https://무언가.up.railway.app` 주소가 생깁니다.

### ⑥ Google 로그인 연결하기

1. https://console.cloud.google.com → **API 및 서비스 → 사용자 인증 정보**
2. **사용자 인증 정보 만들기 → OAuth 클라이언트 ID → 웹 애플리케이션**
3. **승인된 리디렉션 URI**에 정확히 이 주소를 추가:
   ```
   https://내앱주소.up.railway.app/api/auth/callback
   ```
   (로컬에서도 쓰려면 `http://localhost:3000/api/auth/callback`도 함께 추가)
4. 발급된 클라이언트 ID/시크릿을 ④의 환경변수에 넣고 재배포

> 리디렉션 URI는 **한 글자라도 다르면** 구글이 거부합니다. 끝에 `/`를 붙이지 마세요.

### 배포 체크리스트

- [ ] Volume을 `/data`에 마운트했다
- [ ] `DATA_DIR=/data` 를 설정했다
- [ ] `SESSION_SECRET` 을 설정했다
- [ ] `NODE_ENV=production` 을 설정했다
- [ ] `PORT`는 **설정하지 않았다**
- [ ] Google 리디렉션 URI가 실제 도메인과 정확히 일치한다
- [ ] `.env` 파일을 GitHub에 올리지 않았다

---

## 4. 주요 기능

- Google 계정 로그인 + `@mju.ac.kr` 도메인 제한
- 고정 닉네임 (한 번 정하면 변경 불가, 공개되는 유일한 신원 정보)
- **찾아요 / 찾았어요** 게시판: 등록·수정·삭제·상태 변경·사진 첨부
- 키워드 검색 + 카테고리/상태 필터
- **AI 의미 검색**: 문장으로 검색하면 반대편 게시판에서 의미가 비슷한 글을 찾아줌
- **AI 매칭**: 내 게시물과 유사한 반대편 게시물 추천 → "내 물건 같아요"로 매칭 확정
- 1:1 채팅 (매칭 기반 + 게시글에서 바로 문의하는 다이렉트 채팅), 읽음 표시, 이전 대화 불러오기
- 알림 (새 메시지 / 매칭 / 신고 처리 결과 / 제재)
- 신고 (게시물·메시지·사용자)
- 관리자: 신고 검토, 게시물 삭제 / 메시지 숨김 / 사용자 정지

---

## 5. AI 매칭에 대해 (원본과 달라진 점)

기존 Python 버전은 `sentence-transformers`로 한국어 임베딩 모델
(`jhgan/ko-sroberta-multitask`, 약 440MB)을 내려받아 사용했습니다.
Node/Railway 환경에서는 이 방식이 잘 맞지 않아 기본 백엔드를 바꿨습니다.

- **`local` (기본값)** — 문자 n-gram + 단어 TF-IDF 코사인 유사도.
  순수 JavaScript라 **다운로드가 없고, 첫 요청부터 즉시 동작하며, 메모리를 거의 안 씁니다.**
  단어를 2글자씩 쪼개서 비교하기 때문에 "에어팟을"과 "에어팟"처럼 조사가 붙은 형태도
  같은 것으로 인식합니다.
- **`transformers` (선택)** — 진짜 문장 임베딩을 쓰고 싶다면:
  ```bash
  npm install @xenova/transformers
  ```
  후 환경변수 `EMBEDDING_BACKEND=transformers` 설정.
  (모델 다운로드 때문에 첫 요청이 느리고 메모리를 많이 씁니다. Railway 무료 플랜에서는
  메모리 부족으로 실패할 수 있으니 주의하세요. 실패하면 자동으로 `local`로 되돌아갑니다.)

백엔드 교체 지점은 `BE/ai.js`의 `scoreAgainstFirst()` 한 곳으로 격리돼 있어서,
나중에 다른 임베딩 API로 바꿔도 랭킹 로직은 그대로 둘 수 있습니다.

---

## 6. 문제가 생겼을 때

| 증상 | 원인과 해결 |
|---|---|
| 배포할 때마다 데이터가 사라짐 | Volume 미설정. 위 ③④를 확인하세요. |
| 서버가 바로 죽음 (`SESSION_SECRET...`) | Railway Variables에 `SESSION_SECRET` 추가 |
| 로그인 후 `redirect_uri_mismatch` | 구글 콘솔의 리디렉션 URI와 실제 도메인이 다름 |
| 로컬에서 "프론트엔드가 아직 빌드되지 않았습니다" | `npm run dev` 중이라면 5173 포트로 접속. 아니면 `npm run build` |
| `npm install` 중 better-sqlite3 오류 | Node 22 이상인지 확인 (`node -v`) |
| 화면은 뜨는데 데이터가 안 보임 | 브라우저 개발자도구(F12) → Network 탭에서 `/api` 응답 확인 |
