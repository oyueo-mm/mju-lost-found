import streamlit as st

from ai import embedding
from ai.matching import find_similar_lost_posts
from ai.search import search_similar_posts
from db import database as db
from ui import auth
from ui.common import (
    CATEGORIES,
    format_datetime_input,
    render_ai_match_section,
    render_match_candidates,
    render_report_control,
    resolve_image_path,
    save_uploaded_image,
)

st.set_page_config(page_title="찾았어요 - 명지 스마트 분실물 센터", page_icon="📦", layout="wide")

auth.render_sidebar_auth()

st.title("📦 찾았어요 게시판")
st.caption("주운 물건을 등록해서 원래 주인을 찾아주세요.")

user = auth.require_ready_user("찾았어요 게시판을 이용하려면")
if user is None:
    st.stop()
user_id = user["id"]

tab_list, tab_new = st.tabs(["목록", "새 글 등록"])

# ---------------- 목록 + 상세 ----------------
with tab_list:
    with st.form("found_search_form"):
        search_mode = st.radio(
            "검색 방식", ["키워드 검색", "AI 의미 검색"], horizontal=True, key="found_search_mode"
        )
        c1, c2, c3 = st.columns([2, 1, 1])
        if search_mode == "키워드 검색":
            keyword = c1.text_input("검색어", placeholder="예: 에어팟", key="found_keyword_input")
            status_options = ["전체", "보관 중", "완료"]
        else:
            keyword = c1.text_input(
                "검색어 (문장으로 입력해보세요)",
                placeholder="예: 검은색 에어팟을 도서관에서 잃어버렸어요",
                key="found_ai_query_input",
            )
            status_options = ["전체", "찾는 중", "찾음"]  # AI 모드는 반대편(분실물) 게시판을 검색함
        category_filter = c2.selectbox("카테고리", ["전체"] + CATEGORIES, key="found_category_filter")
        status_filter = c3.selectbox("상태", status_options, key="found_status_filter")
        submitted = st.form_submit_button("검색")

    if search_mode == "키워드 검색":
        try:
            posts = db.search_found_posts(
                keyword=keyword.strip() if keyword else "",
                category=None if category_filter == "전체" else category_filter,
                status=None if status_filter == "전체" else status_filter,
            )
        except Exception as e:
            st.error(f"게시물을 불러오는 중 오류가 발생했습니다: {e}")
            posts = []

        if not posts:
            st.info("조건에 맞는 게시물이 없습니다.")

        for post in posts:
            with st.container(border=True):
                c1, c2 = st.columns([4, 1])
                with c1:
                    st.markdown(f"**{post['title']}**")
                    st.caption(
                        f"{post['category']} · {post['location']} · {post['found_at']} · 상태: {post['status']}"
                    )
                    st.caption(f"작성자: {post['author_nickname']}")
                with c2:
                    if st.button("상세보기", key=f"found_detail_btn_{post['id']}"):
                        st.session_state["selected_found_id"] = post["id"]

    else:  # AI 의미 검색: 문장으로 입력한 특징과 의미가 비슷한 "찾아요"(분실물) 게시물을 찾음
        ai_state_key = "found_ai_search_results"
        if submitted:
            query = (keyword or "").strip()
            if not query:
                st.session_state[ai_state_key] = None
                st.warning("문장으로 검색어를 입력해주세요.")
            else:
                with st.spinner(
                    "AI가 의미가 비슷한 분실물을 찾는 중입니다... "
                    "(모델을 처음 불러오는 경우 다운로드 때문에 다소 시간이 걸릴 수 있어요)"
                ):
                    try:
                        candidates = db.search_lost_posts(
                            category=None if category_filter == "전체" else category_filter,
                            status=None if status_filter == "전체" else status_filter,
                        )
                        st.session_state[ai_state_key] = search_similar_posts(
                            query, candidates, top_k=10
                        )
                    except embedding.EmbeddingUnavailableError:
                        st.session_state[ai_state_key] = None
                        st.error(
                            "현재 AI 검색 기능을 사용할 수 없습니다 (임베딩 모델을 불러오지 못했어요). "
                            "잠시 후 다시 시도해주세요."
                        )
                    except Exception as e:
                        st.session_state[ai_state_key] = None
                        st.error(f"AI 검색 중 오류가 발생했습니다: {e}")

        ai_results = st.session_state.get(ai_state_key)
        if ai_results is None:
            st.info(
                "문장으로 검색어를 입력하고 '검색' 버튼을 눌러보세요. "
                "(예: 검은색 에어팟을 도서관에서 잃어버렸어요)"
            )
        elif not ai_results:
            st.info("의미가 비슷한 분실물을 찾지 못했습니다.")
        else:
            st.write(f"**AI 검색 결과 ({len(ai_results)}건)**")
            render_match_candidates("lost", ai_results, "pages/1_찾아요.py", "selected_lost_id")

    st.session_state.setdefault("selected_found_id", None)
    selected_id = st.session_state.get("selected_found_id")
    if selected_id:
        st.divider()
        try:
            post = db.get_found_post(selected_id)
        except Exception as e:
            st.error(f"게시물을 불러오는 중 오류가 발생했습니다: {e}")
            post = None

        if post is None:
            st.warning("선택한 게시물을 찾을 수 없습니다.")
        else:
            st.subheader(post["title"])
            image_path = resolve_image_path(post["image_url"])
            if image_path:
                st.image(str(image_path), width=300)
            st.write(post["description"])
            st.write(f"**작성자:** {post['author_nickname']}")
            st.write(f"**카테고리:** {post['category']}")
            st.write(f"**장소:** {post['location']}")
            st.write(f"**습득 시간:** {post['found_at']}")
            st.write(f"**상태:** {post['status']}")
            st.write(f"**작성일:** {post['created_at']}")

            st.divider()
            # FoundPost ids are encoded as negative to avoid colliding with
            # LostPost ids for target_type="post" (see db.create_report()).
            render_report_control("post", -post["id"])

            st.divider()
            render_ai_match_section(
                post=post,
                button_label="🤖 AI로 유사한 분실물 찾기",
                find_similar_fn=find_similar_lost_posts,
                list_candidates_fn=db.list_lost_posts,
                result_kind="lost",
                target_page="pages/1_찾아요.py",
                selected_session_key="selected_lost_id",
            )

