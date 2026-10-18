# Codex 인수인계 및 배포 검증 — 2026-10-18 (KST)

> 최초 인수인계 시점의 기록이다. 후속 원인 분석·수정 및 수동 검증 절차는 [PREVIEW_ACCEPTANCE.md](PREVIEW_ACCEPTANCE.md)를 우선 참고한다. 아래의 Claude ONNX 검증 미확인 표기는 후속 사용자 제공 검증 결과로 보완됐다.

판정: **Production 배포 보류**. 정상 로그인 환경에서 Preview의 주요 쓰기 기능을 검증하지 못했고, Preview 검색 오류가 조회됐다. 인증 우회는 사용하지 않았다.

## 소스 및 배포

- 시작 시 작업 트리는 깨끗했다. 브랜치 `vercel`, 로컬 HEAD `51f60be`.
- GitHub 실제 `vercel` HEAD와 Production 소스는 `5abb77e`. 로컬이 6개 커밋 앞서 있다.
- 기존 구현: 홈페이지 통일 `a91f2a2`, 카테고리 통계 `80017b3`, 관리자 방문·로그인 기록 `97837f2`, 몽골어 날짜 수정 `36bf0e9`, 관리자 대시보드 확장 `cd377ac`, 번들 최적화 `51f60be`.
- Vercel 프로젝트 `mju-lost-found-vercel`, Git 자동 배포 연결 없음. CLI 배포, Node.js 24, 함수 리전 `icn1`. Production cron은 기존 설정 유지.

| 역할 | Deployment ID | 소스 | 상태 |
|---|---|---|---|
| 현재 Preview | `dpl_ecZpsJMf3Z8hWjb6ZR7hiVdg4SP1` | `51f60be` | READY, 보존 |
| 현재 Production | `dpl_7xqrfcYEQmgJR6F5JebGrwJMXAye` | `5abb77e` 환경변수 재배포 | READY, 보존 |
| 이전 Production 롤백 후보 | `dpl_2DPCWLncsUQyjzfHTLQrtpWWW1PP` | `634900f` | READY, 보존 |
| 이전 Preview `f2on45hj0` | `dpl_7LNW7FkYBTMPyWyWtY5byj9g4qFs` | `cd377ac` | READY, 보존 |

현재 별칭은 Preview `mju-lost-found-preview.vercel.app`, Production `mju-find.vercel.app`을 가리킨다. 이전 Preview에는 별칭이 없지만 최근 1시간 조회에 `/search` 요청 기록이 있어 미사용으로 확정하지 않았다. 위 롤백 후보가 Vercel의 자동 롤백 대상으로 지정됐는지 또는 실제 롤백 실행 가능 여부까지 검증한 것은 아니다.

## 검증 결과

| 항목 | 결과 및 한계 |
|---|---|
| 기존 전체 테스트 | **187개 파일, 2,312개 테스트 통과**. `npm test -- --reporter=dot` |
| 타입 / lint | `npx tsc --noEmit`, `npm run lint` 통과 |
| Production 공개 페이지 | 홈, 로그인, 분실물·습득물 목록, 자연어 검색 페이지, 개인정보처리방침 200 |
| Production 인증 경계 | 비로그인 session은 null, 관리자 통계는 `/login`으로 307 이동 |
| Production 자연어·이미지·결합 검색 | 기존 배포의 공개 API 모두 200, 결과 각 1건. 텍스트·이미지 모델의 실제 실행 경로 확인. 이미지 입력은 저장소 공개 아이콘이므로 검색 품질 평가는 아님 |
| 최적화된 Preview의 검색·ONNX | **미검증**. 일반 HTTP 요청은 Vercel SSO로 302. 사용 가능한 브라우저가 없어 정상 로그인 진행 불가 |
| 추천 매칭 / 임베딩 생성·갱신 | 기존 단위 테스트 통과. 실제 Preview의 게시글 작성·수정에 따른 생성·갱신과 추천 결과는 **미검증** |
| 사진 업로드·삭제 / 댓글 작성·삭제 | 기존 단위 테스트 통과. 정상 로그인 후 실제 Preview 쓰기 기능은 **미검증** |
| 로그인 전후 홈 / 관리자 통계 | 관련 테스트 통과. 실제 Preview 로그인 후 UI·통계·몽골어 hydration은 **미검증** |

