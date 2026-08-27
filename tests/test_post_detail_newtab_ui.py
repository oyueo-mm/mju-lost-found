"""Exercises the "게시글 상세보기 새 탭 열기" feature added to
pages/1_찾아요.py and pages/2_찾았어요.py.

Implementation: each list card's existing "상세보기" button (same-tab,
st.session_state-based -- unchanged) is joined by a new st.link_button()
that opens the *same page* with a "?lost_id=<id>" / "?found_id=<id>" query
string in a new browser tab. A brand-new tab has no st.session_state, so
each page now also reads st.query_params on load and adopts the id from
there -- but only when st.session_state doesn't already hold a selection,
so a tab that already has its own selection never has its URL silently
override it.

auth.current_user_id() is mocked (real Google OAuth can't be driven in
this environment) but everything downstream (DB reads) runs against the
real db/database.py.
"""

import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from streamlit.testing.v1 import AppTest

from db import database as db

LOST_PAGE = str(Path(__file__).resolve().parent.parent / "pages" / "1_찾아요.py")
FOUND_PAGE = str(Path(__file__).resolve().parent.parent / "pages" / "2_찾았어요.py")


class PostDetailNewTabUiTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp_db = Path(__file__).resolve().parent / "_tmp_post_detail_newtab_ui.db"
        self._orig_db_path = db.DB_PATH
        db.DB_PATH = self._tmp_db
        if self._tmp_db.exists():
            self._tmp_db.unlink()
        db.init_db()

        self.uid = db.create_user("student@mju.ac.kr", "학생")
        db.set_initial_nickname(self.uid, "학생닉네임")
        self.lost_id = db.create_lost_post(
            self.uid, "검은색 에어팟", "케이스에 흰색 스티커", "전자기기", "인문캠퍼스 도서관", "2026-08-25 15:00"
        )
        self.found_id = db.create_found_post(
            self.uid, "검은색 무선 이어폰", "케이스에 흰색 스티커 있음", "전자기기", "인문캠퍼스 도서관", "2026-08-25 16:00"
        )

        self._auth_patcher = patch("ui.auth.current_user_id", return_value=self.uid)
        self._auth_patcher.start()

    def tearDown(self):
        self._auth_patcher.stop()
        db.DB_PATH = self._orig_db_path
        if self._tmp_db.exists():
            self._tmp_db.unlink()

    # ---------- 1/2: 목록에 새 탭 링크가 렌더링되는지 ----------

    def test_lost_board_list_renders_new_tab_link(self):
        at = AppTest.from_file(LOST_PAGE)
        at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        # link_button은 AppTest에서 key를 노출하지 않으므로 (post별로 유일한)
        # url로 식별한다.
        urls = [b.url for b in at.get("link_button")]
        self.assertIn(f"?lost_id={self.lost_id}", urls)
        # 기존 "상세보기" 버튼은 그대로 남아 있어야 함
        self.assertTrue(any(b.key == f"lost_detail_btn_{self.lost_id}" for b in at.button))

    def test_found_board_list_renders_new_tab_link(self):
        at = AppTest.from_file(FOUND_PAGE)
        at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        urls = [b.url for b in at.get("link_button")]
        self.assertIn(f"?found_id={self.found_id}", urls)
        self.assertTrue(any(b.key == f"found_detail_btn_{self.found_id}" for b in at.button))

    # ---------- 3: 새 탭(=session_state 없음)에서 query param만으로 상세 표시 ----------

    def test_lost_board_shows_detail_from_query_param_with_no_prior_session_state(self):
        at = AppTest.from_file(LOST_PAGE)
        at.query_params["lost_id"] = str(self.lost_id)
        at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        subheaders = [s.value for s in at.subheader]
        self.assertTrue(any("검은색 에어팟" in s for s in subheaders))
        markdowns = [m.value for m in at.markdown]
        # 작성자/카테고리/장소/시간 등 기존 상세 정보(st.write)도 함께 표시되어야 함
        self.assertTrue(any("학생닉네임" in m for m in markdowns))
        self.assertTrue(any("전자기기" in m for m in markdowns))

    def test_found_board_shows_detail_from_query_param_with_no_prior_session_state(self):
        at = AppTest.from_file(FOUND_PAGE)
        at.query_params["found_id"] = str(self.found_id)
        at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        markdowns = [m.value for m in at.markdown]
        self.assertTrue(any("검은색 무선 이어폰" in m for m in markdowns))

    def test_existing_session_state_selection_takes_priority_over_query_param(self):
        """이미 현재 탭에서 다른 게시물을 선택한 상태라면, URL의 query
        param이 그 선택을 몰래 덮어써서는 안 된다."""
        other_lost_id = db.create_lost_post(
            self.uid, "파란색 우산", "설명", "기타", "정문", "2026-08-25 10:00"
        )
        at = AppTest.from_file(LOST_PAGE)
        at.session_state["selected_lost_id"] = other_lost_id
        at.query_params["lost_id"] = str(self.lost_id)
        at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        self.assertEqual(at.session_state["selected_lost_id"], other_lost_id)
        # 상세 영역은 st.subheader(post["title"])로 렌더링된다(목록 카드의
        # 제목은 st.markdown) -- 상세로 표시된 것이 query param이 가리킨
        # "검은색 에어팟"이 아니라 세션에 이미 선택돼 있던 "파란색 우산"인지 확인.
        subheaders = [s.value for s in at.subheader]
        self.assertTrue(any("파란색 우산" in s for s in subheaders))
        self.assertFalse(any("검은색 에어팟" in s for s in subheaders))

    # ---------- 4: 존재하지 않거나 잘못된 형식의 ID ----------

    def test_lost_board_nonexistent_query_param_id_shows_warning_not_crash(self):
        at = AppTest.from_file(LOST_PAGE)
        at.query_params["lost_id"] = "999999"
        at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        warnings = [w.value for w in at.warning]
        self.assertTrue(any("찾을 수 없습니다" in w for w in warnings))

    def test_found_board_nonexistent_query_param_id_shows_warning_not_crash(self):
        at = AppTest.from_file(FOUND_PAGE)
        at.query_params["found_id"] = "999999"
        at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        warnings = [w.value for w in at.warning]
        self.assertTrue(any("찾을 수 없습니다" in w for w in warnings))

    def test_lost_board_malformed_query_param_id_does_not_crash(self):
        at = AppTest.from_file(LOST_PAGE)
        at.query_params["lost_id"] = "not-a-number"
        at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        # 잘못된 형식은 무시되고, 아무 게시물도 선택되지 않은 채 목록만 보여야 함
        self.assertIsNone(at.session_state["selected_lost_id"])

    def test_found_board_malformed_query_param_id_does_not_crash(self):
        at = AppTest.from_file(FOUND_PAGE)
        at.query_params["found_id"] = "not-a-number"
        at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        self.assertIsNone(at.session_state["selected_found_id"])

    def test_lost_board_deleted_post_query_param_shows_warning_not_crash(self):
        deleted_id = db.create_lost_post(
            self.uid, "삭제될 게시물", "설명", "기타", "장소", "2026-08-25 09:00"
        )
        db.delete_lost_post(deleted_id, self.uid)

        at = AppTest.from_file(LOST_PAGE)
        at.query_params["lost_id"] = str(deleted_id)
        at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        warnings = [w.value for w in at.warning]
        self.assertTrue(any("찾을 수 없습니다" in w for w in warnings))

    # ---------- 5: 기존 목록 기능 정상 유지 ----------

    def test_lost_board_list_still_renders_without_query_param(self):
        at = AppTest.from_file(LOST_PAGE)
        at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        markdowns = [m.value for m in at.markdown]
        self.assertTrue(any("검은색 에어팟" in m for m in markdowns))
        self.assertIsNone(at.session_state["selected_lost_id"])

    def test_existing_detail_button_still_works_in_same_tab(self):
        """기존 '상세보기' 버튼(같은 탭, session_state 기반) 동작은
        이번 변경과 무관하게 그대로 유지되어야 한다."""
        at = AppTest.from_file(LOST_PAGE)
        at.run(timeout=30)
        at.button(key=f"lost_detail_btn_{self.lost_id}").click()
        at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        self.assertEqual(at.session_state["selected_lost_id"], self.lost_id)
        markdowns = [m.value for m in at.markdown]
        self.assertTrue(any("검은색 에어팟" in m for m in markdowns))


if __name__ == "__main__":
    unittest.main()
