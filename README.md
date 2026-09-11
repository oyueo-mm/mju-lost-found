# 명지 스마트 분실물 센터

**[🌐 서비스 바로가기](https://mju-lost-found-vercel.vercel.app)**

명지대학교 학생들을 위한 분실물·습득물 관리 서비스입니다.

분실물과 습득물을 게시하고, 키워드 검색뿐만 아니라 **AI 의미 검색과 이미지 검색**을 통해 원하는 물건을 찾을 수 있습니다. 게시글을 찾은 뒤에는 작성자와 채팅하거나 단체 게시글의 경우 해당 단체에 직접 문의할 수 있습니다.

> 명지대학교 학생들이 자발적으로 제작한 프로젝트이며, 명지대학교가 공식적으로 운영하는 서비스가 아닙니다.


명지대학교 학생들을 위한 분실물·습득물 관리 서비스입니다.

분실물과 습득물을 게시하고, 키워드 검색뿐만 아니라 **AI 의미 검색과 이미지 검색**을 통해 원하는 물건을 찾을 수 있습니다. 게시글을 찾은 뒤에는 작성자와 채팅하거나 단체 게시글의 경우 해당 단체에 직접 문의할 수 있습니다.

> 명지대학교 학생들이 자발적으로 제작한 프로젝트이며, 명지대학교가 공식적으로 운영하는 서비스가 아닙니다.

## 주요 기능

### 분실물·습득물 게시

* 분실물 / 습득물 게시글 작성 및 수정
* 게시글 이미지 첨부
* 카테고리와 상태 관리
* 댓글
* 조회수
* 개인 또는 단체 이름으로 게시

### 검색

#### 키워드 검색

제목과 게시글 정보를 기반으로 일반적인 키워드 검색을 제공합니다.

#### AI 의미 검색

문장을 단순히 같은 단어가 포함되어 있는지 비교하는 대신, 게시글과 검색어를 **문장의 의미를 나타내는 벡터**로 변환하여 의미적으로 가까운 게시글을 찾습니다.

예를 들어,

```text
학교 도서관에서 검은색 무선 이어폰을 잃어버렸어요
```

와 같이 자연스럽게 검색해도 관련 게시글을 찾을 수 있습니다.

텍스트 임베딩에는 `jhgan/ko-sroberta-multitask`를 사용하고, PostgreSQL의 `pgvector`와 HNSW 인덱스를 이용해 벡터 검색을 수행합니다.

#### 이미지 검색

찾고 싶은 물건의 사진을 업로드하여 비슷한 이미지가 등록된 게시글을 검색할 수 있습니다.

이미지는 SigLIP의 이미지 인코더를 이용해 벡터로 변환하고, 벡터 간 유사도를 기반으로 관련 게시글을 찾습니다.

### AI 기반 게시글 추천

게시글의 텍스트와 이미지를 기반으로 관련성이 높은 다른 게시글을 추천합니다.

이를 통해 사용자가 검색하지 않았더라도 비슷한 분실물이나 습득물을 발견할 수 있도록 합니다.

### 채팅

게시글을 통해 다른 사용자와 직접 채팅할 수 있습니다.

* 분실물 / 습득물 게시글 기반 채팅
* 이미지 전송
* 실시간 메시지
* 읽음 상태
* 댓글 작성자에게 직접 채팅
* 단체 게시글의 경우 `단체에 문의하기` 지원

### 단체

학생회, 동아리, 학과, 위원회 등의 단체를 서비스 안에서 관리할 수 있습니다.

* 단체 생성 신청
* 단체 가입 신청
* 단체 구성원 관리
* 대표 관리자 / 관리자 / 구성원 역할
* 단체 이름으로 게시글 및 댓글 작성
* 단체 게시글 문의
* 단체 관리자에게 문의 알림

개인 계정과 단체 활동을 분리하지 않고, **실제 작성자는 항상 사용자 계정으로 기록하면서 게시물에는 선택한 단체를 표시**하는 방식으로 구현했습니다.

### 계정 및 인증

Google 계정을 이용해 로그인합니다.

명지대학교 구성원만 서비스를 이용할 수 있도록 `@mju.ac.kr` 계정만 허용합니다.

* Google OAuth
* 명지대학교 이메일 도메인 검증
* 닉네임 설정
* 개인정보 동의
* 계정 비활성화 및 재로그인 시 기존 계정 복구

## 기술 스택

### Frontend / Backend

* Next.js
* React
* TypeScript
* Tailwind CSS

Next.js App Router를 기반으로 프론트엔드와 서버 로직을 하나의 프로젝트에서 구성했습니다.

### Database

* PostgreSQL
* Prisma
* pgvector
* HNSW

데이터베이스는 Supabase PostgreSQL을 사용합니다.

Prisma를 통해 일반적인 관계형 데이터를 관리하고, `pgvector`를 이용해 텍스트 및 이미지 임베딩을 저장하고 검색합니다.

### Authentication

* Auth.js / NextAuth
* Google OAuth

### AI

* `jhgan/ko-sroberta-multitask`

  * 한국어 텍스트 임베딩
  * 768차원 벡터
* `Xenova/siglip-base-patch16-224`

  * 이미지 임베딩
  * 이미지 검색 및 이미지 기반 유사도 계산
* OpenRouter

  * AI 관련 텍스트 처리

### Storage

* Supabase Storage

게시글 이미지는 Supabase Storage에 저장합니다.

업로드 과정에서 서버가 사용자의 로그인 상태와 게시글 소유권 등을 확인한 뒤 짧은 시간 동안 유효한 업로드 권한을 발급하고, 실제 이미지 데이터는 브라우저에서 Storage로 직접 업로드합니다.

### Realtime

* Supabase Realtime

채팅 메시지와 읽음 상태 등의 실시간 기능에 사용합니다.

### Deployment

* Vercel

## 시스템 구조

전체적인 구조는 다음과 같습니다.

```text
Browser
   │
   ▼
Next.js
   │
   ├── App Router
   ├── Server Actions
   └── API Routes
          │
          ├── Auth.js
          │
          ├── Prisma
          │      │
          │      ▼
          │   PostgreSQL
          │      │
          │      └── pgvector
          │
          ├── AI
          │      ├── Text Embedding
          │      └── Image Embedding
          │
          └── Supabase
                 ├── Storage
                 └── Realtime
```

## AI 검색 구조

### 텍스트 의미 검색

```text
검색어
  ↓
Text Embedding
  ↓
768차원 벡터
  ↓
pgvector
  ↓
HNSW 검색
  ↓
유사 게시글
```

게시글 역시 등록 또는 수정 과정에서 텍스트를 임베딩하여 벡터를 저장합니다.

검색할 때는 검색어를 같은 임베딩 모델로 변환한 뒤 저장된 게시글 벡터와 비교합니다.

### 이미지 검색

```text
검색 이미지
    ↓
SigLIP Image Encoder
    ↓
이미지 벡터
    ↓
pgvector
    ↓
유사도 검색
    ↓
비슷한 이미지가 포함된 게시글
```

텍스트 검색과 이미지 검색은 서로 다른 임베딩 모델을 사용하며, 각각의 검색 목적에 맞게 분리되어 있습니다.

## 이미지 저장 구조

게시글 이미지는 Supabase Storage의 `post-images` 버킷에 저장합니다.

```text
posts/
├── lost/
│   └── {postId}/
│       └── {uuid}.{ext}
│
└── found/
    └── {postId}/
        └── {uuid}.{ext}
```

허용되는 이미지 형식은 다음과 같습니다.

* JPEG
* PNG
* WebP

최대 이미지 크기는 10MB입니다.

이미지 업로드 권한은 서버에서 검증하며, 이미지 파일 자체는 브라우저에서 Supabase Storage로 직접 전송합니다.

## 프로젝트 구조

```text
src/
├── app/
│   ├── (auth)/
│   ├── (main)/
│   └── api/
│
├── components/
│
└── lib/
    ├── ai/
    ├── auth/
    ├── chat/
    ├── db/
    ├── images/
    ├── notification/
    ├── organizations/
    └── ...
    
prisma/
├── migrations/
└── schema.prisma

public/
```

주요 서버 로직과 도메인 로직은 `src/lib` 아래에서 기능별로 분리되어 있습니다.

## 로컬 개발

### 1. 저장소 클론

```bash
git clone https://github.com/oyueo-mm/mju-lost-found.git
cd mju-lost-found
```

`vercel` 브랜치를 사용합니다.

```bash
git checkout vercel
```

### 2. 의존성 설치

```bash
npm install
```

### 3. 환경변수 설정

`.env.example`을 복사합니다.

```bash
cp .env.example .env
```

필요한 환경변수를 설정합니다.

주요 환경변수:

```text
DATABASE_URL
DIRECT_URL

GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
AUTH_SECRET

OPENROUTER_API_KEY

NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
```

실제 비밀값이 포함된 `.env` 파일은 Git에 커밋하지 않습니다.

### 4. 개발 서버 실행

```bash
npm run dev
```

브라우저에서 다음 주소로 접속합니다.

```text
http://localhost:3000
```

## 테스트

전체 테스트:

```bash
npm test
```

Lint:

```bash
npm run lint
```

TypeScript 검사:

```bash
npx tsc --noEmit
```

Production build:

```bash
npm run build
```

## 배포

Production 서비스:

https://mju-lost-found-vercel.vercel.app

Vercel을 이용해 `vercel` 브랜치의 변경사항을 배포합니다.

## 프로젝트의 핵심

이 프로젝트의 핵심은 단순히 분실물 게시판을 만드는 것이 아니라,

```text
분실물 등록
    ↓
AI 검색
    ↓
관련 게시글 발견
    ↓
채팅 / 단체 문의
    ↓
물건 반환
```

이라는 실제 분실물 탐색 과정을 하나의 서비스 안에서 연결하는 것입니다.

특히 **자연어로 상황을 설명해도 관련 게시글을 찾을 수 있는 의미 검색**과 **사진을 이용해 비슷한 물건을 찾는 이미지 검색**을 통해 기존의 단순 키워드 기반 분실물 게시판에서 확장된 검색 경험을 제공하는 것을 목표로 합니다.
