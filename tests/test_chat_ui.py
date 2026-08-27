"""Exercises the chat feature (pages/4_내_매칭.py's "채팅하기" button and the
new pages/5_채팅.py) via Streamlit's AppTest.

auth.current_user_id() is mocked (real Google OAuth can't be driven in this
environment) but everything downstream -- ChatRoom/Message creation,
permission checks, DB writes -- runs against the real db/database.py.

Per the task, we avoid asserting on transient st.success()-then-st.rerun()
messages (a known AppTest harness limitation documented in earlier reports)
and instead check DB state and the final rendered UI.
"""

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from streamlit.testing.v1 import AppTest

from db import database as db

MY_MATCHES_PAGE = str(Path(__file__).resolve().parent.parent / "pages" / "4_내_매칭.py")
CHAT_PAGE = str(Path(__file__).resolve().parent.parent / "pages" / "5_채팅.py")
LOST_BOARD_PAGE = str(Path(__file__).resolve().parent.parent / "pages" / "1_찾아요.py")


class ChatUiTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp_db = Path(__file__).resolve().parent / "_tmp_chat_ui.db"
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

    def tearDown(self):
        db.DB_PATH = self._orig_db_path
        if self._tmp_db.exists():
            self._tmp_db.unlink()

    # ---------- login gate ----------

    def test_anonymous_user_blocked_from_chat_page(self):
        with patch("ui.auth.current_user_id", return_value=None):
            at = AppTest.from_file(CHAT_PAGE)
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        infos = [i.value for i in at.info]
        self.assertTrue(any("로그인이 필요합니다" in i for i in infos))

    # ---------- 내 매칭 -> 채팅하기 ----------

    def test_match_card_shows_chat_button(self):
        with patch("ui.auth.current_user_id", return_value=self.lost_owner):
            at = AppTest.from_file(MY_MATCHES_PAGE)
            at.run(timeout=30)

        self.assertTrue(any(b.key == f"match_chat_{self.match_id}" for b in at.button))

    def test_chat_button_creates_chat_room_and_switches_page(self):
        with patch("ui.auth.current_user_id", return_value=self.lost_owner):
            at = AppTest.from_file(MY_MATCHES_PAGE)
            at.run(timeout=30)
            with patch("streamlit.switch_page") as mock_switch:
                at.button(key=f"match_chat_{self.match_id}").click()
                at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        mock_switch.assert_called_once_with("pages/5_채팅.py")

        room = db.get_or_create_chat_room(self.match_id, self.lost_owner)
        self.assertEqual(at.session_state["chat_room_id"], room["id"])

    def test_chat_button_reuses_existing_room_not_duplicate(self):
        existing_room = db.get_or_create_chat_room(self.match_id, self.found_owner)

        with patch("ui.auth.current_user_id", return_value=self.lost_owner):
            at = AppTest.from_file(MY_MATCHES_PAGE)
            at.run(timeout=30)
            with patch("streamlit.switch_page"):
                at.button(key=f"match_chat_{self.match_id}").click()
                at.run(timeout=30)

        self.assertEqual(at.session_state["chat_room_id"], existing_room["id"])

    # ---------- chat page rendering ----------

    def test_chat_page_shows_existing_messages_and_match_context(self):
        room = db.get_or_create_chat_room(self.match_id, self.lost_owner)
        db.send_message(room["id"], self.lost_owner, "안녕하세요! 혹시 제 에어팟인가요?")
        db.send_message(room["id"], self.found_owner, "네 맞는 것 같아요!")

        with patch("ui.auth.current_user_id", return_value=self.lost_owner):
            at = AppTest.from_file(CHAT_PAGE)
            at.session_state["chat_room_id"] = room["id"]
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        self.assertEqual(len(at.chat_message), 2)

        markdowns = [m.value for m in at.markdown]
        self.assertTrue(any("안녕하세요! 혹시 제 에어팟인가요?" in m for m in markdowns))
        self.assertTrue(any("네 맞는 것 같아요!" in m for m in markdowns))

        captions = [c.value for c in at.caption]
        self.assertTrue(any("내 분실물: 검은색 에어팟" in c for c in captions))
        self.assertTrue(any("상대 습득물: 검은색 무선 이어폰" in c for c in captions))

    def test_sending_message_persists_to_db(self):
        room = db.get_or_create_chat_room(self.match_id, self.lost_owner)

        with patch("ui.auth.current_user_id", return_value=self.lost_owner):
            at = AppTest.from_file(CHAT_PAGE)
            at.session_state["chat_room_id"] = room["id"]
            at.run(timeout=30)
            at.chat_input[0].set_value("이거 제 에어팟 맞는 것 같아요").run(timeout=30)

        self.assertEqual(list(at.exception), [])
        stored = db.list_messages(room["id"], self.lost_owner)
        self.assertEqual(len(stored), 1)
        self.assertEqual(stored[0]["content"], "이거 제 에어팟 맞는 것 같아요")
        self.assertEqual(stored[0]["sender_user_id"], self.lost_owner)

    # ---------- security: third party / stale references ----------

    def test_third_party_blocked_from_chat_page(self):
        room = db.get_or_create_chat_room(self.match_id, self.lost_owner)

        with patch("ui.auth.current_user_id", return_value=self.stranger):
            at = AppTest.from_file(CHAT_PAGE)
            at.session_state["chat_room_id"] = room["id"]
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        errors = [e.value for e in at.error]
        self.assertTrue(any("접근할 권한이 없습니다" in e for e in errors))
        # no message content or chat UI leaked to the unauthorized viewer
        self.assertEqual(len(at.chat_message), 0)

    def test_chat_access_denied_after_match_cancelled(self):
        room = db.get_or_create_chat_room(self.match_id, self.lost_owner)
        db.send_message(room["id"], self.lost_owner, "hi")

        db.delete_match(self.match_id, self.lost_owner)  # cascades ChatRoom + Message

        with patch("ui.auth.current_user_id", return_value=self.lost_owner):
            at = AppTest.from_file(CHAT_PAGE)
            at.session_state["chat_room_id"] = room["id"]
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        errors = [e.value for e in at.error]
        self.assertTrue(any("존재하지 않거나 삭제된 채팅방" in e for e in errors))

    def test_chat_access_denied_after_post_deleted(self):
        room = db.get_or_create_chat_room(self.match_id, self.lost_owner)
        db.send_message(room["id"], self.found_owner, "hi")

        db.delete_lost_post(self.lost_id, self.lost_owner)  # cascades Match -> ChatRoom -> Message

        with patch("ui.auth.current_user_id", return_value=self.found_owner):
            at = AppTest.from_file(CHAT_PAGE)
            at.session_state["chat_room_id"] = room["id"]
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        errors = [e.value for e in at.error]
        self.assertTrue(any("존재하지 않거나 삭제된 채팅방" in e for e in errors))

    # ---------- pagination ----------

    def _insert_messages(self, room_id: int, count: int) -> list[int]:
        """Bulk-insert directly (bypassing send_message()'s notification
        overhead, irrelevant here) -- alternating sender, strictly
        increasing id order."""
        ids = []
        with db.get_connection() as conn:
            for i in range(count):
                sender = self.lost_owner if i % 2 == 0 else self.found_owner
                cursor = conn.execute(
                    "INSERT INTO Message (chat_room_id, sender_user_id, content) VALUES (?, ?, ?)",
                    (room_id, sender, f"메시지{i}"),
                )
                ids.append(cursor.lastrowid)
        return ids

    def test_initial_load_shows_only_latest_page(self):
        room = db.get_or_create_chat_room(self.match_id, self.lost_owner)
        self._insert_messages(room["id"], db.MESSAGE_PAGE_SIZE + 10)

        with patch("ui.auth.current_user_id", return_value=self.lost_owner):
            at = AppTest.from_file(CHAT_PAGE)
            at.session_state["chat_room_id"] = room["id"]
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        self.assertEqual(len(at.chat_message), db.MESSAGE_PAGE_SIZE)
        markdowns = " ".join(m.value for m in at.markdown)
        self.assertNotIn("메시지0 ", markdowns)  # the oldest 10 aren't loaded yet
        self.assertIn("메시지59", markdowns)  # the newest message is

    def test_load_more_button_appears_when_older_messages_exist(self):
        room = db.get_or_create_chat_room(self.match_id, self.lost_owner)
        self._insert_messages(room["id"], db.MESSAGE_PAGE_SIZE + 1)

        with patch("ui.auth.current_user_id", return_value=self.lost_owner):
            at = AppTest.from_file(CHAT_PAGE)
            at.session_state["chat_room_id"] = room["id"]
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        self.assertTrue(any(b.key == f"chat_load_more_{room['id']}" for b in at.button))

    def test_load_more_button_absent_when_no_older_messages(self):
        room = db.get_or_create_chat_room(self.match_id, self.lost_owner)
        self._insert_messages(room["id"], 5)  # well under MESSAGE_PAGE_SIZE

        with patch("ui.auth.current_user_id", return_value=self.lost_owner):
            at = AppTest.from_file(CHAT_PAGE)
            at.session_state["chat_room_id"] = room["id"]
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        self.assertFalse(any(b.key == f"chat_load_more_{room['id']}" for b in at.button))

    def test_clicking_load_more_prepends_older_messages_without_duplicates(self):
        room = db.get_or_create_chat_room(self.match_id, self.lost_owner)
        self._insert_messages(room["id"], db.MESSAGE_PAGE_SIZE + 20)

        with patch("ui.auth.current_user_id", return_value=self.lost_owner):
            at = AppTest.from_file(CHAT_PAGE)
            at.session_state["chat_room_id"] = room["id"]
            at.run(timeout=30)
            at.button(key=f"chat_load_more_{room['id']}").click()
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        self.assertEqual(len(at.chat_message), db.MESSAGE_PAGE_SIZE + 20)
        markdowns = [m.value for m in at.markdown]
        self.assertEqual(len(markdowns), len(set(markdowns)))  # no duplicate message rendered

    def test_load_more_button_disappears_once_exhausted(self):
        room = db.get_or_create_chat_room(self.match_id, self.lost_owner)
        self._insert_messages(room["id"], db.MESSAGE_PAGE_SIZE + 1)

        with patch("ui.auth.current_user_id", return_value=self.lost_owner):
            at = AppTest.from_file(CHAT_PAGE)
            at.session_state["chat_room_id"] = room["id"]
            at.run(timeout=30)
            at.button(key=f"chat_load_more_{room['id']}").click()
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        self.assertFalse(any(b.key == f"chat_load_more_{room['id']}" for b in at.button))
        self.assertEqual(len(at.chat_message), db.MESSAGE_PAGE_SIZE + 1)

    def test_messages_displayed_oldest_to_newest_after_loading_more(self):
        room = db.get_or_create_chat_room(self.match_id, self.lost_owner)
        ids = self._insert_messages(room["id"], db.MESSAGE_PAGE_SIZE + 5)

        with patch("ui.auth.current_user_id", return_value=self.lost_owner):
            at = AppTest.from_file(CHAT_PAGE)
            at.session_state["chat_room_id"] = room["id"]
            at.run(timeout=30)
            at.button(key=f"chat_load_more_{room['id']}").click()
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        markdowns = [m.value for m in at.markdown if m.value.startswith("메시지")]
        expected = [f"메시지{i}" for i in range(len(ids))]
        self.assertEqual(markdowns, expected)

    def test_hidden_message_masked_in_paginated_view(self):
        room = db.get_or_create_chat_room(self.match_id, self.lost_owner)
        ids = self._insert_messages(room["id"], db.MESSAGE_PAGE_SIZE + 3)
        admin = db.create_user("admin@mju.ac.kr", "관리자실명")
        db.set_initial_nickname(admin, "관리자닉")
        with db.get_connection() as conn:
            conn.execute("UPDATE User SET is_admin = 1 WHERE id = ?", (admin,))
        report_id = db.create_report(self.found_owner, "message", ids[0], "욕설/비방")  # oldest -> older page
        db.apply_report_action(report_id, admin, "hide_message")

        with patch("ui.auth.current_user_id", return_value=self.lost_owner):
            at = AppTest.from_file(CHAT_PAGE)
            at.session_state["chat_room_id"] = room["id"]
            at.run(timeout=30)
            at.button(key=f"chat_load_more_{room['id']}").click()
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        markdowns = " ".join(m.value for m in at.markdown)
        self.assertIn(db.HIDDEN_MESSAGE_PLACEHOLDER, markdowns)
        self.assertNotIn("메시지0 ", markdowns)

    def test_only_nicknames_shown_never_email_or_real_name(self):
        room = db.get_or_create_chat_room(self.match_id, self.lost_owner)
        db.send_message(room["id"], self.found_owner, "안녕하세요")

        with patch("ui.auth.current_user_id", return_value=self.lost_owner):
            at = AppTest.from_file(CHAT_PAGE)
            at.session_state["chat_room_id"] = room["id"]
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        page_text = " ".join(c.value for c in at.caption)
        self.assertIn("습득자닉", page_text)
        self.assertNotIn("습득자", page_text.replace("습득자닉", ""))  # real name "습득자" minus the nickname substring
        self.assertNotIn("foundowner@mju.ac.kr", page_text)

    def test_sending_message_after_loading_older_pages_keeps_them_and_shows_new_message(self):
        room = db.get_or_create_chat_room(self.match_id, self.lost_owner)
        self._insert_messages(room["id"], db.MESSAGE_PAGE_SIZE + 10)

        with patch("ui.auth.current_user_id", return_value=self.lost_owner):
            at = AppTest.from_file(CHAT_PAGE)
            at.session_state["chat_room_id"] = room["id"]
            at.run(timeout=30)
            at.button(key=f"chat_load_more_{room['id']}").click()
            at.run(timeout=30)
            self.assertEqual(len(at.chat_message), db.MESSAGE_PAGE_SIZE + 10)  # all loaded so far

            at.chat_input[0].set_value("새 메시지입니다").run(timeout=30)

        self.assertEqual(list(at.exception), [])
        # the older pages already loaded are still there, plus the new message
        self.assertEqual(len(at.chat_message), db.MESSAGE_PAGE_SIZE + 11)
        markdowns = " ".join(m.value for m in at.markdown)
        self.assertIn("새 메시지입니다", markdowns)
        self.assertIn("메시지0", markdowns)  # oldest still present

    def test_existing_read_receipt_ui_unaffected(self):
        room = db.get_or_create_chat_room(self.match_id, self.lost_owner)
        db.send_message(room["id"], self.lost_owner, "읽음 확인용 메시지")

        with patch("ui.auth.current_user_id", return_value=self.found_owner):
            at = AppTest.from_file(CHAT_PAGE)
            at.session_state["chat_room_id"] = room["id"]
            at.run(timeout=30)  # entering as found_owner marks lost_owner's message read

        with patch("ui.auth.current_user_id", return_value=self.lost_owner):
            at2 = AppTest.from_file(CHAT_PAGE)
            at2.session_state["chat_room_id"] = room["id"]
            at2.run(timeout=30)

        self.assertEqual(list(at2.exception), [])
        captions = [c.value for c in at2.caption]
        self.assertTrue(any("읽음" in c for c in captions))


