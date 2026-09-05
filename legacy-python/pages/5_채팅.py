import streamlit as st

from db import database as db
from ui import auth
from ui.common import render_report_control

st.set_page_config(page_title="채팅 - 명지 스마트 분실물 센터", page_icon="💬", layout="wide")

auth.render_sidebar_auth()

st.title("💬 채팅")

user = auth.require_ready_user("채팅을 이용하려면")
if user is None:
    st.stop()
user_id = user["id"]

chat_room_id = st.session_state.get("chat_room_id")
if chat_room_id is None:
    st.info("채팅방이 선택되지 않았습니다. '내 매칭'에서 채팅하기를 눌러주세요.")
    st.page_link("pages/4_내_매칭.py", label="내 매칭으로 이동", icon="🔗")
    st.stop()

# session_state의 chat_room_id는 신뢰하지 않고, 매번 DB에서 실제 접근 권한을 다시 검증한다.
try:
    room = db.get_chat_room(chat_room_id, user_id)
except db.PermissionDeniedError:
    st.error("이 채팅방에 접근할 권한이 없습니다.")
    st.stop()
except ValueError:
    st.error("존재하지 않거나 삭제된 채팅방입니다. (매칭이 취소되었거나 게시물이 삭제되었을 수 있어요)")
    st.stop()
except Exception as e:
    st.error(f"채팅방 정보를 불러오는 중 오류가 발생했습니다: {e}")
    st.stop()

# 채팅방에 실제로 들어온 시점에만 읽음 처리한다 (내 매칭/게시물 상세 등 다른 화면에서는 호출되지 않음).
# 상대방이 보낸 메시지만 대상이며, 내가 보낸 메시지는 건드리지 않는다 -- get_chat_room()으로 이미
# 접근 권한을 확인했으므로 별도 재검증 없이 바로 호출해도 안전하다.
try:
    db.mark_messages_as_read(chat_room_id, user_id)
    db.mark_message_notifications_as_read_for_chat_room(chat_room_id, user_id)
except Exception as e:
    st.error(f"읽음 처리 중 오류가 발생했습니다: {e}")

score_caption = None

if room["match_id"] is not None:
    # 기존 AI 매칭 확정 흐름 -- list_matches_by_user()가 이미 만들어 둔 조인
    # 결과(제목/카테고리 등)를 그대로 재사용한다.
    try:
        my_matches = db.list_matches_by_user(user_id)
    except Exception as e:
        st.error(f"매칭 정보를 불러오는 중 오류가 발생했습니다: {e}")
        st.stop()

    match = next((m for m in my_matches if m["match_id"] == room["match_id"]), None)
    if match is None:
        st.error("연결된 매칭 정보를 찾을 수 없습니다.")
        st.stop()

    if match["lost_post_user_id"] == user_id:
        my_post_label = f"내 분실물: {match['lost_title']}"
        other_post_label = f"상대 습득물: {match['found_title']}"
        other_user_id = match["found_post_user_id"]
    else:
        my_post_label = f"내 습득물: {match['found_title']}"
        other_post_label = f"상대 분실물: {match['lost_title']}"
        other_user_id = match["lost_post_user_id"]
    score_caption = f"AI 유사도 점수: {match['score']:.2f}"
else:
    # 게시글에서 바로 시작한 direct chat -- Match 없이 만들어진 방이라
    # direct_lost_post_id/direct_found_post_id + initiator_user_id로 상대방을
    # 알아낸다. 게시물이 삭제된 경우(방이 아직 CASCADE되지 않은 극히 짧은
    # 경합 구간)에는 상대 정보 없이 안내만 표시한다.
    if room["direct_lost_post_id"] is not None:
        post = db.get_lost_post(room["direct_lost_post_id"])
        post_label = f"찾아요 게시물: {post['title']}" if post else "삭제된 게시물"
    else:
        post = db.get_found_post(room["direct_found_post_id"])
        post_label = f"찾았어요 게시물: {post['title']}" if post else "삭제된 게시물"

    if room["initiator_user_id"] == user_id:
        my_post_label = "직접 문의한 채팅"
        other_user_id = post["user_id"] if post else None
    else:
        my_post_label = "내 게시물에 대한 문의"
        other_user_id = room["initiator_user_id"]
    other_post_label = post_label

other_user = db.get_user_by_id(other_user_id) if other_user_id else None
other_nickname = other_user["nickname"] if other_user else "상대방"

st.subheader(f"{other_nickname}님과의 대화")
st.caption(f"{my_post_label}  ·  {other_post_label}")
if score_caption:
    st.caption(score_caption)
