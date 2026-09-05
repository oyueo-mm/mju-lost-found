"""Exercises pages/6_내_채팅.py via Streamlit's AppTest.

auth.current_user_id() is mocked (real Google OAuth can't be driven in this
environment) but everything downstream -- list_chat_rooms_by_user(),
switch_page target, session_state -- runs against the real db/database.py.
"""

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from streamlit.testing.v1 import AppTest

from db import database as db

MY_CHATS_PAGE = str(Path(__file__).resolve().parent.parent / "pages" / "6_내_채팅.py")


class MyChatsUiTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp_db = Path(__file__).resolve().parent / "_tmp_my_chats_ui.db"
        self._orig_db_path = db.DB_PATH
        db.DB_PATH = self._tmp_db
        if self._tmp_db.exists():
            self._tmp_db.unlink()
        db.init_db()

        self.lost_owner = db.create_user("lostowner@mju.ac.kr", "분실자")
        self.found_owner = db.create_user("foundowner@mju.ac.kr", "습득자")
        db.set_initial_nickname(self.lost_owner, "분실자닉")
        db.set_initial_nickname(self.found_owner, "습득자닉")
        self.lost_id = db.create_lost_post(
            self.lost_owner, "검은색 에어팟", "케이스에 흰색 스티커", "전자기기", "인문캠퍼스 도서관", "2026-08-25 15:00"
        )
        self.found_id = db.create_found_post(
            self.found_owner, "검은색 무선 이어폰", "케이스에 흰색 스티커 있음", "전자기기", "인문캠퍼스 도서관", "2026-08-25 16:00"
        )
        self.match_id = db.create_match(self.lost_id, self.found_id, 0.9, self.lost_owner)

    def tearDown(self):
        db.DB_PATH = self._orig_db_path
        if self._tmp_db.exists():
            self._tmp_db.unlink()

    def test_anonymous_user_blocked(self):
        with patch("ui.auth.current_user_id", return_value=None):
            at = AppTest.from_file(MY_CHATS_PAGE)
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        infos = [i.value for i in at.info]
        self.assertTrue(any("로그인이 필요합니다" in i for i in infos))

    def test_empty_state_when_no_chat_rooms(self):
        # st.page_link() to another page can't resolve Streamlit's multipage
        # registry when a single page is run standalone via AppTest (a known
        # harness limitation also hit by st.switch_page in earlier reports),
        # so it's stubbed out here -- it works fine in the real running app.
        with patch("ui.auth.current_user_id", return_value=self.lost_owner):
            at = AppTest.from_file(MY_CHATS_PAGE)
            with patch("streamlit.page_link"):
                at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        infos = [i.value for i in at.info]
        self.assertTrue(any("아직 시작한 채팅이 없습니다" in i for i in infos))

    def test_chat_room_list_renders_with_last_message(self):
        room = db.get_or_create_chat_room(self.match_id, self.lost_owner)
        db.send_message(room["id"], self.found_owner, "이거 제 물건 같아요!")

        with patch("ui.auth.current_user_id", return_value=self.lost_owner):
            at = AppTest.from_file(MY_CHATS_PAGE)
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        markdowns = [m.value for m in at.markdown]
        self.assertTrue(
            any("검은색 에어팟" in m and "검은색 무선 이어폰" in m for m in markdowns)
        )
        self.assertTrue(any("이거 제 물건 같아요!" in m.value for m in at.markdown))

    def test_unread_badge_shown_when_unread_present(self):
        room = db.get_or_create_chat_room(self.match_id, self.lost_owner)
        db.send_message(room["id"], self.found_owner, "hi")
        db.send_message(room["id"], self.found_owner, "hi again")

        with patch("ui.auth.current_user_id", return_value=self.lost_owner):
            at = AppTest.from_file(MY_CHATS_PAGE)
            at.run(timeout=30)

        markdowns = [m.value for m in at.markdown]
        self.assertTrue(any("새 메시지 2개" in m for m in markdowns))

    def test_no_unread_badge_when_zero_unread(self):
        room = db.get_or_create_chat_room(self.match_id, self.lost_owner)
        db.send_message(room["id"], self.found_owner, "hi")
        db.mark_messages_as_read(room["id"], self.lost_owner)

        with patch("ui.auth.current_user_id", return_value=self.lost_owner):
            at = AppTest.from_file(MY_CHATS_PAGE)
            at.run(timeout=30)

        markdowns = [m.value for m in at.markdown]
        self.assertTrue(any("검은색 에어팟" in m for m in markdowns))
        self.assertFalse(any("새 메시지" in m for m in markdowns))

    def test_no_messages_yet_shows_empty_state_for_room(self):
        db.get_or_create_chat_room(self.match_id, self.lost_owner)

        with patch("ui.auth.current_user_id", return_value=self.lost_owner):
            at = AppTest.from_file(MY_CHATS_PAGE)
            at.run(timeout=30)

        infos = [i.value for i in at.info]
        self.assertTrue(any("아직 메시지가 없습니다" in i for i in infos))

    def test_chat_button_sets_room_id_and_switches_to_chat_page(self):
        room = db.get_or_create_chat_room(self.match_id, self.lost_owner)

        with patch("ui.auth.current_user_id", return_value=self.lost_owner):
            at = AppTest.from_file(MY_CHATS_PAGE)
            at.run(timeout=30)
            with patch("streamlit.switch_page") as mock_switch:
                at.button(key=f"my_chats_open_{room['id']}").click()
                at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        mock_switch.assert_called_once_with("pages/5_채팅.py")
        self.assertEqual(at.session_state["chat_room_id"], room["id"])


