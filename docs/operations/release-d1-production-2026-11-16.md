# D-1 Production 배포 및 최종 검증 — 2026-11-16

## 배포

- 사용자 승인 후 로컬 HEAD `cb3bb71184d1c7d534827cdf7660a15cede81569`, 깨끗한 작업 트리와 원격 C `baca1ac`을 확인했다. D-1 원격 브랜치는 없었으며 일반 Push로 `fix/release-d1-resource-limits`를 만들었다. main은 기존 `e113c46` 그대로, 병합·강제 Push 없음.
- 수동 검증한 Preview는 `b062cd7` / `dpl_iEQTM1CSxUVkqs1jWHpxY2svSZwQ`. `b062cd7..cb3bb71` 차이는 문서·운영 읽기 전용 검사·회귀 스크립트뿐이다. src·Next 설정·패키지/lock·Prisma·vercel.json 차이는 0이다.
- 배포: `node scripts/deployments/deploy.mjs production --dry-run`. 실제 Production 배포를 수행했으며 dry-run은 별도 배포 이력 DB 기록에만 적용한다. 마이그레이션·권한/기본 권한 변경·수동 Production 데이터 생성 없음.
- 새 Production: **`dpl_A8boERKr9cxihEsv5Wp6pmkqovRK`**, READY, `cb3bb71`.
- 불변 URL: https://mju-lost-found-vercel-61isnu31c-oyueo.vercel.app/ . 운영 주소 https://mju-find.vercel.app/ 의 `/api/version`에서 동일한 배포 ID·production·40자리 SHA를 확인했다.
- 롤백 대상: **`dpl_E9ztQCBpZwsfqMsi2h5dRob83mG2`** / `059ce7a`, 불변 URL https://mju-lost-found-vercel-f5whk2jht-oyueo.vercel.app/ . 새 배포 후에도 READY 메타데이터 확인, 삭제하지 않았다. 서비스 결함이 없어 롤백은 수행하지 않았으며 사용자 요청대로 D-1을 유지한다.

## 실제 배포 후 검증

| 항목 | 결과 |
| --- | --- |
| 공개 홈·로그인·분실/습득 목록·검색 페이지·정책/과거 정책 | 200 |
| 비로그인 작성/관리자 화면 | 로그인으로 307 |
| 비로그인 관리자 사용자/신고 API·증거 이미지 API | 401, 비공개 내용 미반환 |
| 익명 세션 | 비로그인 상태 |
| 기존 공개 게시글 목록 | lost/found 모두 200, 정상 JSON |
| AI 텍스트·이미지·결합 검색 | 기존 프로브의 각 1회 요청 모두 200 |
| 별도 키워드·semantic·unified 검색 | 각 1회 200, 배열 응답. 키워드 결과 0건도 정상 처리 |
| 기존 사진 실제 Next 최적화 | 기존 사진 1건, 128폭, 200·이미지 바이트 정상 |
| 이미지 호환성 | Production 참조 213개 허용 목록 일치, 기존 고유 공개 파일 134개 HEAD 모두 200. Preview 참조 177개도 일치 |
| Vercel 오류 및 5xx | 새 배포만 필터한 최근 20분 조회 2회 모두 오류 0·5xx 0. 각 쿼리 최대 200건, 조회 제한에 도달하지 않음 |
| 실제 Google 로그인·기존 사진·관리자 신고 목록 | 사용자 Production 수동 검증 정상, 2026-11-16 회신 |

**기존 프로브의 과거 날짜 단정 1건은 실패로 그대로 기록한다.** `.vercel/codex-production-release-check.mjs`는 정책에 `2026년 10월 18일`이 있어야 한다고 고정했다. 이전 Production과 새 Production 모두 이 문자열이 없었다. 현재 소스의 PRIVACY_POLICY_EFFECTIVE_DATE는 `2026-11-05`이며 이 값을 포맷한 문자열이 새 Production 페이지에 있음을 별도 검증했다(200). 앱/정책 회귀가 아닌 기존 검사 기대값 노후화이며 오류를 숨기거나 전체 기존 프로브를 무조건 통과로 보고하지 않는다. 실제 페이지·검색·인증 프로브는 모두 정상이다.

Production의 요청 제한 초과/장애 유도, 대량 호출, 실제 사용자 정지, 게시글·메시지·신고 생성은 하지 않았다. 새 테스트 콘텐츠가 없는 비파괴 읽기와 소수 검색만 수행했다. Preview 쓰기 기반 정식 16단계 회귀 스크립트는 Production에서 실행하지 않았다. 앞으로도 `scripts/regression/README.md`의 Preview 전용 가드를 유지한다.

## 신고 증거·Data API·접근 보호

