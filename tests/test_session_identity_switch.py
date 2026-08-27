"""Simulates a Google account switch (logout -> login as someone else)
happening within the *same* Streamlit session -- the same AppTest instance
is rerun with the mocked identity changed between runs, without clearing
session_state, to check whether any resource access from the first
identity leaks into or is retained by the second.

This is the audit's priority item 3: "Streamlit 인증 세션 및 실제 로그아웃
→재로그인 과정에서 사용자 identity가 교체되는지 여부".
"""

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from streamlit.testing.v1 import AppTest

from db import database as db

CHAT_PAGE = str(Path(__file__).resolve().parent.parent / "pages" / "5_채팅.py")
MY_POSTS_PAGE = str(Path(__file__).resolve().parent.parent / "pages" / "3_내_게시물.py")


class SessionIdentitySwitchTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp_db = Path(__file__).resolve().parent / "_tmp_identity_switch.db"
        self._orig_db_path = db.DB_PATH
        db.DB_PATH = self._tmp_db
        if self._tmp_db.exists():
            self._tmp_db.unlink()
        db.init_db()

        self.userA = db.create_user("switchchat_a@mju.ac.kr", "전환A실명")
        self.userB = db.create_user("switchchat_b@mju.ac.kr", "전환B실명")
        self.stranger = db.create_user("switchchat_c@mju.ac.kr", "전환C실명")
        db.set_initial_nickname(self.userA, "전환A닉")
        db.set_initial_nickname(self.userB, "전환B닉")
        db.set_initial_nickname(self.stranger, "전환C닉")

        self.lost_id = db.create_lost_post(
            self.userA, "전환 지갑", "설명", "지갑", "장소", "2026-08-27 09:00"
        )
        self.found_id = db.create_found_post(
            self.userB, "전환 습득 지갑", "설명", "지갑", "장소", "2026-08-27 10:00"
        )
        self.match_id = db.create_match(self.lost_id, self.found_id, 0.9, self.userA)
        self.room = db.get_or_create_chat_room(self.match_id, self.userA)
        db.send_message(self.room["id"], self.userA, "전환 테스트 메시지")

    def tearDown(self):
        db.DB_PATH = self._orig_db_path
        if self._tmp_db.exists():
            self._tmp_db.unlink()

    def test_chat_room_access_revoked_immediately_when_identity_switches_mid_session(self):
        """User A opens their own chat room (session_state["chat_room_id"]
        gets set). Without clearing session_state, the mocked identity
        switches to a stranger on the *same* AppTest object's next run --
        the stranger must be blocked, never see A's messages, purely
        because current_user_id() (and thus get_chat_room()'s check)
        re-evaluates against the DB every run."""
        with patch("ui.auth.current_user_id", return_value=self.userA):
            at = AppTest.from_file(CHAT_PAGE)
            at.session_state["chat_room_id"] = self.room["id"]
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        self.assertEqual(len(at.chat_message), 1)  # A sees their own message

        # "logout A, login as stranger" -- reuse the SAME at/session_state,
        # only the mocked identity changes (chat_room_id in session_state
        # is left exactly as A set it, deliberately not cleared).
        with patch("ui.auth.current_user_id", return_value=self.stranger):
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        errors = [e.value for e in at.error]
        self.assertTrue(any("접근할 권한이 없습니다" in e for e in errors))
        self.assertEqual(len(at.chat_message), 0)  # no leaked message content

    def test_my_posts_page_shows_only_the_currently_authenticated_users_posts(self):
        """User A sees their own post on 내_게시물; when the identity
        switches to B on the same session (B has a different post), B must
        see only their own post -- never A's, even though both runs share
        the same session_state/widget tree."""
        with patch("ui.auth.current_user_id", return_value=self.userA):
            at = AppTest.from_file(MY_POSTS_PAGE)
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        a_text = " ".join(c.value for c in at.caption)
        self.assertNotIn("전환 습득 지갑", a_text)

        with patch("ui.auth.current_user_id", return_value=self.userB):
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        b_expander_labels = " ".join(e.label for e in at.expander)
        # B's own found post must be visible in *some* rendered form (title
        # appears in the expander label), and A's lost post title must not
        # appear anywhere in the page for B's session.
        full_text = b_expander_labels + " ".join(c.value for c in at.caption)
        self.assertNotIn("전환 지갑", full_text.replace("전환 습득 지갑", ""))


if __name__ == "__main__":
    unittest.main()
