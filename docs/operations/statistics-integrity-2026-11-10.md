# 2026-11-10 통계 무결성 점검

상태: **Production 배포 중단 유지**. 원인·증가량을 확정하지 못했습니다. DB 표식·통계 삭제, 감산, 재계산과 측정 시작일 변경은 하지 않았습니다. 보호 구현과 후속 측정 구간 분리 제안은 [DB 접근 보호](database-safety.md)를 참고합니다.

## 확인한 사실

- Production의 현행 배포는 `3bf44fc40a42f39cefa17f25c63213ec9907c28d` / `dpl_E6n2rAfxV9sceVy5WshnwBt9Jz7j`입니다. 그 소스에는 Content 표식 기록 코드가 없습니다.
- 원본 MetricDaily에 `2026-11-09 / meta.since.utm_content / 1`이 있습니다. 마지막 행 버전의 xmin은 13126입니다.
- 이전 조사와 이번 읽기 전용 조회에서 같은 xmin의 MetricDaily 20행과 ApiMetricHourly 1행이 남아 있습니다. 이 행들은 실제로 같은 트랜잭션에서 마지막 갱신됐지만 최초 생성 주체·정확한 증가량을 뜻하지 않습니다.
- 11월 10일 이전 MetricDaily 1,525행 해시는 `538005812ef71020906739454a72a844`로 앞선 조사와 같습니다. 사용자 22·습득물 77·분실물 2입니다. 이 비교는 개별 회원·게시글 내용 전체의 불변을 입증하지 않습니다.
- Production UTM에는 기존 Instagram 1세션과 새 시작 표식만 확인됩니다. 포스터 캠페인·Content·pair 카운터는 확인되지 않았습니다.
- Preview는 다른 프로젝트이며 표준/UI 배포의 runtime 이력과 당시 검증 Content 집계가 Preview DB에 있습니다. 확인한 Preview 검증 경로는 Preview 도메인과 Preview DB를 사용했습니다. 모든 과거 요청의 오접속을 배제한 것은 아닙니다.

## 관련 20개 MetricDaily 행

아래 값은 **현재 일별 누적값**입니다. 해당 트랜잭션에서 이만큼 증가했다고 해석하거나 모두 테스트 방문으로 분류하지 않습니다. 접두사 `audience_v3.`는 표에서 생략했습니다.

| 측정 항목 | 현재 값 | 의미 |
| --- | ---: | --- |
| visit.anon.hour.16 | 1 | KST 16시 익명 페이지 조회 |
| visit.device.pc.pv | 6 | PC 페이지 조회 |
| visit.device.pc.session | 5 | PC 세션 시작 |
| visit.entry.ref.internal.home | 5 | 같은 사이트 참조 유입의 홈 진입 세션 |
| visit.flow.closed | 4 | 종료된 방문 흐름 |
| visit.flow.dur.lt10s.pc | 4 | 10초 미만 PC 방문 흐름 |
| visit.flow.endhour.16 | 1 | 마지막 활동이 KST 16시인 흐름 |
| visit.flow.exit.home.pc | 5 | 홈을 마지막 화면으로 기록한 PC 흐름 |
| visit.flow.open | 1 | 아직 종료되지 않은 흐름 |
| visit.flow.pages.1 | 4 | 조회 화면 수 1인 흐름 |
| visit.flow.path.home.home | 5 | 홈에서 시작해 홈에서 끝난 흐름 |
| visit.flow.sessions.pc | 5 | PC 흐름 통계 대상 세션 |
| visit.page.home.anon | 6 | 익명 홈 조회 |
| visit.pv.anon | 6 | 익명 페이지 조회 |
| visit.ref.internal | 5 | 같은 사이트 참조 유입 세션 |
| visit.session.anon | 5 | 익명 세션 시작 |
| visit.src.ref.internal.anon | 5 | 같은 사이트 참조 유입의 익명 세션 |
| visit.start.hour.16 | 1 | KST 16시에 시작한 세션 |
| visit.start.page.home | 5 | 홈에서 시작한 세션 |
| meta.since.utm_content (접두사 없음) | 1 | Content 수집 코드가 일반 세션 시작에서 기록한 표식 |

