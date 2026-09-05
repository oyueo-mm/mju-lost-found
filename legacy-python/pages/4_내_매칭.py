import streamlit as st

from db import database as db
from ui import auth
from ui.common import render_report_control

st.set_page_config(page_title="내 매칭 - 명지 스마트 분실물 센터", page_icon="🔗", layout="wide")

auth.render_sidebar_auth()

st.title("🔗 내 매칭")
st.caption("내가 확정한 AI 매칭 결과를 확인하고, 필요하면 취소할 수 있습니다.")

user = auth.require_ready_user("내 매칭을 보려면")
if user is None:
    st.stop()
user_id = user["id"]


def _render_cancel_control(match_id: int) -> None:
    confirm_key = f"match_cancel_confirm_{match_id}"

    if st.session_state.get(confirm_key):
        st.warning("정말 매칭을 취소하시겠습니까?")
        c1, c2 = st.columns(2)
        if c1.button("네, 취소합니다", key=f"match_cancel_yes_{match_id}"):
            try:
                db.delete_match(match_id, user_id)
            except db.PermissionDeniedError:
                st.error("본인과 관련된 매칭만 취소할 수 있습니다.")
            except ValueError:
                # already gone (e.g. cancelled from another tab) -- clear the
                # stale confirmation and let the list refresh instead of
                # leaving the user stuck on a card that no longer exists.
                st.info("이미 취소된 매칭입니다.")
                st.session_state.pop(confirm_key, None)
                st.rerun()
            except Exception as e:
                st.error(f"매칭 취소 중 오류가 발생했습니다: {e}")
            else:
                st.session_state.pop(confirm_key, None)
                st.success("매칭이 취소되었습니다.")
                st.rerun()
        if c2.button("취소", key=f"match_cancel_cancel_{match_id}"):
            st.session_state.pop(confirm_key, None)
            st.rerun()
    else:
        if st.button("매칭 취소", key=f"match_cancel_btn_{match_id}"):
            st.session_state[confirm_key] = True
            st.rerun()


def _render_chat_control(match_id: int) -> None:
    if st.button("채팅하기", key=f"match_chat_{match_id}"):
        try:
            room = db.get_or_create_chat_room(match_id, user_id)
        except db.PermissionDeniedError:
            st.error("본인과 관련된 매칭만 채팅할 수 있습니다.")
        except ValueError as e:
            st.error(f"채팅방을 열 수 없습니다: {e}")
        except Exception as e:
            st.error(f"채팅방을 여는 중 오류가 발생했습니다: {e}")
        else:
            st.session_state["chat_room_id"] = room["id"]
            st.switch_page("pages/5_채팅.py")


def _render_match_card(match) -> None:
    is_lost_owner = match["lost_post_user_id"] == user_id
    is_found_owner = match["found_post_user_id"] == user_id

    other_nickname = match["found_user_nickname"] if is_lost_owner else match["lost_user_nickname"]
    other_user_id = match["found_post_user_id"] if is_lost_owner else match["lost_post_user_id"]

    with st.container(border=True):
        title_line = f"**{match['lost_title']}**  ↔  **{match['found_title']}**"
        if match["unread_count"]:
            title_line += f"  🔵 새 메시지 {match['unread_count']}개"
        st.markdown(title_line)

        roles = []
        if is_lost_owner:
            roles.append("내가 분실자(찾아요 작성자)")
        if is_found_owner:
            roles.append("내가 습득자(찾았어요 작성자)")
        st.caption(" · ".join(roles))
        st.caption(f"상대방: {other_nickname}")
        render_report_control(
            "user",
            other_user_id,
            button_label=f"🚩 {other_nickname}님 신고하기",
            key_suffix=f"match_{match['match_id']}_user_{other_user_id}",
        )

        col_lost, col_found = st.columns(2)
        with col_lost:
            st.write("**찾아요 (분실물)**")
            st.caption(
                f"{match['lost_category']} · {match['lost_location']} · "
                f"{match['lost_at']} · 상태: {match['lost_status']}"
            )
        with col_found:
            st.write("**찾았어요 (습득물)**")
            st.caption(
                f"{match['found_category']} · {match['found_location']} · "
                f"{match['found_at']} · 상태: {match['found_status']}"
            )

        st.caption(f"AI 유사도 점수: {match['score']:.2f} (높을수록 의미가 비슷합니다)")
        st.caption(f"매칭 확정일: {match['match_created_at']}")

        c1, c2, c3 = st.columns(3)
        with c1:
            if is_lost_owner:
                if st.button("상대 게시물(습득물) 상세보기", key=f"match_goto_found_{match['match_id']}"):
                    st.session_state["selected_found_id"] = match["found_post_id"]
                    st.switch_page("pages/2_찾았어요.py")
            if is_found_owner:
                if st.button("상대 게시물(분실물) 상세보기", key=f"match_goto_lost_{match['match_id']}"):
                    st.session_state["selected_lost_id"] = match["lost_post_id"]
                    st.switch_page("pages/1_찾아요.py")
        with c2:
            _render_chat_control(match["match_id"])
        with c3:
            _render_cancel_control(match["match_id"])


try:
    my_matches = db.list_matches_by_user(user_id)
except Exception as e:
    st.error(f"매칭 목록을 불러오는 중 오류가 발생했습니다: {e}")
    my_matches = []

if not my_matches:
    st.info("아직 확정된 매칭이 없습니다. 게시물 상세 페이지의 'AI로 유사한 OO 찾기' 결과에서 '내 물건 같아요'를 눌러 매칭을 확정해보세요.")
else:
    for match in my_matches:
        _render_match_card(match)
