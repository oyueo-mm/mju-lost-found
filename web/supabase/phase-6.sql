-- ============================================================================
--  6차: 학과 자동 세팅 (구글 계정 이름에서 추출)
--  Supabase SQL Editor 에 붙여넣고 한 번 실행.
-- ============================================================================

-- 기존 프로필: "이름/신분/학과" 형태에서 학과 부분 추출
update profiles
set major = case
  when nullif(trim(split_part(name, '/', -1)), '') in
       ('학생', '교수', '직원', '조교', '연구원')
    then nullif(trim(split_part(name, '/', -2)), '')
  else nullif(trim(split_part(name, '/', -1)), '')
end
where (major is null or major = '') and name like '%/%';

-- 신규 가입 시 학과 자동 세팅
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  nm text;
  last_part text;
begin
  nm := coalesce(
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'name',
    split_part(new.email, '@', 1)
  );
  last_part := nullif(trim(split_part(nm, '/', -1)), '');

  insert into public.profiles (id, email, name, major)
  values (
    new.id, new.email, nm,
    case
      when nm not like '%/%' then null
      when last_part in ('학생', '교수', '직원', '조교', '연구원')
        then nullif(trim(split_part(nm, '/', -2)), '')
      else last_part
    end
  )
  on conflict (id) do nothing;
  return new;
end; $$;