class DirectChatUiTestCase(unittest.TestCase):
    """Exercises the new pages/1_찾아요.py '💬 작성자와 채팅하기' button and the
    resulting direct (Match 없이 생성된) ChatRoom rendering on pages/5_채팅.py."""

    def setUp(self):
        self._tmp_db = Path(__file__).resolve().parent / "_tmp_direct_chat_ui.db"
        self._orig_db_path = db.DB_PATH
        db.DB_PATH = self._tmp_db
        if self._tmp_db.exists():
            self._tmp_db.unlink()
        db.init_db()

        self.author = db.create_user("author@mju.ac.kr", "작성자")
        self.viewer = db.create_user("viewer@mju.ac.kr", "열람자")
        db.set_initial_nickname(self.author, "작성자닉")
        db.set_initial_nickname(self.viewer, "열람자닉")
        self.lost_id = db.create_lost_post(
            self.author, "검은색 에어팟", "케이스에 흰색 스티커", "전자기기", "인문캠퍼스 도서관", "2026-08-25 15:00"
        )

    def tearDown(self):
        db.DB_PATH = self._orig_db_path
        if self._tmp_db.exists():
            self._tmp_db.unlink()

    def _open_lost_post_detail(self, at):
        at.session_state["selected_lost_id"] = self.lost_id
        at.run(timeout=30)

    def test_other_user_can_start_direct_chat_from_lost_post(self):
        with patch("ui.auth.current_user_id", return_value=self.viewer):
            at = AppTest.from_file(LOST_BOARD_PAGE)
            self._open_lost_post_detail(at)
            self.assertTrue(any(b.key == f"direct_chat_btn_lost_{self.lost_id}" for b in at.button))
            with patch("streamlit.switch_page") as mock_switch:
                at.button(key=f"direct_chat_btn_lost_{self.lost_id}").click()
                at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        mock_switch.assert_called_once_with("pages/5_채팅.py")

        room = db.get_or_create_direct_chat_room("lost", self.lost_id, self.viewer)
        self.assertEqual(at.session_state["chat_room_id"], room["id"])
        self.assertIsNone(room["match_id"])
        self.assertEqual(room["direct_lost_post_id"], self.lost_id)
        self.assertEqual(room["initiator_user_id"], self.viewer)

    def test_clicking_again_reuses_same_room_not_duplicate(self):
        existing_room = db.get_or_create_direct_chat_room("lost", self.lost_id, self.viewer)

        with patch("ui.auth.current_user_id", return_value=self.viewer):
            at = AppTest.from_file(LOST_BOARD_PAGE)
            self._open_lost_post_detail(at)
            with patch("streamlit.switch_page"):
                at.button(key=f"direct_chat_btn_lost_{self.lost_id}").click()
                at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        self.assertEqual(at.session_state["chat_room_id"], existing_room["id"])

    def test_author_cannot_start_chat_with_self(self):
        with patch("ui.auth.current_user_id", return_value=self.author):
            at = AppTest.from_file(LOST_BOARD_PAGE)
            self._open_lost_post_detail(at)
            with patch("streamlit.switch_page") as mock_switch:
                at.button(key=f"direct_chat_btn_lost_{self.lost_id}").click()
                at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        mock_switch.assert_not_called()
        errors = [e.value for e in at.error]
        self.assertTrue(any("채팅을 시작할 수 없습니다" in e for e in errors))
        self.assertNotIn("chat_room_id", at.session_state)

    def test_anonymous_user_cannot_reach_chat_button(self):
        with patch("ui.auth.current_user_id", return_value=None):
            at = AppTest.from_file(LOST_BOARD_PAGE)
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        self.assertFalse(any(b.key == f"direct_chat_btn_lost_{self.lost_id}" for b in at.button))
        infos = [i.value for i in at.info]
        self.assertTrue(any("로그인" in i for i in infos))

    def test_direct_chat_room_renders_correct_context_and_blocks_third_party(self):
        room = db.get_or_create_direct_chat_room("lost", self.lost_id, self.viewer)
        db.send_message(room["id"], self.viewer, "이거 제가 잃어버린 물건 같아요")

        with patch("ui.auth.current_user_id", return_value=self.author):
            at = AppTest.from_file(CHAT_PAGE)
            at.session_state["chat_room_id"] = room["id"]
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        captions = [c.value for c in at.caption]
        self.assertTrue(any("찾아요 게시물: 검은색 에어팟" in c for c in captions))
        markdowns = [m.value for m in at.markdown]
        self.assertTrue(any("이거 제가 잃어버린 물건 같아요" in m for m in markdowns))

        stranger = db.create_user("stranger2@mju.ac.kr", "제3자2")
        db.set_initial_nickname(stranger, "제3자2닉")
        with patch("ui.auth.current_user_id", return_value=stranger):
            at2 = AppTest.from_file(CHAT_PAGE)
            at2.session_state["chat_room_id"] = room["id"]
            at2.run(timeout=30)

        self.assertEqual(list(at2.exception), [])
        errors = [e.value for e in at2.error]
        self.assertTrue(any("접근할 권한이 없습니다" in e for e in errors))
        self.assertEqual(len(at2.chat_message), 0)


if __name__ == "__main__":
    unittest.main()
