import streamlit as st

from db import database as db
from ui import auth
from ui.common import CATEGORIES, resolve_image_path, save_uploaded_image

st.set_page_config(page_title="내 게시물 - 명지 스마트 분실물 센터", page_icon="🗂️", layout="wide")

auth.render_sidebar_auth()

st.title("🗂️ 내 게시물")

user = auth.require_ready_user("내 게시물을 보려면")
if user is None:
    st.stop()
user_id = user["id"]


def _category_index(category: str) -> int:
    return CATEGORIES.index(category) if category in CATEGORIES else 0


def _render_edit_form(kind: str, post, on_submit) -> None:
    field_label = "분실 시간" if kind == "lost" else "습득 시간"
    date_field = "lost_at" if kind == "lost" else "found_at"

    with st.form(f"{kind}_edit_form_{post['id']}"):
        title = st.text_input("제목 *", value=post["title"])
        description = st.text_area("설명 *", value=post["description"])
        category = st.selectbox("카테고리 *", CATEGORIES, index=_category_index(post["category"]))
        location = st.text_input("장소 *", value=post["location"])
        st.caption(f"{field_label}: {post[date_field]} (수정하려면 게시물을 삭제 후 다시 등록해주세요)")
        image_file = st.file_uploader(
            "이미지 교체 (선택, 비워두면 기존 이미지 유지)",
            type=["jpg", "jpeg", "png"],
            key=f"{kind}_edit_image_{post['id']}",
        )
        submitted = st.form_submit_button("수정 저장")

    if not submitted:
        return

    errors = []
    if not title.strip():
        errors.append("제목을 입력해주세요.")
    if not description.strip():
        errors.append("설명을 입력해주세요.")
    if not location.strip():
        errors.append("장소를 입력해주세요.")

    if errors:
        for err in errors:
            st.error(err)
        return

    fields = dict(
        title=title.strip(),
        description=description.strip(),
        category=category,
        location=location.strip(),
    )
    if image_file is not None:
        try:
            fields["image_url"] = save_uploaded_image(image_file)
        except Exception as e:
            st.error(f"이미지 저장 중 오류가 발생했습니다: {e}")
            return

    try:
        on_submit(post["id"], user_id, **fields)
    except db.PermissionDeniedError:
        st.error("본인 게시물만 수정할 수 있습니다.")
    except ValueError as e:
        st.error(f"입력값이 올바르지 않습니다: {e}")
    except Exception as e:
        st.error(f"수정 중 오류가 발생했습니다: {e}")
    else:
        st.success("게시물이 수정되었습니다.")
        st.rerun()


def _render_delete_control(kind: str, post_id: int, on_delete) -> None:
    confirm_key = f"{kind}_delete_confirm_{post_id}"

    if st.session_state.get(confirm_key):
        st.warning("정말 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.")
        c1, c2 = st.columns(2)
        if c1.button("네, 삭제합니다", key=f"{kind}_delete_yes_{post_id}"):
            try:
                on_delete(post_id, user_id)
            except db.PermissionDeniedError:
                st.error("본인 게시물만 삭제할 수 있습니다.")
            except Exception as e:
                st.error(f"삭제 중 오류가 발생했습니다: {e}")
            else:
                st.session_state.pop(confirm_key, None)
                st.success("게시물이 삭제되었습니다.")
                st.rerun()
        if c2.button("취소", key=f"{kind}_delete_cancel_{post_id}"):
            st.session_state.pop(confirm_key, None)
            st.rerun()
    else:
        if st.button("게시물 삭제", key=f"{kind}_delete_btn_{post_id}"):
            st.session_state[confirm_key] = True
            st.rerun()


def _render_lost_card(post) -> None:
    with st.expander(f"{post['title']}  ·  상태: {post['status']}"):
        st.caption(
            f"{post['category']} · {post['location']} · {post['lost_at']} · 작성일 {post['created_at']}"
        )
        image_path = resolve_image_path(post["image_url"])
        if image_path:
            st.image(str(image_path), width=200)

        if post["status"] == "찾는 중":
            if st.button("찾음으로 상태 변경", key=f"lost_status_{post['id']}"):
                try:
                    db.update_lost_post_status(post["id"], user_id, "찾음")
                except db.PermissionDeniedError:
                    st.error("본인 게시물만 상태를 변경할 수 있습니다.")
                except Exception as e:
                    st.error(f"상태 변경 중 오류가 발생했습니다: {e}")
                else:
                    st.success("상태가 '찾음'으로 변경되었습니다.")
                    st.rerun()
        else:
            st.caption("이미 '찾음' 상태입니다.")

        st.divider()
        st.write("게시물 수정")
        _render_edit_form("lost", post, db.update_lost_post)

        st.divider()
        _render_delete_control("lost", post["id"], db.delete_lost_post)


def _render_found_card(post) -> None:
    with st.expander(f"{post['title']}  ·  상태: {post['status']}"):
        st.caption(
            f"{post['category']} · {post['location']} · {post['found_at']} · 작성일 {post['created_at']}"
        )
        image_path = resolve_image_path(post["image_url"])
        if image_path:
            st.image(str(image_path), width=200)

        if post["status"] == "보관 중":
            if st.button("완료로 상태 변경", key=f"found_status_{post['id']}"):
                try:
                    db.update_found_post_status(post["id"], user_id, "완료")
                except db.PermissionDeniedError:
                    st.error("본인 게시물만 상태를 변경할 수 있습니다.")
                except Exception as e:
                    st.error(f"상태 변경 중 오류가 발생했습니다: {e}")
                else:
                    st.success("상태가 '완료'로 변경되었습니다.")
                    st.rerun()
        else:
            st.caption("이미 '완료' 상태입니다.")

        st.divider()
        st.write("게시물 수정")
        _render_edit_form("found", post, db.update_found_post)

        st.divider()
        _render_delete_control("found", post["id"], db.delete_found_post)


tab_lost, tab_found = st.tabs(["내 찾아요 게시물", "내 찾았어요 게시물"])

with tab_lost:
    try:
        my_lost_posts = db.list_lost_posts_by_user(user_id)
    except Exception as e:
        st.error(f"게시물을 불러오는 중 오류가 발생했습니다: {e}")
        my_lost_posts = []

    if not my_lost_posts:
        st.info("작성한 찾아요 게시물이 없습니다.")
    for post in my_lost_posts:
        _render_lost_card(post)

with tab_found:
    try:
        my_found_posts = db.list_found_posts_by_user(user_id)
    except Exception as e:
        st.error(f"게시물을 불러오는 중 오류가 발생했습니다: {e}")
        my_found_posts = []

    if not my_found_posts:
        st.info("작성한 찾았어요 게시물이 없습니다.")
    for post in my_found_posts:
        _render_found_card(post)
