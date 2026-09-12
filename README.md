## 명지 스마트 분실물 센터

**[앱 링크](https://mju-lostfound.vercel.app)**

**명지 스마트 분실물 센터**는 **바이브코딩 경진대회 출품작**으로 개발한 교내 분실물 관리 서비스입니다.

명지대학교 학생들이 교내에서 분실하거나 습득한 물건을 등록하고 서로 찾아줄 수 있도록 하며, **AI 기반 의미 유사도 분석으로 분실물과 습득물을 자동 매칭**합니다. 매칭된 사용자 간 실시간 채팅으로 확인·반환 과정을 지원합니다.

### 주요 기능

* Google 계정 로그인 (`@mju.ac.kr` 인증, 베타 기간 한정 `@gmail.com` 허용)
* 인문·자연 캠퍼스 분리 게시판 (찾아요 / 찾았어요)
* 게시물 등록·조회·수정·삭제, 사진 첨부(최대 3장)
* AI 매칭 (임베딩 유사도 + 카테고리·장소·시간 가중치), 강한 매칭 자동 알림
* 통합 검색(키워드 + AI 의미 검색) 및 이미지 기반 검색
* 실시간 채팅 (이모지 반응, 메시지 신고)
* 실시간 알림, 댓글
* 되찾음 마무리, 매칭 상태 자동 정리
* 신고 처리 / 통계 대시보드 / 게시글·사용자 관리 (운영자 > 관리자 > 일반 3단계 권한)
* 다크 모드, 강조색 선택, 고대비, PWA

### 기술 스택

| 영역 | 사용 기술 |
| --- | --- |
| 프론트 / 서버 | Next.js 16 (App Router, JavaScript), Tailwind CSS v4 |
| DB / 인증 / 저장소 / 실시간 | Supabase (Postgres, Auth, Storage, Realtime) |
| AI | Cloudflare Workers AI — `bge-m3` 임베딩, Llama Vision 이미지 캡셔닝 |
| 배포 | Vercel (icn1 / 서울 리전) |

### 개발 이력

기존 Streamlit(파이썬) 버전을 Next.js로 전면 재작성했습니다. 파이썬 원본은 이 커밋 이전의 git 히스토리에 남아 있습니다.

### 로컬 실행

```bash
cd web
npm install
# .env.local 에 Supabase / Cloudflare 키 설정
npm run dev
```

자세한 내용은 [`web/README.md`](web/README.md) 참고.

### 공동 개발

박지환 · 조현석 · 윤성민 · 김준형
