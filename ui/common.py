import uuid
from datetime import date, time
from pathlib import Path

import streamlit as st

from ai import embedding
from db import database as db
from ui import auth

PROJECT_ROOT = Path(__file__).resolve().parent.parent
UPLOAD_DIR = PROJECT_ROOT / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

CATEGORIES = ["전자기기", "필기구", "책", "지갑", "카드", "의류", "가방", "액세서리", "기타"]
REPORT_REASONS = ["사기/허위 정보", "부적절한 내용", "욕설/비방", "개인정보 노출", "도배/스팸", "기타"]

# st.file_uploader(type=["jpg", "jpeg", "png"]) only restricts the browser's
# file picker -- a crafted multipart request can name the file anything, so
# save_uploaded_image() re-checks the suffix itself before writing to disk.
ALLOWED_IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png"}


def save_uploaded_image(uploaded_file) -> str | None:
    """Save an uploaded image under uploads/ and return its project-relative path.

    Raises ValueError if the file's extension isn't one of
    ALLOWED_IMAGE_SUFFIXES (case-insensitive) -- st.file_uploader's own
    type=[...] restriction is client-side only, so this is the actual
    enforcement point.
    """
    if uploaded_file is None:
        return None
    suffix = Path(uploaded_file.name).suffix.lower()
    if suffix not in ALLOWED_IMAGE_SUFFIXES:
        raise ValueError(f"허용되지 않는 파일 형식입니다: {suffix or '(확장자 없음)'}")
    filename = f"{uuid.uuid4().hex}{suffix}"
    dest = UPLOAD_DIR / filename
    dest.write_bytes(uploaded_file.getbuffer())
    return str(dest.relative_to(PROJECT_ROOT)).replace("\\", "/")


def resolve_image_path(image_url: str | None) -> Path | None:
    if not image_url:
        return None
    path = PROJECT_ROOT / image_url
    return path if path.exists() else None


def format_datetime_input(date_value: date, time_value: time) -> str:
    return f"{date_value.isoformat()} {time_value.strftime('%H:%M')}"


def _render_confirm_match_control(kind: str, source_post_id: int, candidate_post, score: float) -> None:
    """"내 물건 같아요" button for a candidate card. kind is the *candidate's*
    type: "found" means the candidate is a FoundPost and source_post_id is
    the LostPost being viewed; "lost" is the mirror image."""
    if kind == "found":
        lost_post_id, found_post_id = source_post_id, candidate_post["id"]
    else:
        lost_post_id, found_post_id = candidate_post["id"], source_post_id

    confirmed_key = f"match_confirmed_{lost_post_id}_{found_post_id}"
    if st.session_state.get(confirmed_key):
        st.caption("✅ 매칭이 확정되었습니다.")
        return

    existing = db.get_match_by_posts(lost_post_id, found_post_id)
    if existing is not None:
        st.session_state[confirmed_key] = True
        st.caption("이미 매칭된 게시물입니다.")
        return

    user_id = auth.current_user_id()
    if user_id is None:
        st.caption("로그인하면 매칭을 확정할 수 있어요.")
        return

    if st.button("내 물건 같아요", key=f"confirm_match_{lost_post_id}_{found_post_id}"):
        try:
            db.create_match(lost_post_id, found_post_id, score, user_id)
        except db.PermissionDeniedError as e:
            # create_match() raises the same exception type for two distinct
            # reasons (not owning either post, or being suspended) --
            # db.SUSPENDED_ACCOUNT_MESSAGE lets us show the right one instead
            # of always defaulting to the ownership message.
            if str(e) == db.SUSPENDED_ACCOUNT_MESSAGE:
                st.error(str(e))
            else:
                st.error("본인 게시물에 대해서만 매칭을 확정할 수 있습니다.")
        except ValueError as e:
            st.error(f"매칭을 확정할 수 없습니다: {e}")
        except Exception as e:
            st.error(f"매칭 확정 중 오류가 발생했습니다: {e}")
        else:
            st.session_state[confirmed_key] = True
            st.success("매칭이 확정되었습니다.")
            st.rerun()