Preview 오류 로그에서 `/search`의 `Failed to search posts SyntaxError: Unexpected token '<', "<!DOCTYPE "... is not valid JSON` 7건을 조회했다(최근 1시간 조회). HTTP 상태는 200이므로 5xx만 확인하면 놓친다. `src/lib/posts/searchApiClient.ts`는 서버에서 동일 host의 `/api/posts`를 fetch하며 인증 정보를 전달하지 않고 JSON을 파싱한다. Vercel 보호 화면으로 리디렉션된 뒤 HTML을 받은 것이 유력한 원인이나, 정상 로그인 세션에서 재현하여 확정하지 못했다. 보호 해제나 우회 토큰 추가는 하지 않았다.

Production 최근 1시간 error-level 조회 결과는 0건이었다. 전체 서비스 무오류 보증이나 배포 후 검증 결과는 아니다.

## 환경과 DB

- 로컬 운영용 `.env`와 Preview용 `.env.preview.local`의 DB 프로젝트가 서로 다르고, 각각의 Supabase Storage 프로젝트와 일치함을 확인했다. 실제 Vercel 변수 목록에서도 Production·Preview가 분리되어 있다. 원격 sensitive 값 전체를 로컬 값과 대조하지는 못했다.
- SELECT만 실행했다. 세션 단위 READ ONLY 설정, migration 적용, 사용자 데이터 변경은 하지 않았다.
- `20261106000000_admin_visit`: Preview migration 완료 및 `AdminVisit` 테이블 존재. Production은 migration 미적용, 테이블 없음.
- Production 사용자 ID 150의 `is_admin=true` 확인. 원격 `ADMIN_ACTIVITY_VIEWER_IDS`는 Production·Preview 각각 sensitive 변수로 존재한다. **값 150 포함 여부는 비공개이므로 검증하지 못했으며 변경하지 않았다.** 실제 관리자 전체 열람 확인은 다음 검증에 필요하다.

## Function Storage

Vercel inspect의 lambda 출력을 digest별로 중복 제거하여 size를 합산했다. MiB = bytes / 1,048,576. 계정 전체 청구 Storage 수치와는 구분한다.

| 배포 | 고유 번들 합계 |
|---|---:|
| 현재 Preview | 522,339,168 bytes = **498.14 MiB** |
| 현재 Production | 2,279,918,860 bytes = **2,174.30 MiB** |
| 이전 Preview `f2on45hj0` | 2,279,956,363 bytes = **2,174.34 MiB** |

Preview는 Production 대비 약 77.1% 감소 상태를 유지한다. AI 두 번들은 각각 약 241.6MB이다. 기존 tracing·GPU provider 제거 회귀 테스트도 통과했다. 최적화된 Linux 배포에서의 실제 ONNX 로드·추론은 Preview 로그인 후 검증해야 한다. 이번 작업의 추가 배포 및 삭제는 0건이다.

## 배포 재개 조건과 순서

1. 정상 Vercel 로그인 및 앱 로그인으로 현재 Preview를 열고 검색 오류를 재현·해결한다. 실제 사용자 데이터 대신 식별 가능한 테스트 게시글로 작성·수정, 임베딩 갱신·추천, 사진·댓글 추가·삭제를 검증한다.
2. 로그인 전후 홈페이지, 관리자 카테고리·방문·로그인·활동 통계, 몽골어 hydration 및 최적화 번들의 텍스트·이미지 ONNX 실행을 확인한다.
3. 모든 필수 검증 통과 후 기존 스크립트로 Production 암호화 백업과 복원 검증을 수행한다. 이번에는 배포 조건 미충족으로 새 백업·복원 검증을 시작하지 않았다.
4. Production `ADMIN_ACTIVITY_VIEWER_IDS=150` 유지와 실제 전체 열람을 확인하고, 대상 DB를 확인한 뒤 `20261106000000_admin_visit`을 적용한다.
5. 방침 최신 개정일은 현재 임시 `2026-10-18`이다. 실제 KST 배포일로 확정하고 관련 테스트를 재사용한다. 배포를 미뤘으므로 이번에는 날짜를 변경하지 않았다.
6. 검증된 최종 소스를 GitHub `vercel`에 push하고 Production에 배포한 뒤 별칭·주요 기능·오류 로그·Function Storage를 확인한다. 기존 Production과 롤백 배포를 보존한다.

이번 작업에서 애플리케이션 코드 수정, push, 배포, Production migration, 권한 변경, 데이터 삭제는 하지 않았다. 상세 로컬 실행 증거는 gitignore 대상 `.vercel/codex-*` 파일에 있다.
