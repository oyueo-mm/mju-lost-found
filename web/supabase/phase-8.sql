-- ============================================================================
--  8차: 권한 등급 (운영자 > 관리자 > 일반) + 신분(학생/교수)
-- ============================================================================

alter table profiles add column if not exists role text not null default 'user'
  check (role in ('owner', 'admin', 'user'));
alter table profiles add column if not exists member_type text;

-- 기존 관리자를 운영자로, 나머지는 일반
update profiles set role = 'owner'
  where is_admin = true and email = 'ysm0608020@mju.ac.kr';
update profiles set role = 'admin'
  where is_admin = true and role = 'user';

-- is_admin 은 role 의 미러 (일부 RLS 정책이 참조)
update profiles set is_admin = (role in ('owner', 'admin'));

-- 신분(학생/교수/직원) = 이름의 두 번째 조각
update profiles
set member_type = trim(split_part(name, '/', 2))
where member_type is null
  and name like '%/%/%'
  and trim(split_part(name, '/', 2)) in ('학생', '교수', '직원', '조교', '연구원');

-- 신규 가입 시 학과 + 신분 자동 세팅
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  nm text;
  last_part text;
  second_part text;
begin
  nm := coalesce(
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'name',
    split_part(new.email, '@', 1)
  );
  last_part := nullif(trim(split_part(nm, '/', -1)), '');
  second_part := nullif(trim(split_part(nm, '/', 2)), '');

  insert into public.profiles (id, email, name, major, member_type)
  values (
    new.id, new.email, nm,
    case
      when nm not like '%/%' then null
      when last_part in ('학생','교수','직원','조교','연구원')
        then nullif(trim(split_part(nm, '/', -2)), '')
      else last_part
    end,
    case
      when second_part in ('학생','교수','직원','조교','연구원')
        then second_part
      else null
    end
  )
  on conflict (id) do nothing;
  return new;
end; $$;