def render_match_candidates(
    kind: str,
    results: list,
    target_page: str,
    selected_session_key: str,
    *,
    source_post_id: int | None = None,
) -> None:
    """Render AI match/search result cards. kind is the type of each
    candidate post ("found" or "lost"), which decides which fields/labels to
    show.

    source_post_id: id of the post the candidates are being compared
    against (e.g. the LostPost whose detail page this is). When given, each
    card also gets a "내 물건 같아요" button to confirm the match into the
    Match table. Omitted for free-text AI search results, which have no
    single source post to pair against.
    """
    date_field = "found_at" if kind == "found" else "lost_at"
    date_label = "습득 시간" if kind == "found" else "분실 시간"

    for candidate in results:
        post = candidate.post
        with st.container(border=True):
            cols = st.columns([1, 3, 1])
            image_path = resolve_image_path(post["image_url"])
            with cols[0]:
                if image_path:
                    st.image(str(image_path), width=100)
            with cols[1]:
                st.markdown(f"**{post['title']}**")
                st.caption(
                    f"{post['category']} · {post['location']} · {date_label}: {post[date_field]}"
                )
                st.caption(f"작성자: {post['author_nickname']}")
                st.write(post["description"])
                st.caption(f"AI 유사도 점수: {candidate.score:.2f} (높을수록 의미가 비슷합니다)")
            with cols[2]:
                if st.button("상세보기", key=f"ai_match_goto_{kind}_{post['id']}"):
                    st.session_state[selected_session_key] = post["id"]
                    st.switch_page(target_page)
                if source_post_id is not None:
                    _render_confirm_match_control(kind, source_post_id, post, candidate.score)


def render_report_control(
    target_type: str,
    target_id: int,
    *,
    button_label: str = "🚩 신고하기",
    key_suffix: str | None = None,
) -> None:
    """Shared report button + reason/detail form + submit, reused for posts
    (pages/1,2), chat messages and the other participant (pages/5, 4/6).

    All validation (target exists, no self-report, no duplicate) happens in
    db.create_report() -- this function is presentation only, so there's no
    separate security surface to keep in sync.
    """
    user_id = auth.current_user_id()
    if user_id is None:
        return  # entry points only render on already-authorized pages

    suffix = key_suffix or f"{target_type}_{target_id}"
    open_key = f"report_open_{suffix}"
    done_key = f"report_done_{suffix}"

    if st.session_state.get(done_key):
        st.caption("✅ 신고가 접수되었습니다.")
        return

    if not st.session_state.get(open_key):
        if st.button(button_label, key=f"report_btn_{suffix}"):
            st.session_state[open_key] = True
            st.rerun()
        return

    with st.form(f"report_form_{suffix}"):
        reason = st.selectbox("신고 사유", REPORT_REASONS, key=f"report_reason_{suffix}")
        detail = st.text_area("상세 내용 (선택)", key=f"report_detail_{suffix}")
        c1, c2 = st.columns(2)
        submitted = c1.form_submit_button("신고 제출")
        cancelled = c2.form_submit_button("취소")

    if cancelled:
        st.session_state.pop(open_key, None)
        st.rerun()

    if submitted:
        try:
            db.create_report(user_id, target_type, target_id, reason, detail)
        except ValueError as e:
            st.error(str(e))
        else:
            st.session_state.pop(open_key, None)
            st.session_state[done_key] = True
            st.success("신고가 접수되었습니다.")
            st.rerun()


def render_ai_match_section(
    *,
    post,
    button_label: str,
    find_similar_fn,
    list_candidates_fn,
    result_kind: str,
    target_page: str,
    selected_session_key: str,
) -> None:
    """Shared "AI로 유사한 OO 찾기" button + result list, used by both the
    찾아요 and 찾았어요 detail views (mirrored, only the direction differs).

    find_similar_fn: ai.matching.find_similar_found_posts or find_similar_lost_posts
    list_candidates_fn: db.list_found_posts or db.list_lost_posts (called fresh on each click)
    """
    state_key = f"ai_match_result_{result_kind}_{post['id']}"

    if st.button(button_label, key=f"ai_match_btn_{result_kind}_{post['id']}"):
        with st.spinner(
            "AI가 유사한 게시물을 찾는 중입니다... (모델을 처음 불러오는 경우 다운로드 때문에 다소 시간이 걸릴 수 있어요)"
        ):
            try:
                candidates = list_candidates_fn()
                results = find_similar_fn(post, candidates, top_k=5)
            except embedding.EmbeddingUnavailableError:
                st.session_state[state_key] = None
                st.error(
                    "현재 AI 매칭 기능을 사용할 수 없습니다 (임베딩 모델을 불러오지 못했어요). "
                    "잠시 후 다시 시도해주세요."
                )
            except Exception as e:
                st.session_state[state_key] = None
                st.error(f"유사 게시물을 찾는 중 오류가 발생했습니다: {e}")
            else:
                st.session_state[state_key] = results

    results = st.session_state.get(state_key)
    if results is not None:
        if not results:
            st.info("현재 등록된 게시물 중에는 유사한 후보가 없습니다.")
        else:
            st.write(f"**AI 유사도 기준 추천 {len(results)}건**")
            render_match_candidates(
                result_kind, results, target_page, selected_session_key, source_post_id=post["id"]
            )
