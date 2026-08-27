import streamlit as st

from db import database as db
from ui import auth

st.set_page_config(page_title="관리자 - 명지 스마트 분실물 센터", page_icon="🛡️", layout="wide")

auth.render_sidebar_auth()

st.title("🛡️ 관리자 - 신고 처리")

# 접근 제어: 로그인 + 닉네임 설정 + DB에 저장된 is_admin 여부까지 다시 확인한다.
# (require_admin은 UI 게이트일 뿐이고, 실제 검증은 db.list_reports_for_admin()/
# db.process_report() 안에서도 매번 다시 이루어진다.)
admin_user = auth.require_admin("관리자 페이지를 이용하려면")
if admin_user is None:
    st.stop()
admin_user_id = admin_user["id"]

STATUS_LABELS = {"pending": "처리 대기", "dismissed": "반려", "actioned": "조치 완료"}
TARGET_TYPE_LABELS = {"post": "게시물", "message": "메시지", "user": "사용자"}
PAGE_SIZE = 20

status_filter_options = ["처리 대기", "전체", "조치 완료", "반려"]
status_filter_values = {"처리 대기": "pending", "전체": None, "조치 완료": "actioned", "반려": "dismissed"}
target_type_filter_options = ["전체", "게시물", "메시지", "사용자"]
target_type_filter_values = {"전체": None, "게시물": "post", "메시지": "message", "사용자": "user"}

c1, c2 = st.columns(2)
status_choice = c1.selectbox("처리 상태", status_filter_options, key="admin_status_filter")
target_type_choice = c2.selectbox("신고 유형", target_type_filter_options, key="admin_target_type_filter")

filter_signature = (status_choice, target_type_choice)
if st.session_state.get("admin_filter_signature") != filter_signature:
    st.session_state["admin_filter_signature"] = filter_signature
    st.session_state["admin_report_page"] = 0

page = st.session_state.setdefault("admin_report_page", 0)
offset = page * PAGE_SIZE

try:
    reports = db.list_reports_for_admin(
        admin_user_id,
        status=status_filter_values[status_choice],
        target_type=target_type_filter_values[target_type_choice],
        limit=PAGE_SIZE + 1,
        offset=offset,
    )
except db.PermissionDeniedError:
    st.error("관리자 권한이 없습니다.")
    st.stop()
except ValueError as e:
    st.error(f"신고 목록을 불러오는 중 오류가 발생했습니다: {e}")
    reports = []
except Exception as e:
    st.error(f"신고 목록을 불러오는 중 오류가 발생했습니다: {e}")
    reports = []

has_more = len(reports) > PAGE_SIZE
reports = reports[:PAGE_SIZE]

st.caption(f"{page + 1}페이지 · {len(reports)}건 표시")

if not reports:
    st.info("조건에 맞는 신고가 없습니다.")


ACTION_TYPE_LABELS = {"delete_post": "게시물 삭제", "hide_message": "메시지 숨김", "suspend_user": "사용자 정지"}
# The one action_type each target_type maps to -- report.actioned always
# means exactly this action for that target_type (see
# db._TARGET_TYPE_TO_ACTION_TYPES, which apply_report_action() itself
# enforces -- this UI mapping is just for display/selection, not security).
TARGET_TYPE_TO_ACTION_TYPE = {"post": "delete_post", "message": "hide_message", "user": "suspend_user"}
SUSPEND_DURATION_OPTIONS = {"7일": 7, "30일": 30, "영구": None}


