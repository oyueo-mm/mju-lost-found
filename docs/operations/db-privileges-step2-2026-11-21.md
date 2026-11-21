# Production DB 잔여 권한 정리 (2단계) — 조사·Preview 검증·리허설 (2026-11-21)

상태: **Preview 적용·검증 완료, Production 백업과 복원 리허설 완료. Production 권한은 변경하지 않았다(사용자 승인 대기).**
도구: `scripts/operations/db-privilege-inventory.mjs`(읽기 전용 전체 조사), `scripts/operations/db-privileges-step2.mjs`(snapshot·plan·verify·apply·restore·reproduce·rehearsal-sql), `scripts/operations/db-privilege-audit.mjs`(요약).

## 1. 조사 결과 (읽기 전용, 두 환경)

- **앱의 DB 역할**: Prisma와 운영 스크립트 모두 `postgres`다. superuser는 아니고 `bypassrls`가 있다. public의 모든 테이블 57개, 시퀀스 40개, 뷰 1개(`OperationalMetricDaily`), 함수 23개를 소유한다. DB 소유자이므로 `pg_database_owner`의 구성원이다. `supabase_admin`의 구성원은 아니다.
- **역할 상속**: `authenticator`는 anon·authenticated·service_role에 속한다(로그인 가능, `NOINHERIT`). `supabase_realtime_admin`도 anon·authenticated·service_role에 속한다. `supabase_storage_admin`은 authenticator에 속한다. `mju_chat_realtime`는 `NOLOGIN NOINHERIT`이고 어떤 역할에도 속하지 않는다.
- **public 스키마**

| | Production | Preview(원래) |
|---|---|---|
| 소유자 | `pg_database_owner` | `postgres` |
| ACL | `pg_database_owner=UC`, **PUBLIC=U**, postgres=U, **anon=U**, **authenticated=U**, service_role=U | NULL(소유자만) |
| 결과 | 모든 역할(Supabase 내부 역할 포함)이 USAGE 보유 | 소유자 외 USAGE 없음, 그래도 Storage·Realtime·cron·백업 정상 |

- **테이블과 뷰**: Production에서는 anon·authenticated·service_role이 테이블 56개와 뷰 1개에 `TRUNCATE/REFERENCES/TRIGGER/MAINTAIN`을 가진다. C-2 테이블만 예외다. 읽기·쓰기(SELECT/INSERT/UPDATE/DELETE)는 모든 역할에서 0이다. 시퀀스 권한과 컬럼 권한은 없다. Preview는 0이다.
- **함수 23개**
  - SECURITY DEFINER 7개(D-3 Realtime: `mju_chat_realtime_receive`, `mju_chat_member_allowed`, `mju_revoke_rt_user`, `mju_rt_*_changed`): 소유자는 postgres, `search_path=pg_catalog, public`이다. 실행 권한은 `mju_chat_realtime`이 receive에만 가지고, 나머지는 소유자만 실행한다(이미 최소 권한).
  - 나머지 15개: 트리거 함수 11개, CHECK 제약 1개(`thank_note_tags_unique`), 통계 SQL 함수다. ACL이 NULL이라 **PUBLIC EXECUTE** 상태다(두 환경 같음). 앱은 소유자로 호출하고, 트리거와 CHECK 제약은 호출하는 역할의 EXECUTE를 다시 검사하지 않는다.
- **정책**: `realtime.messages`의 `mju_chat_private_receive`(TO `mju_chat_realtime`) 하나만 public 함수를 사용한다. public 테이블에는 정책이 없다.
- **default ACL**
  - public, postgres 소유: 새 테이블에 anon·authenticated·service_role `Dxtm`이 상속된다. 시퀀스와 함수는 소유자만이다.
  - public, supabase_admin 소유: 모든 권한이 상속된다. postgres는 이 설정을 바꿀 수 없다(구성원이 아님). 다만 public 객체 98개는 모두 postgres 소유이고, 대시보드 SQL 편집기도 postgres로 실행된다.
  - 함수는 PostgreSQL 전역 기본값에 따라 새로 만들어도 PUBLIC EXECUTE가 붙는다. 스키마 단위로는 제거할 수 없다. 그래서 새 마이그레이션 규칙으로 처리한다(C-2처럼 `REVOKE ... FROM PUBLIC`).
