# 명지 스마트 분실물 센터 — JS(Next.js) 버전

기존 Streamlit(파이썬) 앱을 Next.js로 재작성하는 프로젝트.
파이썬 원본은 이 폴더 바깥(`../`)에 참고용으로 둠.

## 스택
- **Next.js** (App Router, 일반 JavaScript) + **Tailwind CSS**
- **Supabase** — Postgres DB, 로그인(Google, `@mju.ac.kr` 제한), 이미지 저장, pgvector, 실시간
- **Vercel** — 배포
- **AI 임베딩** — Cloudflare Workers AI `bge-m3` (무료) / 로컬 transformers.js (대안)

## 진행 단계 (MVP 먼저)
1. [ ] Node.js 설치, Next.js 프로젝트 생성
2. [ ] Supabase 프로젝트 + `supabase/schema.sql` 실행
3. [ ] Google 로그인 (`@mju.ac.kr`만 허용) + 닉네임 설정
4. [ ] 찾아요 / 찾았어요 게시판 (목록·작성·상세·수정·삭제 + 이미지 업로드)
5. [ ] AI 매칭 v2 (임베딩 저장 + pgvector 유사도 + 카테고리/시간/장소 가중치)
6. [ ] Vercel 배포
--- MVP 여기까지 ---
7. [ ] 채팅 (실시간) + 알림
8. [ ] 내 게시물 / 내 매칭 / 내 채팅
9. [ ] 신고 + 관리자
10. [ ] 디자인 마감 (에브리타임풍, 밝은 톤)

## 필요한 계정 (전부 무료, 카드 등록 없음)
- Supabase — https://supabase.com
- Cloudflare — https://dash.cloudflare.com (AI 매칭용)
- Google Cloud Console — OAuth 클라이언트 (로그인용)
- Vercel — https://vercel.com (배포, 나중에)

## 환경변수 (`.env.local`, 나중에 채움)
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
CLOUDFLARE_ACCOUNT_ID=
CLOUDFLARE_API_TOKEN=
ALLOWED_EMAIL_DOMAIN=mju.ac.kr
```