def _render_process_control(report: dict) -> None:
    report_id = report["id"]
    target_type = report["target_type"]
    pending_key = f"admin_process_pending_{report_id}"

    # 대상이 이미 삭제/소멸된 경우 실제 조치를 적용할 대상이 없으므로 반려만 선택할 수 있다.
    if report["target_deleted"]:
        status_options = ["반려"]
        st.caption("대상이 이미 삭제되어 '반려'만 선택할 수 있습니다.")
    else:
        status_options = ["반려", "조치 완료"]

    status_choice_local = st.selectbox(
        "처리 상태 선택", status_options, key=f"admin_status_choice_{report_id}"
    )
    status_value = "dismissed" if status_choice_local == "반려" else "actioned"

    action_type = None
    suspend_days = None
    action_reason = None
    if status_value == "actioned":
        action_type = TARGET_TYPE_TO_ACTION_TYPE[target_type]
        st.caption(f"조치: {ACTION_TYPE_LABELS[action_type]}")
        if action_type == "suspend_user":
            duration_choice = st.radio(
                "정지 기간", list(SUSPEND_DURATION_OPTIONS.keys()),
                key=f"admin_suspend_duration_{report_id}", horizontal=True,
            )
            suspend_days = SUSPEND_DURATION_OPTIONS[duration_choice]
        action_reason = st.text_input("제재 사유 (선택)", key=f"admin_action_reason_{report_id}")

    note = st.text_area("관리자 메모 (선택)", key=f"admin_note_{report_id}")

    if st.session_state.get(pending_key):
        confirm_desc = status_choice_local if status_value == "dismissed" else f"조치 완료 ({ACTION_TYPE_LABELS[action_type]})"
        st.warning(f"정말 이 신고에 대해 '{confirm_desc}' 처리를 적용하시겠습니까? 처리 후에는 되돌릴 수 없습니다.")
        cc1, cc2 = st.columns(2)
        if cc1.button("확인", key=f"admin_confirm_yes_{report_id}"):
            try:
                if status_value == "dismissed":
                    db.process_report(report_id, admin_user_id, "dismissed", note)
                else:
                    db.apply_report_action(
                        report_id,
                        admin_user_id,
                        action_type,
                        action_reason=action_reason,
                        admin_note=note,
                        suspend_duration_days=suspend_days,
                    )
            except db.PermissionDeniedError:
                st.error("관리자 권한이 없습니다.")
            except ValueError as e:
                st.error(f"처리할 수 없습니다: {e}")
            except Exception as e:
                st.error(f"처리 중 오류가 발생했습니다: {e}")
            else:
                st.session_state.pop(pending_key, None)
                st.success("신고가 처리되었습니다.")
                st.rerun()
        if cc2.button("취소", key=f"admin_confirm_no_{report_id}"):
            st.session_state.pop(pending_key, None)
            st.rerun()
    else:
        if st.button("처리하기", key=f"admin_process_btn_{report_id}"):
            st.session_state[pending_key] = True
            st.rerun()


for r in reports:
    with st.container(border=True):
        st.markdown(
            f"**신고 #{r['id']}** · {TARGET_TYPE_LABELS[r['target_type']]} · {STATUS_LABELS[r['status']]}"
        )
        st.caption(f"신고자: {r['reporter_nickname']}  ·  신고일: {r['created_at']}")
        st.write(f"**사유:** {r['reason']}")
        if r["detail"]:
            st.write(f"**상세 내용:** {r['detail']}")

        st.divider()
        if r["target_deleted"]:
            st.warning("⚠️ 신고 대상이 삭제되었습니다. (신고 기록은 계속 보관됩니다)")
        else:
            info = r["target_info"]
            if r["target_type"] == "post":
                kind_label = "찾아요(분실물)" if info["post_kind"] == "lost" else "찾았어요(습득물)"
                st.write(f"**대상 게시물** ({kind_label})")
                st.write(f"제목: {info['title']}")
                st.write(f"설명: {info['description']}")
                st.caption(
                    f"작성자: {info['author_nickname']} · {info['category']} · {info['location']} · "
                    f"상태: {info['status']} · 작성일: {info['created_at']}"
                )
            elif r["target_type"] == "message":
                st.write("**대상 메시지**")
                st.write(info["content"])
                st.caption(f"작성자: {info['sender_nickname']} · 작성일: {info['created_at']}")
            else:
                st.write("**대상 사용자**")
                st.write(f"닉네임: {info['nickname']}")

        st.divider()
        if r["status"] == "pending":
            _render_process_control(r)
        else:
            st.caption(
                f"처리자: {r['processed_by_nickname'] or '-'}  ·  처리일: {r['processed_at'] or '-'}"
            )
            if r["admin_note"]:
                st.caption(f"관리자 메모: {r['admin_note']}")
            ma = r.get("moderation_action")
            if ma:
                st.write(f"**조치:** {ACTION_TYPE_LABELS.get(ma['action_type'], ma['action_type'])}")
                st.caption(f"조치 처리자: {ma['admin_nickname']}  ·  조치일: {ma['created_at']}")
                if ma["reason"]:
                    st.caption(f"조치 사유: {ma['reason']}")
                if ma["action_type"] == "suspend_user":
                    st.caption(f"기간: {'영구' if ma['expires_at'] is None else ma['expires_at'] + '까지'}")

pc1, pc2, pc3 = st.columns([1, 1, 4])
if pc1.button("이전 페이지", key="admin_page_prev", disabled=(page == 0)):
    st.session_state["admin_report_page"] = page - 1
    st.rerun()
if pc2.button("다음 페이지", key="admin_page_next", disabled=(not has_more)):
    st.session_state["admin_report_page"] = page + 1
    st.rerun()
