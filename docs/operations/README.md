# MJU Find 운영 문서

운영 지침의 현재 목차입니다. 비밀값·세션 쿠키·개인정보는 이 폴더에 기록하지 않습니다.

| 문서 | 용도 |
| --- | --- |
| [Content 신규 측정 구간](content-measurement.md) | 실제 집계 키 분리, 최초 관측·부분 측정, 활성화·롤백 |
| [DB 접근 보호·통계 무결성](database-safety.md) | 개발·테스트 차단, 운영 작업 승인, 측정 기간 분리 제안 |
| [2026-11-10 통계 점검](statistics-integrity-2026-11-10.md) | 확인 사실, 관련 21행 의미, 원인 가설과 조사 한계 |
| [UTM 운영 표준 v1.0](utm-standard.md) | 명명 규칙, 집계 의미, 용량 제한, 기존 QR 호환성 |
| [QR 발급·설치 등록부](qr-registry.csv) | QR별 URL, 승인된 장소, 발급 준비·설치·회수 상태 |
| [확정 건물 코드](buildings.json) | 운영자가 학생지원팀 확인 결과로 확정한 8개 코드 |
| [포스터 절차](poster-workflow.md) | 생성, 검증, 인쇄, 배부, 점검 |
| [배포·검증·롤백](deployment.md) | 환경 분리, Preview 검증, 배포 기록과 복구 |
| [인수인계](handover.md) | 계정·권한·등록부·현장 상태·미결 사항 전달 |

기존 상세 지침은 복제하지 않고 아래 원문을 연결합니다.

- [기존 운영 가이드](../operations.md): 환경, 비밀 관리, 백업, 보유기간 정리, 장애 대응. 기존 문서의 요금제·도구 버전 등 환경 의존 내용은 실행 전 현재 설정과 대조합니다.
- [관리자 권한](../ADMIN_PERMISSIONS.md): `promotion.manage`, `stats.operations` 등 권한의 기준.
- [물품 운영](../ITEM_OPERATIONS.md), [기관 담당자 운영](../INSTITUTION_OFFICER_REPORT.md).
- [과거 UTM 독립 도구 Preview 검증](../UTM_ADMIN_PREVIEW_REPORT.md): 과거 배포 시점의 기록이며 현행 명명 규칙은 본 폴더의 v1.0을 따릅니다.

문서·CSV 변경은 기능 변경처럼 diff를 검토하고 검증 결과와 함께 전달합니다. 실제 설치·승인 여부가 확인되지 않으면 날짜나 완료 상태를 추정해 채우지 않습니다.
