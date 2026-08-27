"""Exercises the read-receipt / unread-badge feature added to
pages/5_채팅.py, pages/4_내_매칭.py, and app.py via Streamlit's AppTest.

auth.current_user_id() (and, for app.py's fuller auth gate, is_auth_configured
/is_logged_in/is_allowed_domain) are mocked -- real Google OAuth can't be
driven in this environment -- but everything downstream (ChatRoom/Message,
read_at updates, unread counts) runs against the real db/database.py.
"""

import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from streamlit.testing.v1 import AppTest

from db import database as db

APP_PAGE = str(Path(__file__).resolve().parent.parent / "app.py")
MY_MATCHES_PAGE = str(Path(__file__).resolve().parent.parent / "pages" / "4_내_매칭.py")
CHAT_PAGE = str(Path(__file__).resolve().parent.parent / "pages" / "5_채팅.py")


class ChatReadStatusUiTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp_db = Path(__file__).resolve().parent / "_tmp_chat_read_ui.db"
        self._orig_db_path = db.DB_PATH
        db.DB_PATH = self._tmp_db
        if self._tmp_db.exists():
            self._tmp_db.unlink()
        db.init_db()

        self.lost_owner = db.create_user("lostowner@mju.ac.kr", "분실자")
        self.found_owner = db.create_user("foundowner@mju.ac.kr", "습득자")
        self.stranger = db.create_user("stranger@mju.ac.kr", "제3자")
        db.set_initial_nickname(self.lost_owner, "분실자닉")
        db.set_initial_nickname(self.found_owner, "습득자닉")
        db.set_initial_nickname(self.stranger, "제3자닉")
        self.lost_id = db.create_lost_post(
            self.lost_owner, "검은색 에어팟", "케이스에 흰색 스티커", "전자기기", "인문캠퍼스 도서관", "2026-08-25 15:00"
        )
        self.found_id = db.create_found_post(
            self.found_owner, "검은색 무선 이어폰", "케이스에 흰색 스티커 있음", "전자기기", "인문캠퍼스 도서관", "2026-08-25 16:00"
        )
        self.match_id = db.create_match(self.lost_id, self.found_id, 0.9, self.lost_owner)
        self.room = db.get_or_create_chat_room(self.match_id, self.lost_owner)

    def tearDown(self):
        db.DB_PATH = self._orig_db_path
        if self._tmp_db.exists():
            self._tmp_db.unlink()

    # ---------- chat page marks the other side's messages as read ----------

    def test_entering_chat_page_marks_other_side_messages_read(self):
        db.send_message(self.room["id"], self.found_owner, "이거 제 물건 같아요!")
        self.assertEqual(db.count_unread_messages_by_user(self.lost_owner), 1)

        with patch("ui.auth.current_user_id", return_value=self.lost_owner):
            at = AppTest.from_file(CHAT_PAGE)
            at.session_state["chat_room_id"] = self.room["id"]
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        self.assertEqual(db.count_unread_messages_by_user(self.lost_owner), 0)

    def test_own_messages_not_marked_as_unread_target(self):
        db.send_message(self.room["id"], self.lost_owner, "제가 보낸 메시지")

        with patch("ui.auth.current_user_id", return_value=self.lost_owner):
            at = AppTest.from_file(CHAT_PAGE)
            at.session_state["chat_room_id"] = self.room["id"]
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        # visiting my own chat room must not affect my own message's read_at,
        # nor create any unread count for the other participant automatically
        msg = db.list_messages(self.room["id"], self.lost_owner)[0]
        self.assertIsNone(msg["read_at"])

    def test_own_message_shows_unread_then_read_caption(self):
        db.send_message(self.room["id"], self.lost_owner, "혹시 이 에어팟 맞나요?")

        with patch("ui.auth.current_user_id", return_value=self.lost_owner):
            at = AppTest.from_file(CHAT_PAGE)
            at.session_state["chat_room_id"] = self.room["id"]
            at.run(timeout=30)
        captions = [c.value for c in at.caption]
        self.assertTrue(any("안 읽음" in c for c in captions))

        # the other participant opens the chat -> reads it
        with patch("ui.auth.current_user_id", return_value=self.found_owner):
            at2 = AppTest.from_file(CHAT_PAGE)
            at2.session_state["chat_room_id"] = self.room["id"]
            at2.run(timeout=30)

        # lost_owner reloads and now sees "읽음"
        with patch("ui.auth.current_user_id", return_value=self.lost_owner):
            at3 = AppTest.from_file(CHAT_PAGE)
            at3.session_state["chat_room_id"] = self.room["id"]
            at3.run(timeout=30)
        captions3 = [c.value for c in at3.caption]
        self.assertTrue(any("읽음" in c and "안 읽음" not in c for c in captions3))

    def test_sending_message_still_works_with_read_at_column(self):
        """Regression: existing send flow must be unaffected by read_at."""
        with patch("ui.auth.current_user_id", return_value=self.lost_owner):
            at = AppTest.from_file(CHAT_PAGE)
            at.session_state["chat_room_id"] = self.room["id"]
            at.run(timeout=30)
            at.chat_input[0].set_value("테스트 메시지").run(timeout=30)

        self.assertEqual(list(at.exception), [])
        stored = db.list_messages(self.room["id"], self.lost_owner)
        self.assertEqual(len(stored), 1)
        self.assertEqual(stored[0]["content"], "테스트 메시지")

    # ---------- 내 매칭 badge ----------

    def test_match_card_shows_unread_badge(self):
        db.send_message(self.room["id"], self.found_owner, "hi")
        db.send_message(self.room["id"], self.found_owner, "hi again")

        with patch("ui.auth.current_user_id", return_value=self.lost_owner):
            at = AppTest.from_file(MY_MATCHES_PAGE)
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        markdowns = [m.value for m in at.markdown]
        self.assertTrue(any("새 메시지 2개" in m for m in markdowns))

    def test_match_card_no_badge_when_no_unread(self):
        with patch("ui.auth.current_user_id", return_value=self.lost_owner):
            at = AppTest.from_file(MY_MATCHES_PAGE)
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        markdowns = [m.value for m in at.markdown]
        self.assertTrue(any("검은색 에어팟" in m for m in markdowns))
        self.assertFalse(any("새 메시지" in m for m in markdowns))

    def test_unread_badge_disappears_after_reading(self):
        db.send_message(self.room["id"], self.found_owner, "hi")

        with patch("ui.auth.current_user_id", return_value=self.lost_owner):
            at_before = AppTest.from_file(MY_MATCHES_PAGE)
            at_before.run(timeout=30)
        self.assertTrue(any("새 메시지" in m.value for m in at_before.markdown))

        with patch("ui.auth.current_user_id", return_value=self.lost_owner):
            at_chat = AppTest.from_file(CHAT_PAGE)
            at_chat.session_state["chat_room_id"] = self.room["id"]
            at_chat.run(timeout=30)

        with patch("ui.auth.current_user_id", return_value=self.lost_owner):
            at_after = AppTest.from_file(MY_MATCHES_PAGE)
            at_after.run(timeout=30)
        self.assertFalse(any("새 메시지" in m.value for m in at_after.markdown))

    # ---------- app.py nav badge ----------

    def _patched_authorized(self, user_id: int, email: str, name: str):
        # Fake the underlying st.user (as tests/test_auth.py's
        # StreamlitGlueTestCase does) rather than the auth.* helper
        # functions individually, so render_sidebar_auth()'s own internal
        # is_logged_in()/st.user.name access also works correctly instead
        # of hitting the real (unconfigured) st.user in bare AppTest mode.
        import ui.auth as auth_module

        fake_user = SimpleNamespace(is_logged_in=True, email=email, name=name)
        return patch.object(auth_module.st, "user", fake_user)

    def test_app_nav_shows_unread_total(self):
        db.send_message(self.room["id"], self.found_owner, "hi")

        with self._patched_authorized(self.lost_owner, "lostowner@mju.ac.kr", "분실자"):
            at = AppTest.from_file(APP_PAGE)
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        subheaders = [s.value for s in at.subheader]
        self.assertTrue(any("내 매칭 (1)" in s for s in subheaders))

    def test_app_nav_no_count_when_zero_unread(self):
        with self._patched_authorized(self.lost_owner, "lostowner@mju.ac.kr", "분실자"):
            at = AppTest.from_file(APP_PAGE)
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        subheaders = [s.value for s in at.subheader]
        self.assertTrue(any(s == "🔗 내 매칭" for s in subheaders))

    def test_app_does_not_query_unread_count_when_logged_out(self):
        import ui.auth as auth_module

        fake_user = SimpleNamespace(is_logged_in=False)
        with patch.object(auth_module.st, "user", fake_user):
            with patch("db.database.count_unread_messages_by_user") as mock_count:
                at = AppTest.from_file(APP_PAGE)
                at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        mock_count.assert_not_called()

    # ---------- security ----------

    def test_third_party_cannot_read_or_trigger_read_receipts(self):
        db.send_message(self.room["id"], self.lost_owner, "hi")

        with patch("ui.auth.current_user_id", return_value=self.stranger):
            at = AppTest.from_file(CHAT_PAGE)
            at.session_state["chat_room_id"] = self.room["id"]
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        errors = [e.value for e in at.error]
        self.assertTrue(any("접근할 권한이 없습니다" in e for e in errors))
        self.assertEqual(len(at.chat_message), 0)

        # the stranger's visit must not have marked anything as read
        msg = db.list_messages(self.room["id"], self.lost_owner)[0]
        self.assertIsNone(msg["read_at"])

    def test_third_party_direct_call_blocked(self):
        db.send_message(self.room["id"], self.lost_owner, "hi")
        with self.assertRaises(db.PermissionDeniedError):
            db.mark_messages_as_read(self.room["id"], self.stranger)


if __name__ == "__main__":
    unittest.main()
