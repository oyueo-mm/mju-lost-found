-- ============================================================================
--  27차: 계정 삭제 시 FK 위반 방지 (관리자 활동 흔적 컬럼)
--  reports.resolved_by / app_settings.updated_by 가 profiles(id) 를 non-cascade 로
--  참조해서, 그 사용자를 지우려 하면 FK 위반으로 실패한다. → set null 로 변경.
--  (코드에서도 삭제 전에 null 처리하지만, 근본 수정을 여기서.)
-- ============================================================================

alter table reports drop constraint if exists reports_resolved_by_fkey;
alter table reports
  add constraint reports_resolved_by_fkey
  foreign key (resolved_by) references profiles(id) on delete set null;

alter table app_settings drop constraint if exists app_settings_updated_by_fkey;
alter table app_settings
  add constraint app_settings_updated_by_fkey
  foreign key (updated_by) references profiles(id) on delete set null;

-- 끝.
