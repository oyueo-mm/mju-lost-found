import streamlit as st

from db import database as db
from ui import auth

st.set_page_config(page_title="내 채팅 - 명지 스마트 분실물 센터", page_icon="💬", layout="wide")

auth.render_sidebar_auth()

st.title("💬 내 채팅")
st.caption("내가 참여 중인 채팅방을 최근 대화 순으로 확인할 수 있습니다.")

user = auth.require_ready_user("내 채팅을 보려면")
if user is None:
    st.stop()
user_id = user["id"]


def _render_chat_room_card(room) -> None:
    # list_chat_rooms_by_user()가 이미 room_type/other_nickname을 현재
    # user_id 기준으로 계산해서 내려주므로, 여기서는 두 종류를 표시 방식만
    # 다르게 렌더링한다 -- 권한/소유권 판단은 하지 않는다(DB 레이어가 이미
    # user_id로 필터링한 목록만 넘겨준다).
    with st.container(border=True):
        if room["room_type"] == "match":
            title_line = f"**{room['lost_title']}**  ↔  **{room['found_title']}**"
        else:
            title_line = f"💬 {room['post_title']}"
        if room["unread_count"]:
            title_line += f"  🔵 새 메시지 {room['unread_count']}개"
        st.markdown(title_line)

        if room["room_type"] == "match":
            st.caption(f"상대방: {room['other_nickname']}  ·  AI 유사도 점수: {room['score']:.2f}")
        else:
            st.caption(f"상대방: {room['other_nickname']}  ·  게시글에서 바로 시작한 채팅")

        if room["last_message_content"]:
            st.write(room["last_message_content"])
            st.caption(room["last_message_created_at"])
        else:
            st.info("아직 메시지가 없습니다.")

        if st.button("채팅하기", key=f"my_chats_open_{room['chat_room_id']}"):
            st.session_state["chat_room_id"] = room["chat_room_id"]
            st.switch_page("pages/5_채팅.py")


try:
    my_chat_rooms = db.list_chat_rooms_by_user(user_id)
except Exception as e:
    st.error(f"채팅방 목록을 불러오는 중 오류가 발생했습니다: {e}")
    my_chat_rooms = []

if not my_chat_rooms:
    st.info("아직 시작한 채팅이 없습니다. '내 매칭'에서 채팅하기를 눌러 대화를 시작해보세요.")
    st.page_link("pages/4_내_매칭.py", label="내 매칭으로 이동", icon="🔗")
else:
    for room in my_chat_rooms:
        _render_chat_room_card(room)
