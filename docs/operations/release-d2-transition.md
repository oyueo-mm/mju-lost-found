# D-2 배포 전환·롤백 절차

대상은 이미지 작업 제어 릴리스다. Production 사용자 콘텐츠 쓰기·전체 재계산·기존 테이블 권한 변경은 이 절차에 포함하지 않는다. 현재 사용자의 D-2 Production 승인과 기존 approved-operation 실행기를 사용한다.

## 구버전 공존 검증과 보완

D-1의 `embed → saveImageEmbedding`은 작업 잠금 없이 추론하고 뒤늦게 벡터 또는 NULL을 저장할 수 있다. DB 벡터 트리거가 유효한 작업 token·generation·lease·현재 이미지 hash를 검사하고 그 밖의 저장은 기존 벡터를 보존한다. 이미지 변경과 큐 등록은 같은 트랜잭션이므로 구버전의 정상 게시글·사진 변경도 유실되지 않는다. 기존 벡터를 일괄 변경하거나 backfill하지 않는다.

초기 D-2 Preview 코드는 작업 테이블을 알지만 새 저장 프로토콜은 모른다. 작업 테이블 트리거가 구형 claim을 반환 행 0으로 거부하여 추론 전에 중단한다. 이미 획득한 구형 작업의 미인증 완료 처리는 pending으로 복구한다. 현재 소스의 구형 운영 도구 진입점도 공통 제어로 연결했다. DB token은 신뢰된 서버 코드의 동시성 규약이며 DB 자격증명을 가진 악의적인 운영자를 막는 인증 체계가 아니다.

D-1은 추론이 DB 쓰기보다 먼저라서 DB 트리거만으로 구형 프로세스의 CPU 사용까지 중지할 수 없다. 따라서 DB 저장 검증과 아래 전환 중 대기 절차를 함께 적용한다. 독립 Preview 프로세스로 A→B, 늦은 D-1 결과/NULL, 구형 D-2 claim/완료, 실제 SIGKILL, 최종 시도 재시도, 작업 일시 정지·복구를 검증한다.

## 순서

1. Git·현재 Production·원격 브랜치·롤백 배포 READY를 대조한다. Git main 병합·강제 Push는 하지 않는다.
2. 전체 테스트·Preview 검증 통과 후 작업 브랜치를 일반 Push한다.
3. ops/backup의 공유 snapshot 백업으로 최신 암호화 아카이브를 생성하고 체크섬·실제 복원과 해당 백업 기반 5개 D-2 마이그레이션 적용·롤백·재적용을 검증한다. 정상·실패 아카이브를 보존한다.
4. `release-d2.mjs preflight`, 이어서 `migrate --apply --confirm-production`을 기존 승인 실행기로 실행한다. 허용된 D-2 5개만 pending일 수 있다. 새 Runtime 행은 disabled로 시작한다. 이 동안 신규 사진의 벡터는 대기하며 텍스트 검색과 사진 표시는 유지한다.
5. 같은 앱 소스의 검증된 커밋을 기존 `scripts/deployments/deploy.mjs production --dry-run`으로 배포한다. 이 dry-run은 DB 배포 이력 recorder만 생략하며 실제 서비스 배포다. Production DeploymentRecord 쓰기를 추가하지 않는다.
6. 공개 `/api/version`의 SHA·배포 ID가 새 D-2인지 대조한다. `release-d2.mjs arm --apply --confirm-production --sha <40자리> --deployment <ID>`를 승인 실행기로 실행한다. 고정 Production URL을 도구도 대조하며, DB의 resume_at은 현재부터 **330초 후**로 설정한다. 이 값은 기존 Fluid Hobby 실행 상한 300초에 30초 여유를 더했다. 기존 배포 보호 all_except_custom_domains와 Skew Protection 비활성 상태를 변경하지 않는다. 불필요한 과거 배포·시드 도구를 직접 실행하지 않는다.
7. 대기 중에도 비파괴 검색·사진·인증 프로브, 문서·D-3 분석을 계속한다. state의 ready=true 이후 큐·실패·5xx를 확인한다. 대량 호출·Production 테스트 데이터·실제 사용자 사진 변경·재계산 요청은 하지 않는다.
8. 신규 작업/Runtime 테이블을 포함하는 백업·복원을 확인하고 운영 결과를 기록한다.

