import streamlit as st

from db import database as db
from ui import auth

st.set_page_config(page_title="알림 - 명지 스마트 분실물 센터", page_icon="🔔", layout="wide")

auth.render_sidebar_auth()

st.title("🔔 알림")

# require_ready_user()만 사용한다 (정지 여부는 검사하지 않음) -- 정지된 사용자도
# 자신의 알림은 조회/읽음 처리할 수 있어야 하기 때문. 기존 데이터 열람과 동일한 정책.
user = auth.require_ready_user("알림을 보려면")
if user is None:
    st.stop()
user_id = user["id"]

PAGE_SIZE = 20
TYPE_LABELS = {
    "message": "새 메시지",
    "match": "새 매칭",
    "report_processed": "신고 처리 결과",
    "post_deleted": "게시물 삭제 제재",
    "message_hidden": "메시지 숨김 제재",
    "user_suspended": "계정 정지",
}

try:
    unread_count = db.count_unread_notifications(user_id)
except Exception as e:
    st.error(f"알림 정보를 불러오는 중 오류가 발생했습니다: {e}")
    unread_count = 0

st.subheader(f"읽지 않은 알림 {unread_count}개")

if st.button("모두 읽음 처리", key="notif_mark_all_read", disabled=(unread_count == 0)):
    try:
        db.mark_all_notifications_as_read(user_id)
    except Exception as e:
        st.error(f"처리 중 오류가 발생했습니다: {e}")
    else:
        st.success("모든 알림을 읽음 처리했습니다.")
        st.rerun()

st.divider()

page = st.session_state.setdefault("notif_page", 0)
offset = page * PAGE_SIZE

try:
    notifications = db.list_notifications_by_user(user_id, limit=PAGE_SIZE + 1, offset=offset)
except Exception as e:
    st.error(f"알림 목록을 불러오는 중 오류가 발생했습니다: {e}")
    notifications = []

has_more = len(notifications) > PAGE_SIZE
notifications = notifications[:PAGE_SIZE]

if not notifications:
    st.info("알림이 없습니다.")


def _handle_confirm(n) -> None:
    # 클릭한 알림이 실제로 본인 것인지 DB에서 다시 검증한 뒤 읽음 처리한다
    # (session_state는 신뢰하지 않는다).
    try:
        db.mark_notification_as_read(n["id"], user_id)
    except db.PermissionDeniedError:
        st.error("본인의 알림만 확인할 수 있습니다.")
        return
    except ValueError as e:
        st.error(f"알림을 처리할 수 없습니다: {e}")
        return

    related_type = n["related_type"]
    related_id = n["related_id"]

    if n["type"] == "message" and related_type == "message" and related_id:
        # related_id(message_id)를 그대로 신뢰해 채팅방을 열지 않고, 메시지를 다시
        # 조회해 chat_room_id를 알아낸다. 실제 접근 권한은 pages/5_채팅.py의
        # get_chat_room()이 다시 검증한다.
        message = db.get_message(related_id)
        if message is None:
            st.warning("관련 메시지를 찾을 수 없습니다. (삭제되었을 수 있어요)")
            st.rerun()
            return
        st.session_state["chat_room_id"] = message["chat_room_id"]
        st.switch_page("pages/5_채팅.py")
    elif n["type"] == "match" and related_type == "match" and related_id:
        # pages/4_내_매칭.py는 list_matches_by_user(user_id)로 본인 매칭만 보여주므로
        # 여기서 별도 소유권 확인 없이 이동해도 안전하다.
        st.switch_page("pages/4_내_매칭.py")
    else:
        # report_processed / post_deleted / message_hidden / user_suspended:
        # 별도의 "내 신고" 조회 페이지가 없으므로 읽음 처리만 하고 알림 페이지에 남는다.
        st.rerun()


for n in notifications:
    with st.container(border=True):
        badge = "🔵 " if not n["is_read"] else ""
        st.markdown(f"{badge}**{n['title']}**  ·  {TYPE_LABELS.get(n['type'], n['type'])}")
        st.write(n["content"])
        st.caption(n["created_at"])
        if st.button("확인", key=f"notif_confirm_{n['id']}"):
            _handle_confirm(n)

pc1, pc2, pc3 = st.columns([1, 1, 4])
if pc1.button("이전 페이지", key="notif_page_prev", disabled=(page == 0)):
    st.session_state["notif_page"] = page - 1
    st.rerun()
if pc2.button("다음 페이지", key="notif_page_next", disabled=(not has_more)):
    st.session_state["notif_page"] = page + 1
    st.rerun()
