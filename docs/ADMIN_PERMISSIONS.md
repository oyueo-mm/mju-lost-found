# 관리자 권한 체계 (세부 권한 19개)

검증일 2026-11-03 KST. Preview에서만 구현·검증했다. Production 배포·DB 마이그레이션·계정/환경변수 변경 없음.

## 구조
- 권한 정의는 `src/lib/permissions/definitions.ts` 한 곳(식별자·한글 명칭·설명·분야·프리셋·메뉴). 판단은 `can()`(`check.ts`)만 사용.
- 저장: `AdminPermissionGrant(user_id, permission)` (추가형 테이블). `User.isAdmin`은 전체 관리자로 유지하며 모든 권한을 가진다.
- `권한 관리`(permissions.manage)는 저장되지 않는다. 전체 관리자만 보유하므로 위임할 수 없다. 전체 관리자 지정·해제는 기존 2인 승인 절차(proposals) 그대로.
- 요청마다 `getCurrentUser()`가 DB에서 권한을 다시 읽는다(JWT 신뢰 없음) → 회수는 다음 요청부터 적용.
- 물품 작업은 (1) 작업별 권한 AND (2) `InstitutionOfficer` 담당 기관 범위를 모두 요구한다. 범위가 없으면 권한만으로 처리 불가. 분실물 글 처리는 전체 관리자 전용.
- 의존: 신고 처리→신고 조회, 사용자 제재→사용자 조회(저장 시 자동 추가). 신고에서 게시글 삭제는 `게시글 삭제`, 사용자 정지는 `사용자 제재`도 필요.

## 기존 기능 ↔ 권한
| 권한 | 기존 기능/진입점 |
|---|---|
| 물품 접수·보관·반환·인계·복구 | `PATCH /api/posts/:id` management(confirm / location / complete / transfer_* / reopen·correct_institution·release), `/items` |
| 게시글 관리·삭제 | `/admin/posts`, `/api/admin/posts*`, 타인 댓글 삭제(삭제), 숨김 글 열람 |
| 신고 조회·처리 | `/admin/reports*`, `/api/admin/reports*`, 신고 대화방, 실명 열람(처리) |
| 사용자 조회·제재 | `/admin/users*`, `/api/admin/users*`, 정지/해제, 제재 기록, 이의신청, 재가입 요청 |
| 운영·사용자·관리자 통계 | `/admin/stats` 탭별, 내보내기(Excel은 운영 통계 권한, 사용자 통계 시트는 사용자 통계 권한) |
| 외부 관계자 승인 | `/admin/external-access` |
| 기관 관리 | `/admin/organizations*`, `/admin/organization-requests*`, 물품 보관 기관 등록 |
| 홍보 관리 | 홍보 링크·QR 만들기(UTM) |
| 운영 설정 | 공지, 서비스 의견, Google 테스트 모드 |
| 권한 관리 | 사용자 상세/목록의 관리 권한 설정, 이력 |
| (전체 관리자 전용 유지) | 관리자 조치 제안, 개발 통계 탭, 분실물 글 처리 |

## 마이그레이션 `20261110000000_admin_permissions`
BEGIN/COMMIT 한 트랜잭션. 테이블 추가, 활성 기관 담당자 → 물품 접수·보관·반환·인계 4개 권한(상태 복구는 부여하지 않음 → 권한 확대 없음), 이전 감사행 기록, `mju_activity_role()`을 "권한 1개 이상 = officer(UI: 관리 권한 보유)"로 교체. 과거 이벤트의 저장된 역할은 바꾸지 않는다.

## Production 적용 절차 (승인 후에만)
1. Production DB 백업/PITR 확인(`scripts/backup`).
2. `DIRECT_URL`이 Production인지 확인 후 `npx prisma migrate deploy` → `migrate status`.
3. Preview와 같은 커밋 배포(`vercel deploy --prod`), 기관 담당자가 있었다면 사용자 관리에서 4개 권한·담당 기관 확인.
## 롤백
테이블·감사 기록은 삭제하지 않는다. 앱은 Instant Rollback으로 이전 배포로 되돌릴 수 있으나, 이전 앱은 `InstitutionOfficer`만 보므로 담당자 권한이 유지되고 세부 권한 부여분은 무시된다. `mju_activity_role()`을 이전 정의(담당자 테이블 기준)로 되돌리려면 `20261109000000_institution_officers`의 함수 정의를 재적용한다.

## 검증 도구
`scripts/adminPermissionsPreview.mjs setup|http|validate|cleanup`, `scripts/adminPermissionsPreviewUi.py` (가상 계정만, 종료 시 삭제).
