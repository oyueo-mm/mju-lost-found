# 자동 백업 snapshot 일관성 복구 (진행 기록)

11월 16일 실패는 pg_dump 후 별도 READ COMMITTED 조회로 기준 행 수를 기록하는 경합과 일치했다. 로컬 PostgreSQL 18에서 실제 생성·수정·삭제 트랜잭션으로 덤프 2행/후속 기준 3행 불일치를 재현했다.

수정은 REPEATABLE READ READ ONLY exporter의 pg_export_snapshot을 full/public/schema dump 모두에 --snapshot으로 전달하고 같은 연결에서 기준 행 수·마이그레이션·Storage 목록을 읽는다. pg_dump는 비동기 실행하여 exporter의 이벤트 루프/연결을 유지한다. 종료·연결 오류는 자식 프로세스를 abort하고 실패를 롤백한다. SET LOCAL timeout만 사용하며 session 설정과 Production 접근 가드를 변경하지 않았다.

Storage는 같은 DB snapshot의 객체 목록을 백업한다. 뒤에 생긴 새 객체는 그 백업 시점 밖이다. 삭제·교체·버전/갱신시각 변화·크기·가능한 metadata MD5 불일치는 성공으로 처리하지 않는다. 다운로드 후 별도 읽기 전용 조회로 snapshot 객체의 유지 여부를 확인한다. DB와 외부 객체 저장소의 완전한 원자성을 주장하지 않는다. 변동이 있으면 다음 새 백업이 필요하며 검증 기준을 완화하지 않는다.

기존 실패 암호화 파일은 별도 유일한 failed-* 이름으로 보존한 후에만 오늘 슬롯에서 새 백업을 만든다. 기존 정상 파일은 덮어쓰지 않는다. 예약 작업의 standing approval 인자/범위는 그대로다. 이번 1회 검증에는 SkipRetention을 적용하여 모든 기존 정상 백업도 보존한다. 일반 예약 실행의 보존 정책은 바꾸지 않았다.

로컬 실제 복원: 이전 방식 경합 재현, 공유 snapshot full/public dump 각각 행·값 일치, 작업 예외 후 트랜잭션 정리 확인. exporter error/end와 Storage 생성/삭제/교체 모형 검사도 추가했다. Production 복구 백업·암호화·실제 복원 결과는 완료 후 추가한다.

복구 커밋 `0007e21`, ops/backup에 fast-forward 반영. 전체 단위 테스트 256개 파일 2,942/2,942 통과, 변경 JS/TS 린트·PowerShell 구문 검사 통과. 기존 접근 가드·승인 정책 테스트도 통과했다.

승인된 최신 Production 읽기 전용 백업 1회는 실제 ops/backup의 scheduled.ps1 -Quiet -SkipRetention으로 실행했다. 2026-11-16 04:16:21 KST 암호화 파일 `auto-2026-11-16.tar.enc` 실제 복원 검증 성공: 24.6MB, 암호화 왕복 정상, 체크섬 141개 불일치/누락/예상외 파일 0, 51개 테이블 행 수 불일치 0, 이미지 134개 누락 0, Storage 참조 검증 실패 0. 복호화 임시본과 평문 원본은 기존 보호 절차로 정리했다. 기존 실패 파일은 failed-auto-2026-11-16-UUID.tar.enc로 보존하고 정상 표식을 만들지 않았다. 11월 15일 정상 암호화 백업도 그대로다.

백업 복구 게이트를 통과했으므로 별도 D-2 브랜치/커밋에서 구현을 시작할 수 있다. Production 서비스와 DB 스키마/권한에는 변경하지 않았다.