- 기존 승인 실행기를 `RELEASE-D1-DEPLOY-20261116` 참조로 사용하고 BEGIN READ ONLY에서만 DB를 조회했다.
- 신규 운영 보조 스크립트 `scripts/operations/release-d1-evidence-check.mjs`는 버킷 비공개 여부·컬럼 수·집계만 출력한다. 본문·신고 ID·개인정보는 출력하지 않는다. 린트 통과.
- Production report-evidence는 비공개, 스냅샷 컬럼 3개 유지. 현재 신고/스냅샷/증거 객체가 모두 0이므로 실제 기존 운영 증거의 바이트·열람 기록을 재검증했다는 의미는 아니다. 기존 C의 서명·권한·증거 보존 코드에는 D-1 변경이 없다.
- Production·Preview의 서비스 키 REST 루트는 503 유지. Data API 설정을 바꾸지 않았다. 이 응답만으로 관리 API 비활성화 설정값을 독립 증명한다고 주장하지 않는다.
- 백업 코드·Production 접근 가드·승인 정책·RLS·GRANT/REVOKE·스키마를 변경하지 않았다. 일반 서비스 요청에 의한 정상 통계/로그 발생과 운영자가 테스트 콘텐츠를 삽입하는 행위를 구분한다.

## 백업 및 운영

- `ops/backup` 전용 작업 트리는 `059ce7a`, 변경 없음. D-1 브랜치 전환/Push로 백업 코드가 사라지지 않았다.
- 확인 시점 최근 정기 작업: 일간 백업 11월 15일 14:17 KST 결과 0, 독립 감시 11월 15일 13:53 결과 0. 다음 일간 작업은 11월 16일 04:00 KST.
- `auto-2026-11-15.tar.enc` 존재. `.verified.json`의 검증 시각은 14:17:49 KST, checksums ok, WSL Ubuntu 실제 복원 51개 테이블 불일치 0·이미지 참조 134개 누락 0. 이번 세션에서 새로 복원한 결과와 기존 검증 표식을 구분한다.
- 상태 파일의 마지막 성공 시각(13:51)과 더 늦은 검증 표식(14:17)을 각각 확인했다. 일간 스크립트는 당일 restore-verified 표식이 있으면 성공 종료로 건너뛸 수 있어 LastRun·lastSuccessAt·verifiedAt이 같은 의미는 아니다.
- 확인 도중 오늘 04:00 작업이 예약대로 Running으로 바뀌었다. 백업/감시 설정·보존 정책·작업 트리는 건드리지 않았다. 최종 완료 상태는 아래 추가 기록한다.

### 오늘 정기 백업 실패 — 별도 운영 문제

11월 16일 04:00:04 시작한 작업은 04:01:45 KST에 **복원 검사 실패, 작업 결과 1**로 끝났다. 성공으로 보고하지 않는다. 암호화 왕복/체크섬 검사를 거쳤지만 오늘 아카이브에는 restore-verified 완료 표식이 없다. 평문은 삭제된 상태다. 기존 11월 15일 검증된 백업을 유지하며 백업 설정·코드는 수정하지 않았다.

불일치: ActivityDay 기록 96/복원 95, AdminVisit 215/214, ApiMetricHourly 668/667. 51개 테이블 중 3개가 각각 1행 차이였다. 이미지 참조 134개 누락 0, private storage 검증 실패 0이다.

코드 읽기 결과 `backup.mjs`는 full/public pg_dump를 각각 실행한 **후** 별도 BEGIN READ ONLY 연결에서 행 수를 기록한다. 공유 export snapshot이 없고 REPEATABLE READ도 아니어서 통계/방문이 계속 생기는 운영 중에는 덤프 시점과 나중 행 수가 다를 수 있다. 관측된 세 테이블의 +1 차이와 일치하는 유력 원인이지만, 이번에 같은 snapshot으로 새 백업을 만든 것은 아니므로 확정 복구를 주장하지 않는다. 백업을 검증 성공으로 강제 표시하거나 행 수 비교를 완화하지 않았다.

이 문제는 별도 `ops/backup@059ce7a`의 기존 구현에 존재하며 이번 D-1 앱 변경에 종속되지 않는다. Production 롤백으로 이 백업 코드는 달라지지 않는다. D-1 서비스 프로브·실제 사용자 검증·5xx 조회는 정상이므로 사용자의 최신 유지 요청에 따라 D-1을 유지했다. **다만 백업 운영까지 완전 정상이라고 결론내릴 수는 없다.** [SEC-BACKUP-SNAPSHOT-001](security-followups.md)에 별도 기록했고, 백업 시스템 변경 금지 조건에 따라 수정·재실행·보존 정책 변경은 하지 않았다.

## 후속 작업

- 삭제된 공개 이미지의 CDN 잔존은 [SEC-CDN-DELETE-001](security-followups.md)로 별도 추적한다. D-1 비용 절감 TTL이나 D-2 범위에 몰래 섞지 않는다.
- [D-2 상세 계획](release-d2-plan-2026-11-16.md)을 작성했다. 구현·새 스키마·환경/플랜 변경은 미승인·미실행이다. 전용 작업 테이블 권고 이유와 직접 호출/고정 목적지 분기, Preview 검증·롤백 위험을 명시했다.
- 이 보고서와 읽기 전용 보조 스크립트의 후속 커밋은 배포된 앱 cb3bb71과 구분한다. 서비스 동작 코드가 없어 문서 기록을 위해 Production을 재배포하지 않는다.
