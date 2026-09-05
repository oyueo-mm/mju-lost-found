"""Exercises the fixed-nickname system across the app via Streamlit's
AppTest: the nickname setup gate, its one-time-only nature, and that
nicknames (never real names/emails) are what's shown to other users.
"""

import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from streamlit.testing.v1 import AppTest

from ai.matching import MatchCandidate
from db import database as db

ROOT = Path(__file__).resolve().parent.parent
LOST_PAGE = str(ROOT / "pages" / "1_찾아요.py")
FOUND_PAGE = str(ROOT / "pages" / "2_찾았어요.py")
MY_MATCHES_PAGE = str(ROOT / "pages" / "4_내_매칭.py")
CHAT_PAGE = str(ROOT / "pages" / "5_채팅.py")
MY_CHATS_PAGE = str(ROOT / "pages" / "6_내_채팅.py")
APP_PAGE = str(ROOT / "app.py")

NICKNAME_SUBMIT_KEY = "FormSubmitter:nickname_setup_form-닉네임 설정하기 (변경 불가)"


class NicknameSetupGateTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp_db = Path(__file__).resolve().parent / "_tmp_nickname_ui.db"
        self._orig_db_path = db.DB_PATH
        db.DB_PATH = self._tmp_db
        if self._tmp_db.exists():
            self._tmp_db.unlink()
        db.init_db()

        self.uid = db.create_user("student@mju.ac.kr", "김실명")

    def tearDown(self):
        db.DB_PATH = self._orig_db_path
        if self._tmp_db.exists():
            self._tmp_db.unlink()

    def test_anonymous_user_still_blocked_by_login_gate(self):
        with patch("ui.auth.current_user_id", return_value=None):
            at = AppTest.from_file(LOST_PAGE)
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        infos = [i.value for i in at.info]
        self.assertTrue(any("로그인이 필요합니다" in i for i in infos))

    def test_logged_in_without_nickname_sees_setup_screen_not_board(self):
        with patch("ui.auth.current_user_id", return_value=self.uid):
            at = AppTest.from_file(LOST_PAGE)
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        infos = [i.value for i in at.info]
        self.assertTrue(any("고정 닉네임을 설정해주세요" in i for i in infos))
        self.assertEqual(len(at.tabs), 0)  # board itself never rendered
        self.assertIsNotNone(
            next((b for b in at.button if b.key == NICKNAME_SUBMIT_KEY), None)
        )

    def test_setting_nickname_transitions_to_normal_board(self):
        with patch("ui.auth.current_user_id", return_value=self.uid):
            at = AppTest.from_file(LOST_PAGE)
            at.run(timeout=30)
            at.text_input[0].set_value("김닉네임")
            at.button(key=NICKNAME_SUBMIT_KEY).click()
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        self.assertEqual(db.get_user_by_id(self.uid)["nickname"], "김닉네임")
        self.assertEqual(len(at.tabs), 2)  # 목록 / 새 글 등록 -- normal board now

    def test_duplicate_nickname_shows_error_and_does_not_advance(self):
        other = db.create_user("other@mju.ac.kr", "다른실명")
        db.set_initial_nickname(other, "선점닉네임")

        with patch("ui.auth.current_user_id", return_value=self.uid):
            at = AppTest.from_file(LOST_PAGE)
            at.run(timeout=30)
            at.text_input[0].set_value("선점닉네임")
            at.button(key=NICKNAME_SUBMIT_KEY).click()
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        errors = [e.value for e in at.error]
        self.assertTrue(any("이미 사용 중인 닉네임" in e for e in errors))
        self.assertIsNone(db.get_user_by_id(self.uid)["nickname"])
        self.assertEqual(len(at.tabs), 0)  # still blocked

    def test_user_with_nickname_never_sees_setup_screen_again(self):
        db.set_initial_nickname(self.uid, "이미설정닉")

        with patch("ui.auth.current_user_id", return_value=self.uid):
            at = AppTest.from_file(LOST_PAGE)
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        infos = [i.value for i in at.info]
        self.assertFalse(any("고정 닉네임을 설정해주세요" in i for i in infos))
        self.assertEqual(len(at.tabs), 2)

    def test_app_home_also_gates_on_nickname(self):
        # Fake the underlying st.user (as ui/auth.py's own tests do) rather
        # than the auth.* helper functions individually, so
        # render_sidebar_auth()'s internal st.user.name access also works
        # instead of hitting the real (unconfigured) st.user in bare mode.
        import ui.auth as auth_module

        fake_user = SimpleNamespace(is_logged_in=True, email="student@mju.ac.kr", name="김실명")
        with patch.object(auth_module.st, "user", fake_user):
            at = AppTest.from_file(APP_PAGE)
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        infos = [i.value for i in at.info]
        self.assertTrue(any("고정 닉네임을 설정해주세요" in i for i in infos))
        # nav grid (찾아요/찾았어요/...) must not appear yet
        self.assertFalse(any(s.value == "🔍 찾아요" for s in at.subheader))