if other_user_id:
    render_report_control("user", other_user_id, button_label=f"🚩 {other_nickname}님 신고하기")
st.divider()

# 페이지네이션 상태는 채팅방별로 분리 보관한다 -- 세션 안에서 다른 채팅방으로
# 이동했다가 돌아와도 서로 섞이지 않는다. messages_key는 지금까지 불러온
# 전체 메시지를 오래된순으로 담아 두는 단일 소스이며, 한 번 들어온 메시지는
# 이후 어떤 재조회에서도 절대 지워지지 않는다(추가만 됨) -- "최신 N개" 구간을
# 매 실행마다 새로 계산해서 잘라내면, 그 사이 총 메시지 수가 늘어났을 때 두
# 구간 사이에 있던 메시지가 통째로 유실될 수 있기 때문이다.
messages_key = f"chat_messages_{chat_room_id}"
has_more_key = f"chat_has_more_{chat_room_id}"
already_loaded = messages_key in st.session_state

try:
    fresh_page = db.list_messages(chat_room_id, user_id, limit=db.MESSAGE_PAGE_SIZE + 1)
except db.PermissionDeniedError:
    st.error("이 채팅방에 접근할 권한이 없습니다.")
    st.stop()
except Exception as e:
    st.error(f"메시지를 불러오는 중 오류가 발생했습니다: {e}")
    fresh_page = []

has_more_fresh = len(fresh_page) > db.MESSAGE_PAGE_SIZE
if has_more_fresh:
    fresh_page = fresh_page[-db.MESSAGE_PAGE_SIZE:]

if not already_loaded:
    # 채팅방에 처음 들어온 시점 -- 최신 페이지로 초기화한다.
    st.session_state[messages_key] = fresh_page
    st.session_state[has_more_key] = has_more_fresh
else:
    # 이미 있는 메시지는 그대로 두고, 아직 없는(새로 도착한) 메시지만 합친다.
    # has_more는 여기서 다시 계산하지 않는다 -- 이 조회는 항상 "최신 쪽"만
    # 보므로 "이전 메시지 불러오기"로 실제 오래된 구간을 조회했을 때의
    # 판정(아래)만 신뢰한다.
    existing_ids = {m["id"] for m in st.session_state[messages_key]}
    newly_seen = [m for m in fresh_page if m["id"] not in existing_ids]
    if newly_seen:
        merged = st.session_state[messages_key] + newly_seen
        merged.sort(key=lambda m: m["id"])
        st.session_state[messages_key] = merged

messages = st.session_state[messages_key]
has_more = st.session_state.get(has_more_key, False)

if not messages:
    st.info("아직 주고받은 메시지가 없습니다. 첫 메시지를 보내보세요.")

if has_more:
    if st.button("이전 메시지 불러오기", key=f"chat_load_more_{chat_room_id}"):
        oldest_loaded_id = messages[0]["id"]
        try:
            older_page = db.list_messages(
                chat_room_id, user_id, limit=db.MESSAGE_PAGE_SIZE + 1, before_id=oldest_loaded_id
            )
        except Exception as e:
            st.error(f"이전 메시지를 불러오는 중 오류가 발생했습니다: {e}")
        else:
            more_exist = len(older_page) > db.MESSAGE_PAGE_SIZE
            if more_exist:
                older_page = older_page[-db.MESSAGE_PAGE_SIZE:]
            st.session_state[messages_key] = older_page + st.session_state[messages_key]
            st.session_state[has_more_key] = more_exist
            st.rerun()

for msg in messages:
    is_mine = msg["sender_user_id"] == user_id
    with st.chat_message("user" if is_mine else "assistant"):
        if not is_mine:
            st.caption(msg["sender_nickname"])
        st.write(msg["content"])
        if is_mine:
            st.caption(f"{msg['created_at']} · {'읽음' if msg['read_at'] else '안 읽음'}")
        else:
            st.caption(msg["created_at"])
            render_report_control("message", msg["id"], button_label="🚩 신고")

new_message = st.chat_input("메시지를 입력하세요")
if new_message:
    try:
        db.send_message(chat_room_id, user_id, new_message)
    except db.PermissionDeniedError as e:
        # send_message() raises this both for "not a participant" and for
        # "suspended account" -- show the specific reason when it's known.
        if str(e) == db.SUSPENDED_ACCOUNT_MESSAGE:
            st.error(str(e))
        else:
            st.error("이 채팅방에 메시지를 보낼 권한이 없습니다.")
    except ValueError:
        st.warning("빈 메시지는 보낼 수 없습니다.")
    except Exception as e:
        st.error(f"메시지 전송 중 오류가 발생했습니다: {e}")
    else:
        st.rerun()
