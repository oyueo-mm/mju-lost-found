"""Google OIDC login via Streamlit's native st.login()/st.user()/st.logout().

Requires [auth] to be configured in .streamlit/secrets.toml (see
.streamlit/secrets.toml.example). Without it, st.user.is_logged_in does not
exist at all and raises AttributeError -- is_auth_configured() guards that.
"""

import streamlit as st

from db import database as db

ALLOWED_EMAIL_DOMAIN = "@mju.ac.kr"


# ---------- Pure logic (no Streamlit dependency, unit-testable) ----------

def is_allowed_domain(email: str | None) -> bool:
    return bool(email) and email.lower().endswith(ALLOWED_EMAIL_DOMAIN)


def resolve_user_id(email: str, name: str) -> int:
    """Get-or-create the User row for an authenticated email, and return its id."""
    existing = db.get_user_by_email(email)
    if existing:
        return existing["id"]
    return db.create_user(email, name or email.split("@")[0])


# ---------- Streamlit-facing glue ----------

def is_auth_configured() -> bool:
    try:
        st.user.is_logged_in  # noqa: B018
        return True
    except AttributeError:
        return False


def is_logged_in() -> bool:
    return is_auth_configured() and bool(st.user.is_logged_in)


def is_authorized() -> bool:
    """Logged in via Google AND the email is an @mju.ac.kr address."""
    return is_logged_in() and is_allowed_domain(getattr(st.user, "email", None))


def current_user_id() -> int | None:
    """DB user id for the current session, or None if not logged in / not authorized."""
    if not is_authorized():
        return None
    name = getattr(st.user, "name", None) or ""
    return resolve_user_id(st.user.email, name)


def current_user():
    """Full User row (email/name/nickname/...) for the current session, or
    None if not logged in / not authorized. email/name are for internal
    auth use only -- never display them to other users; nickname is the
    only identity shown publicly (see render_nickname_setup_notice())."""
    user_id = current_user_id()
    if user_id is None:
        return None
    return db.get_user_by_id(user_id)


def is_suspended() -> bool:
    """Whether the current session's user is currently suspended (DB is the
    source of truth via db.is_user_suspended()) -- False for anonymous
    sessions. Viewing pages is unaffected by suspension (require_ready_user()
    doesn't call this); it's only meant for a page to show an early warning
    before a write action that db-layer functions (create_lost_post,
    create_found_post, create_match, send_message) will reject anyway via
    db._require_not_suspended()."""
    user_id = current_user_id()
    return user_id is not None and db.is_user_suspended(user_id)


def render_sidebar_auth() -> None:
    st.sidebar.divider()

    if not is_auth_configured():
        st.sidebar.warning("Google 로그인이 아직 설정되지 않았습니다. `.streamlit/secrets.toml`을 확인해주세요.")
        return

    if not is_logged_in():
        st.sidebar.button("Google로 로그인", on_click=st.login, key="sidebar_login_btn")
        return

    if not is_allowed_domain(getattr(st.user, "email", None)):
        st.sidebar.error("명지대학교 계정(@mju.ac.kr)만 이용할 수 있습니다.")
        st.sidebar.caption(f"현재 로그인된 계정: {st.user.email}")
        st.sidebar.button("로그아웃", on_click=st.logout, key="sidebar_logout_btn")
        return

    st.sidebar.subheader("내 정보")
    st.sidebar.write(st.user.name)
    st.sidebar.caption(st.user.email)
    st.sidebar.button("로그아웃", on_click=st.logout, key="sidebar_logout_btn")


def render_login_required_notice(action: str = "이 기능을 사용하려면") -> None:
    """Shown inline (e.g. inside a registration tab) when the user isn't authorized yet."""
    if not is_auth_configured():
        st.warning("Google 로그인이 아직 설정되지 않았습니다. 관리자에게 문의해주세요.")
    elif not is_logged_in():
        st.info(f"{action} 로그인이 필요합니다.")
        st.button("Google로 로그인", on_click=st.login, key="inline_login_btn")
    elif not is_allowed_domain(getattr(st.user, "email", None)):
        st.error("명지대학교 계정(@mju.ac.kr)만 게시물을 등록할 수 있습니다.")
        st.caption(f"현재 로그인된 계정: {st.user.email}")
        st.button("로그아웃", on_click=st.logout, key="inline_logout_btn")


def render_nickname_setup_notice() -> None:
    """Shown to a logged-in, authorized user who hasn't set their permanent
    nickname yet. No name/student id/phone number is asked for -- only the
    nickname, which can never be changed once saved (db.set_initial_nickname
    enforces that at the DB layer regardless of what happens here)."""
    st.info(
        "서비스를 이용하려면 먼저 고정 닉네임을 설정해주세요. "
        "닉네임은 한 번 설정하면 변경할 수 없습니다."
    )
    with st.form("nickname_setup_form"):
        nickname = st.text_input(
            "닉네임",
            placeholder=f"한글/영문/숫자 {db.NICKNAME_MIN_LENGTH}~{db.NICKNAME_MAX_LENGTH}자",
            max_chars=db.NICKNAME_MAX_LENGTH,
        )
        submitted = st.form_submit_button("닉네임 설정하기 (변경 불가)")

    if submitted:
        user_id = current_user_id()
        try:
            db.set_initial_nickname(user_id, nickname)
        except ValueError as e:
            st.error(str(e))
        else:
            st.success("닉네임이 설정되었습니다.")
            st.rerun()


def require_ready_user(action: str = "이 기능을 사용하려면"):
    """The full page-level gate: not logged in -> login notice; logged in
    but no nickname yet -> nickname setup; both satisfied -> the User row.

    Callers follow the existing render_*_notice convention: this renders
    the appropriate notice and returns None, or returns the ready User row.
    The caller is still responsible for st.stop() when None is returned
    (mirrors how render_login_required_notice never stops on its own)."""
    user = current_user()
    if user is None:
        render_login_required_notice(action)
        return None
    if user["nickname"] is None:
        render_nickname_setup_notice()
        return None
    return user


def require_admin(action: str = "관리자 기능을 사용하려면"):
    """Page-level gate for admin-only pages. Reuses require_ready_user()'s
    login/nickname checks, then re-verifies admin status against the DB --
    never trusts st.session_state or anything else client-side. Same
    return convention as require_ready_user(): renders a notice and returns
    None, or returns the ready admin User row.

    db.list_reports_for_admin()/db.process_report() re-check admin status
    themselves too, so this gate is a UX convenience (and a first line of
    defense), never the only thing enforcing it.
    """
    user = require_ready_user(action)
    if user is None:
        return None
    if not db.is_admin(user["id"]):
        st.error("관리자만 접근할 수 있는 페이지입니다.")
        return None
    return user
