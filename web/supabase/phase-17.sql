-- ============================================================================
--  17차: 명지도 (신뢰도) — 당근마켓 매너온도 방식
--  · 모두 50%에서 시작, 최대 100%
--  · 채팅방에서 양측이 "거래 완료"에 동의하면 양쪽 +0.5%p
-- ============================================================================

alter table profiles add column if not exists trust_score numeric(5,1) not null default 50
  check (trust_score >= 0 and trust_score <= 100);

alter table chat_rooms add column if not exists deal_confirmed_a boolean not null default false;
alter table chat_rooms add column if not exists deal_confirmed_b boolean not null default false;
alter table chat_rooms add column if not exists deal_completed_at timestamptz;

-- 거래 완료 동의. 양측이 모두 누르면 한 번만 양쪽 명지도 +0.5%p.
create or replace function confirm_deal(p_room_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r        chat_rooms%rowtype;
  me       uuid := auth.uid();
  award    numeric := 0.5;
  v_both   boolean;
begin
  if me is null then
    return jsonb_build_object('error', '로그인이 필요해요.');
  end if;

  select * into r from chat_rooms where id = p_room_id for update;
  if not found then
    return jsonb_build_object('error', '채팅방을 찾을 수 없어요.');
  end if;
  if me <> r.user_a and me <> r.user_b then
    return jsonb_build_object('error', '권한이 없어요.');
  end if;
  if r.deal_completed_at is not null then
    return jsonb_build_object('ok', true, 'completed', true, 'already', true,
      'confirmed_a', r.deal_confirmed_a, 'confirmed_b', r.deal_confirmed_b);
  end if;

  if me = r.user_a then
    update chat_rooms set deal_confirmed_a = true where id = p_room_id;
    r.deal_confirmed_a := true;
  else
    update chat_rooms set deal_confirmed_b = true where id = p_room_id;
    r.deal_confirmed_b := true;
  end if;

  v_both := r.deal_confirmed_a and r.deal_confirmed_b;

  if v_both then
    update chat_rooms set deal_completed_at = now()
      where id = p_room_id and deal_completed_at is null;
    if found then
      update profiles set trust_score = least(100, trust_score + award)
        where id in (r.user_a, r.user_b);
    end if;
  end if;

  return jsonb_build_object(
    'ok', true,
    'completed', v_both,
    'confirmed_a', r.deal_confirmed_a,
    'confirmed_b', r.deal_confirmed_b,
    'award', award
  );
end;
$$;

revoke all on function confirm_deal(bigint) from public;
grant execute on function confirm_deal(bigint) to authenticated;