`ref.internal`은 관리자 계정이라는 뜻이 아닙니다. 관리자 제외는 별도의 계정 분류로 판단합니다. 개발 서버의 익명 브라우저는 정상 익명 방문과 같은 규칙으로 집계될 수 있었습니다.

ApiMetricHourly 행은 `hour=2026-11-09 07:00:00`(UTC 시간 버킷, KST 16시), `route=db:ping`, count=21, errors=0, total_ms=1389입니다. 통계 flush가 DB 지연 시간을 측정한 누적값이며 21개의 사용자 요청이나 21개의 테스트 방문을 뜻하지 않습니다. 시간 버킷은 정확한 DB 커밋 시각이 아닙니다.

## 가능성이 높은 원인

보관된 작업 세션에는 표식 기록 코드 패치가 11월 9일 16:58:56.895 KST에 요청되고 16:58:59.691에 완료된 기록이 있습니다. 당시 실행 중이던 Next 개발 서버 로그에는 컴파일 후 `landing.ts` 변경으로 전체 새로고침한 기록이 있으며, 프로세스 시작 시각에 대입하면 대략 16:59경과 부합합니다. 기본 `.env`는 운영 DB를 가리켰습니다. 관련 행의 16시·PC·익명 홈 방문 분류도 이 경로와 부합합니다.

따라서 **운영 연결을 가진 로컬 개발 서버가 코드 변경을 자동 반영하고 열린 익명 페이지를 새로고침한 경로가 유력**합니다. 당시 프로세스 환경변수 override, HTTP 요청 ID와 DB 트랜잭션의 대응은 복원하지 못했으므로 확정하지 않습니다. 거래 번호만으로 Preview나 특정 사용자를 원인으로 지목하지 않습니다.

## 확인하지 못한 사항

- MetricDaily에는 생성 시각·요청 출처가 없고 `track_commit_timestamp=off`입니다.
- 조사 시점 설정은 `log_statement=ddl`, `log_connections=off`이며 pgaudit 확장은 확인되지 않았습니다. pg_stat_statements는 누적 쿼리 통계이지 과거 행별 쓰기 감사 기록이 아닙니다. 이 설정이 당시에도 같았다고 단정하지 않습니다.
- 제공업체 관리 로그 조회 권한·토큰은 이번 세션에서 확보되지 않았습니다. 앞선 요청 로그 조회도 문제 시간대를 제공하지 않았습니다. 로그가 보이지 않는 것을 요청이 없었다는 증거로 사용하지 않습니다.
- xmin은 마지막 행 버전이므로 이후 갱신·삭제된 행이나 이전 값까지 보여 주지 않습니다. 21행을 전체 영향의 상한으로 간주하지 않습니다.
- 정상 서비스 요청과 개발 요청의 정확한 구분·증가량·생성 주체·정확한 커밋 시각은 미확인입니다.

## 영향과 처리 판단

표식 자체는 현행 Production 통계에서 판독되지 않습니다. 그러나 같은 트랜잭션의 방문·흐름·DB 지연 카운터는 기존 통계에 쓰일 수 있으므로 영향이 없다고 할 수 없습니다. 신규 UTM 코드를 그대로 배포하면 미확인 표식이 11월 9일부터의 측정 범위로 사용됩니다.

데이터를 임의로 수정할 근거가 없습니다. 원본을 보존하고 이 날짜의 영향 가능성을 운영 기록으로 남깁니다. 향후 정상 Content 측정은 기존 값과 자동 합산하지 않는 별도 측정 구간 설계가 필요합니다. 보호 코드 검증 성공은 과거 통계가 오염되지 않았다는 증명이 아니며, 그 자체로 Production 배포 재개 조건을 충족하지 않습니다.