class NicknameDisplayTestCase(unittest.TestCase):
    """Verifies the nickname (never the real name/email) is what's shown to
    other users across boards, AI matching, AI search, matches, and chat."""

    def setUp(self):
        self._tmp_db = Path(__file__).resolve().parent / "_tmp_nickname_display_ui.db"
        self._orig_db_path = db.DB_PATH
        db.DB_PATH = self._tmp_db
        if self._tmp_db.exists():
            self._tmp_db.unlink()
        db.init_db()

        self.lost_owner = db.create_user("lostowner@mju.ac.kr", "박실명분실")
        self.found_owner = db.create_user("foundowner@mju.ac.kr", "이실명습득")
        db.set_initial_nickname(self.lost_owner, "분실왕")
        db.set_initial_nickname(self.found_owner, "습득왕")

        self.lost_id = db.create_lost_post(
            self.lost_owner, "검은색 에어팟", "케이스에 흰색 스티커", "전자기기", "인문캠퍼스 도서관", "2026-08-25 15:00"
        )
        self.found_id = db.create_found_post(
            self.found_owner, "검은색 무선 이어폰", "케이스에 흰색 스티커 있음", "전자기기", "인문캠퍼스 도서관", "2026-08-25 16:00"
        )

    def tearDown(self):
        db.DB_PATH = self._orig_db_path
        if self._tmp_db.exists():
            self._tmp_db.unlink()

    def _no_leaked_identity(self, at) -> None:
        """Real names and emails must never appear anywhere on the page."""
        all_text = "\n".join([m.value for m in at.markdown] + [c.value for c in at.caption])
        for leaked in ("박실명분실", "이실명습득", "@mju.ac.kr"):
            self.assertNotIn(leaked, all_text)

    def test_lost_board_list_shows_author_nickname(self):
        with patch("ui.auth.current_user_id", return_value=self.found_owner):
            at = AppTest.from_file(LOST_PAGE)
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        captions = [c.value for c in at.caption]
        self.assertTrue(any("작성자: 분실왕" in c for c in captions))
        self._no_leaked_identity(at)

    def test_lost_board_detail_shows_author_nickname(self):
        with patch("ui.auth.current_user_id", return_value=self.found_owner):
            at = AppTest.from_file(LOST_PAGE)
            at.run(timeout=30)
            at.button(key=f"lost_detail_btn_{self.lost_id}").click()
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        # st.write() renders as markdown elements in AppTest
        all_markdown = [m.value for m in at.markdown]
        self.assertTrue(any("작성자" in m and "분실왕" in m for m in all_markdown))

    def test_found_board_list_and_detail_show_author_nickname(self):
        with patch("ui.auth.current_user_id", return_value=self.lost_owner):
            at = AppTest.from_file(FOUND_PAGE)
            at.run(timeout=30)

            captions = [c.value for c in at.caption]
            self.assertTrue(any("작성자: 습득왕" in c for c in captions))

            at.button(key=f"found_detail_btn_{self.found_id}").click()
            at.run(timeout=30)

        all_markdown = [m.value for m in at.markdown]
        self.assertTrue(any("작성자" in m and "습득왕" in m for m in all_markdown))

    def test_ai_match_result_card_shows_author_nickname(self):
        found_post = db.get_found_post(self.found_id)
        fake_result = [MatchCandidate(post=found_post, score=0.9)]

        with patch("ui.auth.current_user_id", return_value=self.lost_owner):
            at = AppTest.from_file(LOST_PAGE)
            at.run(timeout=30)
            at.button(key=f"lost_detail_btn_{self.lost_id}").click()
            at.run(timeout=30)
            with patch("ai.matching.find_similar_found_posts", return_value=fake_result):
                at.button(key=f"ai_match_btn_found_{self.lost_id}").click()
                at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        captions = [c.value for c in at.caption]
        self.assertTrue(any("작성자: 습득왕" in c for c in captions))

    def test_ai_search_result_card_shows_author_nickname(self):
        found_post = db.get_found_post(self.found_id)
        fake_result = [MatchCandidate(post=found_post, score=0.91)]

        with patch("ui.auth.current_user_id", return_value=self.lost_owner):
            at = AppTest.from_file(LOST_PAGE)
            at.run(timeout=30)
            at.radio(key="lost_search_mode").set_value("AI 의미 검색")
            at.run(timeout=30)
            at.text_input(key="lost_ai_query_input").set_value("검은색 에어팟을 잃어버렸어요")
            with patch("ai.search.search_similar_posts", return_value=fake_result):
                at.button(key="FormSubmitter:lost_search_form-검색").click()
                at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        captions = [c.value for c in at.caption]
        self.assertTrue(any("작성자: 습득왕" in c for c in captions))

    def test_my_matches_shows_counterpart_nickname(self):
        match_id = db.create_match(self.lost_id, self.found_id, 0.9, self.lost_owner)

        with patch("ui.auth.current_user_id", return_value=self.lost_owner):
            at = AppTest.from_file(MY_MATCHES_PAGE)
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        captions = [c.value for c in at.caption]
        self.assertTrue(any("상대방: 습득왕" in c for c in captions))
        self._no_leaked_identity(at)

    def test_my_chats_shows_counterpart_nickname(self):
        match_id = db.create_match(self.lost_id, self.found_id, 0.9, self.lost_owner)
        db.get_or_create_chat_room(match_id, self.lost_owner)

        with patch("ui.auth.current_user_id", return_value=self.lost_owner):
            at = AppTest.from_file(MY_CHATS_PAGE)
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        captions = [c.value for c in at.caption]
        self.assertTrue(any("상대방: 습득왕" in c for c in captions))
        self._no_leaked_identity(at)

    def test_chat_page_shows_counterpart_nickname_as_sender_and_header(self):
        match_id = db.create_match(self.lost_id, self.found_id, 0.9, self.lost_owner)
        room = db.get_or_create_chat_room(match_id, self.lost_owner)
        db.send_message(room["id"], self.found_owner, "이거 제 물건 같아요!")

        with patch("ui.auth.current_user_id", return_value=self.lost_owner):
            at = AppTest.from_file(CHAT_PAGE)
            at.session_state["chat_room_id"] = room["id"]
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        subheaders = [s.value for s in at.subheader]
        self.assertTrue(any("습득왕님과의 대화" in s for s in subheaders))
        captions = [c.value for c in at.caption]
        self.assertTrue(any(c == "습득왕" for c in captions))
        self._no_leaked_identity(at)

    def test_no_real_name_or_email_anywhere_across_pages(self):
        match_id = db.create_match(self.lost_id, self.found_id, 0.9, self.lost_owner)
        room = db.get_or_create_chat_room(match_id, self.lost_owner)
        db.send_message(room["id"], self.found_owner, "hi")

        pages_to_check = [
            (LOST_PAGE, self.found_owner),
            (FOUND_PAGE, self.lost_owner),
            (MY_MATCHES_PAGE, self.lost_owner),
            (MY_CHATS_PAGE, self.found_owner),
        ]
        for page, viewer in pages_to_check:
            with patch("ui.auth.current_user_id", return_value=viewer):
                at = AppTest.from_file(page)
                at.run(timeout=30)
            self.assertEqual(list(at.exception), [], msg=f"{page} raised")
            self._no_leaked_identity(at)

        with patch("ui.auth.current_user_id", return_value=self.lost_owner):
            at = AppTest.from_file(CHAT_PAGE)
            at.session_state["chat_room_id"] = room["id"]
            at.run(timeout=30)
        self._no_leaked_identity(at)


if __name__ == "__main__":
    unittest.main()