class MyChatsDirectChatUiTestCase(unittest.TestCase):
    """Direct chat rooms (게시글 -> '채팅하기', no Match) must render in the
    same "내 채팅" list as Match-based rooms, and the button must reuse the
    exact same open/switch-page flow already tested above."""

    def setUp(self):
        self._tmp_db = Path(__file__).resolve().parent / "_tmp_my_chats_direct_ui.db"
        self._orig_db_path = db.DB_PATH
        db.DB_PATH = self._tmp_db
        if self._tmp_db.exists():
            self._tmp_db.unlink()
        db.init_db()

        self.author = db.create_user("author@mju.ac.kr", "작성자실명")
        self.viewer = db.create_user("viewer@mju.ac.kr", "열람자실명")
        db.set_initial_nickname(self.author, "작성자닉")
        db.set_initial_nickname(self.viewer, "열람자닉")
        self.lost_id = db.create_lost_post(
            self.author, "검은색 에어팟", "케이스에 흰색 스티커", "전자기기", "인문캠퍼스 도서관", "2026-08-25 15:00"
        )

    def tearDown(self):
        db.DB_PATH = self._orig_db_path
        if self._tmp_db.exists():
            self._tmp_db.unlink()

    def test_direct_chat_room_appears_in_initiators_list(self):
        room = db.get_or_create_direct_chat_room("lost", self.lost_id, self.viewer)

        with patch("ui.auth.current_user_id", return_value=self.viewer):
            at = AppTest.from_file(MY_CHATS_PAGE)
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        markdowns = [m.value for m in at.markdown]
        self.assertTrue(any("검은색 에어팟" in m for m in markdowns))
        captions = [c.value for c in at.caption]
        self.assertTrue(any("작성자닉" in c for c in captions))
        self.assertTrue(any(b.key == f"my_chats_open_{room['id']}" for b in at.button))

    def test_direct_chat_room_appears_in_authors_list_with_viewer_as_other_side(self):
        db.get_or_create_direct_chat_room("lost", self.lost_id, self.viewer)

        with patch("ui.auth.current_user_id", return_value=self.author):
            at = AppTest.from_file(MY_CHATS_PAGE)
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        captions = [c.value for c in at.caption]
        self.assertTrue(any("열람자닉" in c for c in captions))

    def test_direct_and_match_rooms_both_rendered_together(self):
        found_owner = db.create_user("foundowner@mju.ac.kr", "습득자실명")
        db.set_initial_nickname(found_owner, "습득자닉")
        found_id = db.create_found_post(
            found_owner, "검은색 무선 이어폰", "설명", "전자기기", "도서관", "2026-08-25 16:00"
        )
        match_id = db.create_match(self.lost_id, found_id, 0.9, self.author)
        match_room = db.get_or_create_chat_room(match_id, self.author)
        direct_room = db.get_or_create_direct_chat_room("lost", self.lost_id, self.viewer)

        with patch("ui.auth.current_user_id", return_value=self.author):
            at = AppTest.from_file(MY_CHATS_PAGE)
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        self.assertTrue(any(b.key == f"my_chats_open_{match_room['id']}" for b in at.button))
        self.assertTrue(any(b.key == f"my_chats_open_{direct_room['id']}" for b in at.button))

    def test_direct_chat_button_sets_room_id_and_switches_to_chat_page(self):
        room = db.get_or_create_direct_chat_room("lost", self.lost_id, self.viewer)

        with patch("ui.auth.current_user_id", return_value=self.viewer):
            at = AppTest.from_file(MY_CHATS_PAGE)
            at.run(timeout=30)
            with patch("streamlit.switch_page") as mock_switch:
                at.button(key=f"my_chats_open_{room['id']}").click()
                at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        mock_switch.assert_called_once_with("pages/5_채팅.py")
        self.assertEqual(at.session_state["chat_room_id"], room["id"])

    def test_direct_chat_unread_badge_shown(self):
        room = db.get_or_create_direct_chat_room("lost", self.lost_id, self.viewer)
        db.send_message(room["id"], self.viewer, "안녕하세요")
        db.send_message(room["id"], self.viewer, "혹시 제 물건인가요?")

        with patch("ui.auth.current_user_id", return_value=self.author):
            at = AppTest.from_file(MY_CHATS_PAGE)
            at.run(timeout=30)

        markdowns = [m.value for m in at.markdown]
        self.assertTrue(any("새 메시지 2개" in m for m in markdowns))

    def test_stranger_direct_chat_room_not_leaked_into_own_list(self):
        db.get_or_create_direct_chat_room("lost", self.lost_id, self.viewer)
        stranger = db.create_user("stranger@mju.ac.kr", "제3자실명")
        db.set_initial_nickname(stranger, "제3자닉")

        with patch("ui.auth.current_user_id", return_value=stranger):
            at = AppTest.from_file(MY_CHATS_PAGE)
            with patch("streamlit.page_link"):
                at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        infos = [i.value for i in at.info]
        self.assertTrue(any("아직 시작한 채팅이 없습니다" in i for i in infos))


if __name__ == "__main__":
    unittest.main()
