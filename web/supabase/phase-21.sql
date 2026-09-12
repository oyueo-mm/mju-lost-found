-- ============================================================================
--  21차: 앱 설정 (베타 모드 토글)
--  Supabase SQL Editor 에 붙여넣고 한 번 실행.
-- ============================================================================

create table if not exists app_settings (
  id         smallint primary key default 1,
  beta_open  boolean not null default true,   -- true = @gmail.com 도 로그인 허용
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id),
  constraint app_settings_singleton check (id = 1)
);

insert into app_settings (id) values (1) on conflict (id) do nothing;

-- 서버(admin client) 전용. 정책 없이 RLS 만 켜면 service_role 외에는 전부 차단됨.
alter table app_settings enable row level security;

-- 끝.