- 기타: public에 확장 없음, pg_cron 없음(cron은 Vercel이 HTTP로 호출). Data API는 두 환경 모두 OFF(503).

## 2. 실제로 필요한 권한

| 사용처 | 필요한 권한 | 정리 후 |
|---|---|---|
| 앱(Prisma), 운영 스크립트, Vercel cron 엔드포인트 | 소유자 postgres(public USAGE·CREATE, 모든 객체 소유) | 유지 |
| 백업(`backup.mjs`: pg_dump, 읽기 전용 행 수, Storage) | postgres + Storage service key | 유지(Preview 백업과 복원 검증 통과) |
| D-3 private Realtime 수신 | `mju_chat_realtime`의 receive 함수 EXECUTE(정책이 OID로 호출, 스키마 USAGE 불필요: Preview가 USAGE 없이 정상) | 유지 |
| SECURITY DEFINER·트리거 함수 | 소유자 권한으로 실행 | 유지 |
| Storage API·Realtime 서버(Supabase 내부) | public 스키마 불필요(Preview 증거) | PUBLIC 경유 USAGE만 제거 |
| anon·authenticated | 앱은 쓰지 않는다(Data API OFF, Supabase Auth 미사용, 공개 Realtime OFF) | **모두 회수** |
| service_role | Storage 업로드 서명, Realtime httpSend(public 테이블과 무관) | 이번 범위에서 **변경 없음**(선택 과제) |

## 3. 회수 SQL (`db-privileges-step2.mjs plan`)

```sql
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON SCHEMA public FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
```
- 한 트랜잭션에서 실행한다(lock_timeout 5초, statement_timeout 60초). `apply`는 실행 전에 ACL 스냅숏을 새 파일로 먼저 쓴다(덮어쓰기 금지).
- 목표 상태 검사(`verify`):
  - 회수 대상: anon·authenticated의 테이블·뷰·시퀀스 권한 0, 스키마 USAGE/CREATE 0, PUBLIC 스키마 항목 0, PUBLIC·anon·authenticated가 실행할 수 있는 public 함수 0, postgres default ACL의 anon·authenticated 0.
  - 유지 대상: postgres USAGE+CREATE, service_role USAGE, receive EXECUTE 유지, member check 비공개.
- 롤백: `restore --from <apply 전 스냅숏> --apply --confirm-<target>`. 스냅숏에 있던 PUBLIC·anon·authenticated 항목을 객체마다 정확히 되돌린다. 소유자는 회수 대상에서 항상 제외한다.

## 4. Preview 검증 (2026-11-21)

1. Production ACL 스냅숏(읽기 전용)을 Preview에 재현했다(`reproduce`, 319문). 스키마 소유자와 항목, 관계 98개, 함수 23개, 테이블 default ACL이 Production과 같아졌다. 재현 전 Preview 원래 상태는 별도 스냅숏으로 보관했다.
2. 재현 상태 기준선: 익명 공개 Realtime `private_only`, 익명 비공개 `authorization_denied`, 서버 private 수신 정상, Data API 503.
3. 적용(6문) 후 `verify` 7/7 통과. 트리거 25개(사용 중), SECURITY DEFINER 7개를 유지했다.
4. 회귀
   - 로컬 17단계 17/17: 인증, 동의, 글 생성, Storage 서명 업로드와 첨부, 이미지·텍스트 큐, 4종 검색, 채팅, private Realtime 수신, 비공개 사진, 알림, 관리자, 삭제.
   - 2인 private Realtime 브라우저 E2E 13/13: polling→private, 양방향, 읽음, fallback·복귀, 재접속, 비참여자 차단.
   - 호스팅 Preview: 이미지 kick 8/8, 텍스트 kick 7/7(maintenance cron 경로와 트리거), 프로브 16/16.
   - Realtime 전송 검사 정상, Data API 503.
   - 새 테이블·시퀀스를 트랜잭션 안에서 만들고 롤백하는 방식으로 상속을 확인: anon·authenticated는 권한 없음, service_role은 그대로(의도).
   - 백업: Preview `backup.mjs`, 암호화 봉인, WSL 격리 복원 통과(테이블 57개 불일치 0, 사진 89개 누락 0, 비공개 채팅 사진 20개).