Production 마이그레이션은 기존 벡터/신고 증거에 DML을 하지 않는다. 새 두 테이블의 RLS만 활성화하고 기존 RLS·GRANT·REVOKE·기본 권한은 변경하지 않는다. Runtime 설정 행의 arm/pause와 Prisma migration 이력은 승인된 배포 메타데이터 변경이다.

## 롤백

- 롤백 대상 D-1 `cb3bb71` / `dpl_A8boERKr9cxihEsv5Wp6pmkqovRK` / `https://mju-lost-found-vercel-61isnu31c-oyueo.vercel.app`를 보존한다. 실행 직전 READY·별칭을 다시 확인한다.
- Runtime `pause --apply --confirm-production` 후 신규 D-2 함수의 120초 상한보다 긴 150초 동안 진행 중 작업이 끝날 시간을 둔다. 긴급 장애라면 먼저 이전 배포로 rollback하고 곧바로 pause할 수 있다. token·generation 검증은 기존 D-2 결과의 오래된 저장을 계속 차단한다.
- 기존 CLI `vercel rollback <위 URL> --yes`를 사용하고 공개 버전/핵심 기능을 다시 확인한다.
- **새 테이블·트리거·큐·수집된 신고 증거를 삭제하지 않는다.** D-1 코드와 768차원 기존 벡터는 호환된다. 롤백 중 새 사진 임베딩은 pending으로 보존하고 텍스트 신호로 검색한다. 구버전의 벡터 쓰기는 보존/차단되므로 새 이미지의 AI 추천 즉시 완료는 보장하지 않는다. 수정한 D-2 재배포 후 arm·330초 drain·복구한다. 자동 일간 cron도 D-1 롤백 시 실행되지 않을 수 있어 이를 즉시 처리 SLA로 간주하지 않는다.
- `scripts/fixtures/image-job-rollback`은 격리 로컬 리허설 전용이다. Production에는 실행하지 않는다.

## 재사용 검사

```powershell
node --env-file=.env.preview.local scripts/operations/verify-image-jobs.mjs
node --env-file=.env.preview.local scripts/operations/verify-deployed-image-job.mjs
node scripts/operations/release-probes.mjs preview <SHA> <deployment>
node scripts/operations/release-probes.mjs production <SHA> <deployment>
```

동시성 검사는 Preview Runtime 스위치를 잠깐 사용하므로 16단계 회귀 검사·다른 모델 검사와 **순차 실행**한다. 두 fixture 검사는 생성 즉시 `.vercel`의 실행별 명세에 ID/경로를 기록하고 자신이 만든 데이터만 정리한다. 실모델 검사는 배포된 기본 SigLIP를 사용하며 test double 검증과 구분한다. 프로브는 공개 엔드포인트 조회·비저장 이미지 검색만 수행하고 본문·사진 URL·키·쿠키를 출력하지 않는다. 원본 사진 삭제와 CDN 캐시 잔존은 별도 판정한다.

공개 검색 응답 후 큐 확인은 warm 인스턴스당 15초에 한 번으로 합치며, cron/명시적 drain은 생략하지 않는다. 물리적 exactly-once 추론, 장애 중 즉시 완료, 전체 함수 압축 용량·실제 청구액·운영 p95는 이 절차가 보장하지 않는다.

공식 근거: [PostgreSQL 트리거 실행 순서](https://www.postgresql.org/docs/current/trigger-definition.html), [Vercel 함수 실행 상한](https://vercel.com/docs/functions/configuring-functions/duration), [Skew Protection](https://vercel.com/docs/skew-protection).
