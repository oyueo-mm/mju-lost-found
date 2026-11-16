# D-3 Realtime 권한 백업·재구축

2026-11-16: 공유 `REPEATABLE READ READ ONLY` snapshot, 암호화·체크섬·실제 복원 기준을 유지한다. Production 접근 가드와 `WEEKLY-BACKUP-STANDING`의 스크립트/인자/출력 경로 제한은 변경하지 않았다.

## 포함 범위

- 신규 `ChatRealtimeSession`, `ChatRealtimeGrant`, `ChatRealtimeConfig`는 기존 public/full dump와 정확한 행 수 검증에 자동 포함된다.
- `db/realtime-authorization.json`은 같은 snapshot에서 전용 역할 속성, 자체 SELECT 정책, 유효 메시지 권한, 자체 함수 EXECUTE 권한을 기록한다. 사용자 ID·서명키·발급 JWT를 넣지 않는다.
- `db/realtime-rebuild.sql`은 D-3 전용 역할/정책/함수 ACL만 담는다. 백업 당시 SQL을 함께 봉인하여 이후 저장소 변경과 분리한다. 원본은 `scripts/backup/realtime-rebuild.sql`이며 단위 검사가 마이그레이션의 지정 ACL 블록과 일치하는지 확인한다.
- 서명 private key와 Supabase 프로젝트 설정은 DB dump에 포함되지 않는다. 키는 해당 환경의 승인된 민감 변수·별도 암호화 등록 체크포인트로 관리한다. 키가 없으면 private 발급을 중단하고 인증 API 조회를 사용한다. 기존 활성 키를 임의로 회전하지 않는다.

## 실제 복원 검증

`verify-restore.mjs`는 기존처럼 로컬 빈 DB만 허용한다. public dump의 `--no-privileges` 복원 후 백업에 D-3가 있으면 전용 역할/ACL/정책을 다시 구성하고 메타데이터 전체를 비교한다. D-3 테이블이 있는데 권한 메타데이터/재구축 SQL이 빠지면 실패한다. 행 수·공개 사진·비공개 채팅·신고 증거 검증도 그대로 수행한다.

WSL의 `realtime.messages`/`realtime.topic()`은 **로컬 SQL/RLS 검사 모델**이다. 실제 Supabase Realtime의 JWT 수용·권한 캐시·서버 설정을 검증했다고 주장하지 않는다. 클라우드 재구축은 관리형 realtime 스키마를 그대로 두고 D-3 지정 SQL만 기존 승인 절차로 적용해야 한다. 복원된 세션/권한의 재사용을 막기 위해 서비스 재개 전에 `release-d3.mjs polling --apply`로 기존 grant를 회수하고, 검증된 환경의 키·project를 설정한 뒤 private 모드로 전환한다. 메시지·사진·신고 증거는 삭제하지 않는다.

## 검증 기록

- Preview `preview-d3-2026-11-16-185037.tar.enc`: 암호화 왕복 성공, **117개 체크섬 일치**, 56개 테이블 행 수 불일치 0, 게시글 89개/채팅 19개 이미지 참조 누락 0, 권한 재구축 완전 일치. 신고 증거 참조는 이 Preview snapshot에서 0개이며 검증 경로는 유지한다.
- Production의 기존 정상 `release-d2-post-2026-11-16-070018.tar.enc`를 읽어 격리 복원 후 D-3 6개 마이그레이션을 순서대로 적용했다. 행 수/사진 검증 및 수신 전용 역할·RLS 검증 통과. 원본과 기존 검증 표식은 수정하지 않았다.
- 이는 **새로운 Production 배포 직전 백업을 대체하지 않는다**. Production 키 승인·모든 배포 게이트 통과 후 최신 백업을 다시 생성·복원·리허설한다.

전용 `ops/backup`에는 이 복구 코드와 필요한 D-3 스키마/ACL 원본을 함께 일반 커밋으로 반영한다. 예약 작업의 계정·시간·실행 경로·standing 정책·보존 정책은 바꾸지 않는다. 기존 정상 암호화 백업과 실패 이력도 보존한다.
