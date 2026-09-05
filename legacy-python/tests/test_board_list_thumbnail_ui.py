"""Exercises the "게시글 목록에서 사진 미리보기" feature added to
pages/1_찾아요.py and pages/2_찾았어요.py's 키워드 검색 목록 (via
ui.common.render_post_thumbnail()).

LostPost/FoundPost each carry a single image_url column (see
db/schema.sql) -- there is no multi-image data structure in this project,
so "여러 장 첨부" doesn't apply; the tests below confirm the single-image
case renders correctly and that a missing/broken image_url degrades
gracefully instead of crashing the whole list.

Real PNG bytes (via Pillow) are used rather than fake placeholder bytes --
st.image() fails to load bytes that aren't a real, decodable image (this
was verified interactively before writing these tests), so a fake payload
would make every "image present" assertion here silently meaningless.

Following the isolation pattern from tests/test_file_upload_security.py,
ui.common.PROJECT_ROOT is monkeypatched to a temp directory for the
duration of each test -- nothing here touches the project's real uploads/
directory.
"""

import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from streamlit.testing.v1 import AppTest

from db import database as db
from ui import common

LOST_PAGE = str(Path(__file__).resolve().parent.parent / "pages" / "1_찾아요.py")
FOUND_PAGE = str(Path(__file__).resolve().parent.parent / "pages" / "2_찾았어요.py")


def _write_real_png(path: Path) -> None:
    from PIL import Image

    path.parent.mkdir(parents=True, exist_ok=True)
    Image.new("RGB", (4, 4), color=(255, 0, 0)).save(path)


class BoardListThumbnailUiTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp_db = Path(__file__).resolve().parent / "_tmp_board_thumbnail_ui.db"
        self._orig_db_path = db.DB_PATH
        db.DB_PATH = self._tmp_db
        if self._tmp_db.exists():
            self._tmp_db.unlink()
        db.init_db()

        self._project_tmp_dir = tempfile.TemporaryDirectory()
        self.project_root = Path(self._project_tmp_dir.name)
        self._patchers = [
            patch.object(common, "PROJECT_ROOT", self.project_root),
        ]
        for p in self._patchers:
            p.start()

        self.uid = db.create_user("student@mju.ac.kr", "학생")
        db.set_initial_nickname(self.uid, "학생닉네임")
        self._auth_patcher = patch("ui.auth.current_user_id", return_value=self.uid)
        self._auth_patcher.start()

    def tearDown(self):
        self._auth_patcher.stop()
        for p in self._patchers:
            p.stop()
        self._project_tmp_dir.cleanup()
        db.DB_PATH = self._orig_db_path
        if self._tmp_db.exists():
            self._tmp_db.unlink()

    # ---------- lost board ----------

    def test_lost_board_list_shows_thumbnail_for_post_with_image(self):
        _write_real_png(self.project_root / "uploads" / "lost_photo.png")
        db.create_lost_post(
            self.uid, "검은색 에어팟", "설명", "전자기기", "도서관", "2026-08-25 15:00",
            image_url="uploads/lost_photo.png",
        )
        db.create_lost_post(
            self.uid, "사진 없는 분실물", "설명", "기타", "장소", "2026-08-25 09:00",
        )

        at = AppTest.from_file(LOST_PAGE)
        at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        # exactly one post has an image -- exactly one thumbnail must render
        self.assertEqual(len(at.image), 1)
        markdowns = [m.value for m in at.markdown]
        self.assertTrue(any("검은색 에어팟" in m for m in markdowns))
        self.assertTrue(any("사진 없는 분실물" in m for m in markdowns))

    def test_lost_board_post_without_image_renders_normally(self):
        db.create_lost_post(
            self.uid, "사진 없는 분실물", "설명", "기타", "장소", "2026-08-25 09:00",
        )

        at = AppTest.from_file(LOST_PAGE)
        at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        self.assertEqual(len(at.image), 0)
        markdowns = [m.value for m in at.markdown]
        self.assertTrue(any("사진 없는 분실물" in m for m in markdowns))
        # 상세보기 버튼 등 기존 동작은 그대로 남아 있어야 함
        self.assertTrue(any(b.key.startswith("lost_detail_btn_") for b in at.button))

    def test_lost_board_broken_image_url_does_not_crash_list(self):
        db.create_lost_post(
            self.uid, "이미지가 깨진 분실물", "설명", "기타", "장소", "2026-08-25 09:00",
            image_url="uploads/does_not_exist.png",
        )
        db.create_lost_post(
            self.uid, "정상 분실물", "설명", "기타", "장소", "2026-08-25 10:00",
        )

        at = AppTest.from_file(LOST_PAGE)
        at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        self.assertEqual(len(at.image), 0)  # broken path -> resolve_image_path() returns None
        markdowns = [m.value for m in at.markdown]
        self.assertTrue(any("이미지가 깨진 분실물" in m for m in markdowns))
        self.assertTrue(any("정상 분실물" in m for m in markdowns))

    # ---------- found board (symmetric) ----------

    def test_found_board_list_shows_thumbnail_for_post_with_image(self):
        _write_real_png(self.project_root / "uploads" / "found_photo.png")
        db.create_found_post(
            self.uid, "검은색 무선 이어폰", "설명", "전자기기", "도서관", "2026-08-25 16:00",
            image_url="uploads/found_photo.png",
        )
        db.create_found_post(
            self.uid, "사진 없는 습득물", "설명", "기타", "장소", "2026-08-25 09:30",
        )

        at = AppTest.from_file(FOUND_PAGE)
        at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        self.assertEqual(len(at.image), 1)
        markdowns = [m.value for m in at.markdown]
        self.assertTrue(any("검은색 무선 이어폰" in m for m in markdowns))
        self.assertTrue(any("사진 없는 습득물" in m for m in markdowns))

    def test_found_board_post_without_image_renders_normally(self):
        db.create_found_post(
            self.uid, "사진 없는 습득물", "설명", "기타", "장소", "2026-08-25 09:30",
        )

        at = AppTest.from_file(FOUND_PAGE)
        at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        self.assertEqual(len(at.image), 0)
        markdowns = [m.value for m in at.markdown]
        self.assertTrue(any("사진 없는 습득물" in m for m in markdowns))
        self.assertTrue(any(b.key.startswith("found_detail_btn_") for b in at.button))

    def test_found_board_broken_image_url_does_not_crash_list(self):
        db.create_found_post(
            self.uid, "이미지가 깨진 습득물", "설명", "기타", "장소", "2026-08-25 09:30",
            image_url="uploads/does_not_exist.png",
        )
        db.create_found_post(
            self.uid, "정상 습득물", "설명", "기타", "장소", "2026-08-25 10:30",
        )

        at = AppTest.from_file(FOUND_PAGE)
        at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        self.assertEqual(len(at.image), 0)
        markdowns = [m.value for m in at.markdown]
        self.assertTrue(any("이미지가 깨진 습득물" in m for m in markdowns))
        self.assertTrue(any("정상 습득물" in m for m in markdowns))

    # ---------- multiple posts, mixed with/without images ----------

    def test_multiple_posts_each_show_at_most_their_own_single_image(self):
        """LostPost/FoundPost는 image_url 컬럼 하나뿐이라 "여러 장 첨부"
        데이터 구조 자체가 없다 -- 여러 게시글이 섞여 있을 때 각자 자기
        image_url 한 장만 정확히 반영되는지(다른 게시글 것과 섞이지
        않는지)를 대신 검증한다."""
        _write_real_png(self.project_root / "uploads" / "a.png")
        _write_real_png(self.project_root / "uploads" / "b.png")
        db.create_lost_post(
            self.uid, "게시글A", "설명", "기타", "장소", "2026-08-25 09:00", image_url="uploads/a.png",
        )
        db.create_lost_post(
            self.uid, "게시글B", "설명", "기타", "장소", "2026-08-25 09:10", image_url="uploads/b.png",
        )
        db.create_lost_post(
            self.uid, "게시글C(이미지없음)", "설명", "기타", "장소", "2026-08-25 09:20",
        )

        at = AppTest.from_file(LOST_PAGE)
        at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        self.assertEqual(len(at.image), 2)  # A, B만 -- C는 없음


class RenderPostThumbnailUnitTestCase(unittest.TestCase):
    """render_post_thumbnail() 자체에 대한 단위 테스트 -- 예외를 절대
    바깥으로 전파하지 않아야 한다는 방어적 계약을 직접 검증한다."""

    def setUp(self):
        self._tmp_dir = tempfile.TemporaryDirectory()
        self.project_root = Path(self._tmp_dir.name)
        self._patcher = patch.object(common, "PROJECT_ROOT", self.project_root)
        self._patcher.start()

    def tearDown(self):
        self._patcher.stop()
        self._tmp_dir.cleanup()

    def test_none_image_url_is_noop(self):
        common.render_post_thumbnail(None)  # must not raise

    def test_empty_string_image_url_is_noop(self):
        common.render_post_thumbnail("")  # must not raise

    def test_nonexistent_file_is_noop(self):
        common.render_post_thumbnail("uploads/nope.png")  # must not raise

    def test_file_with_invalid_image_content_is_noop(self):
        bad = self.project_root / "uploads" / "not_really_an_image.png"
        bad.parent.mkdir(parents=True, exist_ok=True)
        bad.write_bytes(b"this is not image data")
        common.render_post_thumbnail("uploads/not_really_an_image.png")  # must not raise


if __name__ == "__main__":
    unittest.main()