5. 롤백 검증: 적용 직전 스냅숏으로 `restore`(258문)를 실행해 **적용 전 상태와 정확히 일치**(= 현재 Production 상태)함을 확인했다. 이후 다시 적용했다.
6. 현재 Preview는 **Production 적용 후 목표 상태와 같다**(스키마 소유자 `pg_database_owner`, service_role 항목 유지, 클라이언트 역할 회수). Preview 원래 상태로 돌리려면 `restore --from <preview-original> --all-roles`.

## 5. Production 백업과 복원 리허설

- 백업 `dbpriv-step2-pre-2026-11-21-154725.tar.enc`: 읽기 전용 dump와 Storage, 암호화 왕복, 체크섬 144/144, 격리 복원(테이블 57개 불일치 0, 사진 135개 누락 0).
- 리허설(`protect.ps1 -Rehearse`, `rehearsal-sql`이 생성한 594문). 복원 사본은 `--no-privileges`로 복원되므로 다음 순서로 진행했다. 모든 단계의 내부 검사가 통과했다.
  1. Supabase 역할 생성
  2. Production 현재 ACL 재현과 확인
  3. 회수 6문
  4. 목표 상태 단언(service_role 불변, receive 권한 유지 포함)
  5. 롤백 SQL과 복원 확인
- ACL 스냅숏 보관: `~/mju-lost-found-backups/acl-snapshots/`(Production `prod-snapshot-2026-11-21.json`, sha256 `ee294ecc65c163a5…`, Preview 원래·적용 직전). 공개 저장소이므로 커밋하지 않는다.

## 6. Production 적용 계획 (승인 시)

1. 직전 읽기 전용 스냅숏과 백업. 스냅숏이 위 보관본과 같은지 비교하고, 바뀌었으면 다시 검토한다.
2. `node scripts/db/approved-operation.mjs --confirm-production --approval-reference <REF> -- scripts/operations/db-privileges-step2.mjs apply --snapshot-out <새 파일> --apply --confirm-production`(자체 verify 포함).
3. 직후 확인
   - `db-privilege-audit.mjs`, `text-job-privileges.mjs`, `release-d3.mjs status`
   - Realtime 전송 검사, Data API 503
   - 공개 프로브 16/16, 오류·5xx, Vercel cron(다음 실행) 정상
   - 다음 날 자동 백업과 복원 검증 결과
4. 사용자 확인: 로그인, 글과 사진, 채팅 실시간, 관리자 화면.
5. 문제가 생기면 `restore --from <2의 스냅숏> --apply --confirm-production`(앱 재배포 불필요).

### 위험과 영향
- 앱 동작 영향: 앱은 소유자 역할로만 DB에 접근하므로 예상되는 영향은 없다. Preview에서 전 기능 회귀를 확인했다.
- Supabase 내부 역할의 public USAGE(PUBLIC 경유) 제거: Preview는 원래부터 이 상태로 Storage·Realtime·cron·백업이 정상이었다. Production 전용 설정(예: 대시보드 기능)이 public을 읽는 경우는 확인할 수 없다. 대시보드 Table Editor는 postgres로 동작한다.
- Data API를 나중에 다시 켜면 anon·authenticated가 public을 볼 수 없다. 이는 의도한 결과다. Data API를 쓰려면 별도 설계가 필요하다.
- 남는 항목(이번 범위 밖)
  - service_role의 public `Dxtm`과 USAGE.
  - supabase_admin 소유 default ACL(postgres가 바꿀 수 없다).
  - 함수 전역 기본값의 PUBLIC EXECUTE. 새 함수는 마이그레이션에서 회수한다.
  - storage·graphql 스키마 default ACL(Supabase 관리 영역).
- 잠금: 메타데이터만 바꾸는 짧은 트랜잭션이다. 다만 `ALL TABLES` REVOKE는 각 테이블에 잠깐 잠금을 건다. lock_timeout 5초를 넘기면 전체가 롤백되고, 재시도한다.