# ---------------- 새 글 등록 ----------------
with tab_new:
    st.write("주운 물건 정보를 입력해주세요. (* 필수)")
    with st.form("found_new_form", clear_on_submit=True):
        title = st.text_input("제목 *")
        description = st.text_area("설명 *")
        category = st.selectbox("카테고리 *", CATEGORIES, key="found_new_category")
        location = st.text_input("습득 장소 *", placeholder="예: 인문캠퍼스 도서관")
        col_d, col_t = st.columns(2)
        found_date = col_d.date_input("습득 날짜 *")
        found_time = col_t.time_input("습득 시간 *")
        image_file = st.file_uploader("이미지 (선택)", type=["jpg", "jpeg", "png"])
        submitted = st.form_submit_button("등록하기")

    if submitted:
        errors = []
        if not title.strip():
            errors.append("제목을 입력해주세요.")
        if not description.strip():
            errors.append("설명을 입력해주세요.")
        if not location.strip():
            errors.append("습득 장소를 입력해주세요.")

        if errors:
            for err in errors:
                st.error(err)
        else:
            image_url = None
            try:
                image_url = save_uploaded_image(image_file)
            except Exception as e:
                st.error(f"이미지 저장 중 오류가 발생했습니다: {e}")
            else:
                try:
                    new_id = db.create_found_post(
                        user_id=user_id,
                        title=title.strip(),
                        description=description.strip(),
                        category=category,
                        location=location.strip(),
                        found_at=format_datetime_input(found_date, found_time),
                        image_url=image_url,
                    )
                except db.PermissionDeniedError as e:
                    st.error(str(e))
                except ValueError as e:
                    st.error(f"입력값이 올바르지 않습니다: {e}")
                except Exception as e:
                    st.error(f"게시물 등록 중 오류가 발생했습니다: {e}")
                else:
                    st.success("게시물이 등록되었습니다. '목록' 탭에서 확인할 수 있어요.")
                    st.session_state["selected_found_id"] = new_id
