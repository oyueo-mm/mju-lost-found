# Preview 통합 회귀 검사 (16단계)

이전 Claude의 `scratchpad/audit/regress.mjs`를 바탕으로 재구성했다. 기존 사용자 1·2와 관리자 13을 재사용하지 않는다. 로그인 쿠키는 로컬 서버 전용 임시 키로 만들며 실제 Google OAuth 검사는 별도 수동 로그인 검증으로 보완한다.

## 실행

저장소 루트에서 의존성과 모델을 준비하고 현재 코드로 빌드한다.

```powershell
npm ci
npm run build
npx vercel env pull .vercel/regression-preview.env --environment preview --yes
node --env-file=.vercel/regression-preview.env --env-file=.env.preview.local scripts/regression/preview.mjs --confirm-preview
```

`.env.preview.local`은 기존 비공개 Preview DB/Storage 운영 파일이다. `DATABASE_URL`, `DIRECT_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`가 필요하다. 공개 키는 `NEXT_PUBLIC_SUPABASE_ANON_KEY` 또는 `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`로 제공한다. Vercel 다운로드의 `[SENSITIVE]` 자리는 실제 Preview 자격증명이 있는 로컬 파일로 보완해야 한다. 값·쿠키·환경 파일은 출력하거나 커밋하지 않는다. 테스트 전용 AUTH_SECRET은 매 실행 새로 생성하며 배포 환경은 변경하지 않는다.

서버는 이 스크립트가 `127.0.0.1:3100`에서 직접 시작한다. 이미 포트가 사용 중이면 중단한다. Production DB나 Storage는 실행 가드가 차단한다. 배포·마이그레이션·Data API 설정 변경은 수행하지 않는다. Preview의 새로운 테스트 데이터 생성/정리가 승인된 상황에서만 실행한다.

16단계는 홈/로그인/버전, 익명 차단, 세션 3개, 동의·신원 준비, 게시글 생성, 사진 업로드·첨부, 게시글 조회, 임베딩 재계산, 키워드·의미·통합·이미지 검색, 채팅방 생성, 메시지·Realtime 수신, 비공개 사진·비참여자 차단, 알림 생성·읽음, 채팅 접근, 관리자 접근·일반 사용자 차단, 게시글·원본 사진 삭제다. 원본의 이미지 검색 502 허용과 실패 시 종료 코드 0 문제를 유지하지 않는다.

모든 생성 데이터는 실행별 UUID와 신규 계정에 귀속한다. 기존 사용자·시드의 신원, 알림 읽음 상태, 권한은 수정하지 않는다. Realtime 수신은 기능 회귀 검사이며 공개 채널의 보안이 해결됐다는 판정이 아니다(D-3 범위).

결과 JSON은 단계별 성공 여부·시간·새 테스트 ID만 출력한다. 실패 시 비정상 종료하며 이후 의존 단계는 실행하지 않는다. 공개 이미지 URL은 CDN 캐시로 남을 수 있어 삭제 전/후 인증된 Storage 목록과 DB 행으로 실제 삭제를 확인하고 공개 응답 상태는 별도로 기록한다.

## 실패 후 정리

항상 finally에서 사진과 신규 DB 데이터를 정리한다. DB 정리는 한 트랜잭션이다. 강제 종료나 정리 실패 시 `.vercel/regression-<UUID>.json`의 실행 명세를 사용한다. 명세에는 신규 fixture 식별자만 있고 키·세션은 없다.

```powershell
node --env-file=.vercel/regression-preview.env --env-file=.env.preview.local scripts/regression/preview.mjs --confirm-preview --cleanup-run .vercel/regression-<UUID>.json
```

정리는 DB의 실제 소유자·실행 표식·채팅 참여자와 이미지 경로를 재검증한다. 불일치하면 삭제하지 않고 중단한다. 실패 후 명세를 임의로 다른 사용자 ID로 수정하지 않는다. 정상 요청이 생성한 집계 통계는 삭제하지 않는다. 새 신고를 만들거나 기존 감사 기록을 삭제하는 검사는 없다.

## D-2 이미지 작업 동시성·중단 검사

Preview에 D-2 작업 테이블 및 트리거 마이그레이션을 적용한 후 별도 실행한다.

```powershell
node --env-file=.env.preview.local scripts/operations/verify-image-jobs.mjs
```

독립 신규 계정과 글만 사용한다. 4개 프로세스의 중복 억제, 동일 입력 재사용, 최종 시도 중단 복구, 실제 자식 worker 강제 종료, 실패 재시도, 사진 교체·추천 캐시 무효화, 사진 제거 후 오래된 벡터 차단을 검사한다. 실제 종료 검사는 이 스크립트가 생성한 자식 프로세스만 종료하며, 기다리는 시간을 줄이기 위해 해당 임시 작업의 lease 만료 시각만 앞당긴다. 기존 사용자·서비스 프로세스를 종료하지 않는다.

이 검사의 모델은 자식 프로세스 내부 test double이다. 호출 횟수와 저장 벡터를 확인하는 검사이며 배포된 실제 모델 품질을 대신하지 않는다. 배포된 Preview에서 실제 AI/이미지 검색과 로그인 상태 사진 첨부도 따로 확인한다. 테스트용 런타임 우회 플래그나 임의 모델 선택 API를 서비스에 추가하지 않는다. 마지막에 신규 글·작업·테스트 캐시·카운터·계정을 정리한다.
