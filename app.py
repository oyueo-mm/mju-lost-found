import streamlit as st

from db import database as db
from ui import auth

st.set_page_config(page_title="명지 스마트 분실물 센터", page_icon="🔎", layout="wide")

auth.render_sidebar_auth()

st.title("명지 스마트 분실물 센터")
st.caption("명지대학교 교내에서 잃어버리거나 습득한 물건을 쉽게 찾을 수 있는 분실물 플랫폼")

if not auth.is_auth_configured():
    st.warning("Google 로그인이 아직 설정되지 않았습니다. `.streamlit/secrets.toml`을 확인해주세요.")
elif not auth.is_logged_in():
    st.write("명지대학교 교내 분실물을 쉽게 찾을 수 있습니다.")
    st.button("Google로 로그인", on_click=st.login, key="main_login_btn")
elif not auth.is_allowed_domain(getattr(st.user, "email", None)):
    st.error("명지대학교 계정(@mju.ac.kr)만 이용할 수 있습니다.")
    st.caption(f"현재 로그인된 계정: {st.user.email}")
    st.button("로그아웃", on_click=st.logout, key="main_logout_btn")
elif auth.current_user()["nickname"] is None:
    auth.render_nickname_setup_notice()
else:
    st.divider()
    col1, col2, col3, col4, col5, col6 = st.columns(6)

    user_id = auth.current_user_id()
    try:
        unread_count = db.count_unread_messages_by_user(user_id)
    except Exception:
        unread_count = 0
    try:
        unread_notification_count = db.count_unread_notifications(user_id)
    except Exception:
        unread_notification_count = 0

    with col1:
        st.subheader("🔍 찾아요")
        st.write("물건을 잃어버렸다면 등록하고, 등록된 습득물과 비교해보세요.")
        st.page_link("pages/1_찾아요.py", label="찾아요 게시판으로 이동", icon="🔍")

    with col2:
        st.subheader("📦 찾았어요")
        st.write("물건을 주웠다면 등록해서 원래 주인을 찾아주세요.")
        st.page_link("pages/2_찾았어요.py", label="찾았어요 게시판으로 이동", icon="📦")

    with col3:
        st.subheader("🗂️ 내 게시물")
        st.write("내가 작성한 게시물을 확인하고 수정·삭제·상태 변경을 할 수 있습니다.")
        st.page_link("pages/3_내_게시물.py", label="내 게시물로 이동", icon="🗂️")

    with col4:
        label = "🔗 내 매칭" if not unread_count else f"🔗 내 매칭 ({unread_count})"
        st.subheader(label)
        st.write("확정한 AI 매칭 결과를 확인하고 필요하면 취소할 수 있습니다.")
        link_label = "내 매칭으로 이동" if not unread_count else f"내 매칭으로 이동 (새 메시지 {unread_count}개)"
        st.page_link("pages/4_내_매칭.py", label=link_label, icon="🔗")

    with col5:
        chat_label = "💬 내 채팅" if not unread_count else f"💬 내 채팅 ({unread_count})"
        st.subheader(chat_label)
        st.write("참여 중인 채팅방을 최근 대화 순으로 확인할 수 있습니다.")
        chat_link_label = "내 채팅으로 이동" if not unread_count else f"내 채팅으로 이동 (새 메시지 {unread_count}개)"
        st.page_link("pages/6_내_채팅.py", label=chat_link_label, icon="💬")

    with col6:
        notif_label = "🔔 알림" if not unread_notification_count else f"🔔 알림 ({unread_notification_count})"
        st.subheader(notif_label)
        st.write("새 메시지·매칭·신고 처리 결과 등의 알림을 확인할 수 있습니다.")
        notif_link_label = (
            "알림으로 이동" if not unread_notification_count
            else f"알림으로 이동 (읽지 않음 {unread_notification_count}개)"
        )
        st.page_link("pages/8_알림.py", label=notif_link_label, icon="🔔")

    # 관리자에게만 노출 -- is_admin은 매번 DB에서 다시 확인하므로 session_state를 신뢰하지 않는다.
    # 다만 이 링크를 숨기는 것 자체가 보안 경계는 아니며, 실제 검증은 pages/7_관리자.py와
    # db.list_reports_for_admin()/db.process_report() 안에서 다시 이루어진다.
    if db.is_admin(user_id):
        st.divider()
        st.subheader("🛡️ 관리자")
        st.write("신고된 게시물/메시지/사용자를 검토하고 처리할 수 있습니다.")
        st.page_link("pages/7_관리자.py", label="관리자 페이지로 이동", icon="🛡️")
