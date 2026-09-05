import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from db import database


class DatabaseTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp_dir = tempfile.TemporaryDirectory()
        self._orig_db_path = database.DB_PATH
        database.DB_PATH = Path(self._tmp_dir.name) / "test_lost_found.db"
        database.init_db()

    def tearDown(self):
        database.DB_PATH = self._orig_db_path
        self._tmp_dir.cleanup()

    # ---------- helpers ----------

    def _make_user(self, email="test1@mju.ac.kr", name="테스트 사용자 1"):
        return database.create_user(email, name)

    def _make_lost_post(self, user_id, **overrides):
        fields = dict(
            user_id=user_id,
            title="검은색 에어팟",
            description="검은색 케이스, 흰색 스티커",
            category="전자기기",
            location="인문캠퍼스 도서관",
            lost_at="2026-08-25 15:00",
        )
        fields.update(overrides)
        return database.create_lost_post(**fields)

    def _make_found_post(self, user_id, **overrides):
        fields = dict(
            user_id=user_id,
            title="검은색 무선 이어폰",
            description="검은색 케이스, 흰색 스티커",
            category="전자기기",
            location="인문캠퍼스 도서관",
            found_at="2026-08-25 16:00",
        )
        fields.update(overrides)
        return database.create_found_post(**fields)

    # ---------- User CRUD ----------

    def test_user_crud(self):
        uid1 = self._make_user("test1@mju.ac.kr", "테스트 사용자 1")
        uid2 = self._make_user("test2@mju.ac.kr", "테스트 사용자 2")

        user1 = database.get_user_by_id(uid1)
        self.assertEqual(user1["email"], "test1@mju.ac.kr")
        self.assertEqual(user1["name"], "테스트 사용자 1")

        by_email = database.get_user_by_email("test2@mju.ac.kr")
        self.assertEqual(by_email["id"], uid2)

        users = database.list_users()
        self.assertEqual(len(users), 2)

        database.update_user(uid1, "테스트 사용자 1 수정")
        updated = database.get_user_by_id(uid1)
        self.assertEqual(updated["name"], "테스트 사용자 1 수정")

    def test_user_email_unique_constraint(self):
        self._make_user("dup@mju.ac.kr", "사용자 A")
        with self.assertRaises(sqlite3.IntegrityError):
            self._make_user("dup@mju.ac.kr", "사용자 B")

    # ---------- LostPost CRUD ----------

    def test_lost_post_crud(self):
        uid = self._make_user()
        pid = self._make_lost_post(uid)

        post = database.get_lost_post(pid)
        self.assertEqual(post["title"], "검은색 에어팟")
        self.assertEqual(post["status"], "찾는 중")

        posts = database.list_lost_posts()
        self.assertEqual(len(posts), 1)

        database.update_lost_post(pid, uid, title="검은색 에어팟 프로", status="찾음")
        updated = database.get_lost_post(pid)
        self.assertEqual(updated["title"], "검은색 에어팟 프로")
        self.assertEqual(updated["status"], "찾음")
        self.assertGreaterEqual(updated["updated_at"], post["updated_at"])

        database.delete_lost_post(pid, uid)
        self.assertIsNone(database.get_lost_post(pid))

    def test_lost_post_invalid_status_rejected(self):
        uid = self._make_user()
        with self.assertRaises(ValueError):
            self._make_lost_post(uid, status="알수없음")

        pid = self._make_lost_post(uid)
        with self.assertRaises(ValueError):
            database.update_lost_post(pid, uid, status="알수없음")

    # ---------- LostPost ownership enforcement ----------

    def test_lost_post_update_by_non_owner_rejected(self):
        owner = self._make_user("owner@mju.ac.kr", "작성자")
        other = self._make_user("other@mju.ac.kr", "다른사람")
        pid = self._make_lost_post(owner)

        with self.assertRaises(database.PermissionDeniedError):
            database.update_lost_post(pid, other, title="해킹 시도")

        # original data untouched
        post = database.get_lost_post(pid)
        self.assertEqual(post["title"], "검은색 에어팟")

    def test_lost_post_status_change_by_non_owner_rejected(self):
        owner = self._make_user("owner2@mju.ac.kr", "작성자")
        other = self._make_user("other2@mju.ac.kr", "다른사람")
        pid = self._make_lost_post(owner)

        with self.assertRaises(database.PermissionDeniedError):
            database.update_lost_post_status(pid, other, "찾음")

        post = database.get_lost_post(pid)
        self.assertEqual(post["status"], "찾는 중")

    def test_lost_post_delete_by_non_owner_rejected(self):
        owner = self._make_user("owner3@mju.ac.kr", "작성자")
        other = self._make_user("other3@mju.ac.kr", "다른사람")
        pid = self._make_lost_post(owner)

        with self.assertRaises(database.PermissionDeniedError):
            database.delete_lost_post(pid, other)

        # post must still exist
        self.assertIsNotNone(database.get_lost_post(pid))

    def test_lost_post_owner_can_change_status(self):
        uid = self._make_user()
        pid = self._make_lost_post(uid)
        database.update_lost_post_status(pid, uid, "찾음")
        self.assertEqual(database.get_lost_post(pid)["status"], "찾음")

    def test_update_delete_nonexistent_lost_post_raises_value_error(self):
        uid = self._make_user()
        with self.assertRaises(ValueError):
            database.update_lost_post(99999, uid, title="x")
        with self.assertRaises(ValueError):
            database.delete_lost_post(99999, uid)

    # ---------- FoundPost CRUD ----------

    def test_found_post_crud(self):
        uid = self._make_user()
        pid = self._make_found_post(uid)

        post = database.get_found_post(pid)
        self.assertEqual(post["title"], "검은색 무선 이어폰")
        self.assertEqual(post["status"], "보관 중")

        posts = database.list_found_posts()
        self.assertEqual(len(posts), 1)

        database.update_found_post(pid, uid, status="완료")
        updated = database.get_found_post(pid)
        self.assertEqual(updated["status"], "완료")

        database.delete_found_post(pid, uid)
        self.assertIsNone(database.get_found_post(pid))

    def test_found_post_invalid_status_rejected(self):
        uid = self._make_user()
        with self.assertRaises(ValueError):
            self._make_found_post(uid, status="완전종료")

    # ---------- FoundPost ownership enforcement ----------

    def test_found_post_update_by_non_owner_rejected(self):
        owner = self._make_user("owner4@mju.ac.kr", "작성자")
        other = self._make_user("other4@mju.ac.kr", "다른사람")
        pid = self._make_found_post(owner)

        with self.assertRaises(database.PermissionDeniedError):
            database.update_found_post(pid, other, title="해킹 시도")

        post = database.get_found_post(pid)
        self.assertEqual(post["title"], "검은색 무선 이어폰")

    def test_found_post_status_change_by_non_owner_rejected(self):
        owner = self._make_user("owner5@mju.ac.kr", "작성자")
        other = self._make_user("other5@mju.ac.kr", "다른사람")
        pid = self._make_found_post(owner)

        with self.assertRaises(database.PermissionDeniedError):
            database.update_found_post_status(pid, other, "완료")

        post = database.get_found_post(pid)
        self.assertEqual(post["status"], "보관 중")

    def test_found_post_delete_by_non_owner_rejected(self):
        owner = self._make_user("owner6@mju.ac.kr", "작성자")
        other = self._make_user("other6@mju.ac.kr", "다른사람")
        pid = self._make_found_post(owner)

        with self.assertRaises(database.PermissionDeniedError):
            database.delete_found_post(pid, other)

        self.assertIsNotNone(database.get_found_post(pid))

    def test_found_post_owner_can_change_status(self):
        uid = self._make_user()
        pid = self._make_found_post(uid)
        database.update_found_post_status(pid, uid, "완료")
        self.assertEqual(database.get_found_post(pid)["status"], "완료")

    # ---------- Match CRUD ----------

    def test_match_crud(self):
        uid = self._make_user()
        lost_id = self._make_lost_post(uid)
        found_id = self._make_found_post(uid)

        match_id = database.create_match(lost_id, found_id, 0.92, uid)
        match = database.get_match(match_id)
        self.assertEqual(match["lost_post_id"], lost_id)
        self.assertEqual(match["found_post_id"], found_id)
        self.assertAlmostEqual(match["score"], 0.92)

        by_lost = database.list_matches_for_lost_post(lost_id)
        self.assertEqual(len(by_lost), 1)

        by_found = database.list_matches_for_found_post(found_id)
        self.assertEqual(len(by_found), 1)

        self.assertEqual(database.get_match_by_posts(lost_id, found_id)["id"], match_id)
        self.assertIsNone(database.get_match_by_posts(lost_id, 99999))

    # ---------- Match ownership / duplicate prevention ----------

    def test_match_created_by_lost_post_owner(self):
        lost_owner = self._make_user("lostowner@mju.ac.kr", "분실자")
        found_owner = self._make_user("foundowner@mju.ac.kr", "습득자")
        lost_id = self._make_lost_post(lost_owner)
        found_id = self._make_found_post(found_owner)

        match_id = database.create_match(lost_id, found_id, 0.91, lost_owner)
        match = database.get_match(match_id)
        self.assertEqual(match["lost_post_id"], lost_id)
        self.assertEqual(match["found_post_id"], found_id)

    def test_match_created_by_found_post_owner(self):
        lost_owner = self._make_user("lostowner2@mju.ac.kr", "분실자")
        found_owner = self._make_user("foundowner2@mju.ac.kr", "습득자")
        lost_id = self._make_lost_post(lost_owner)
        found_id = self._make_found_post(found_owner)

        match_id = database.create_match(lost_id, found_id, 0.88, found_owner)
        match = database.get_match(match_id)
        self.assertEqual(match["lost_post_id"], lost_id)
        self.assertEqual(match["found_post_id"], found_id)

    def test_match_rejected_for_user_who_owns_neither_post(self):
        lost_owner = self._make_user("lostowner3@mju.ac.kr", "분실자")
        found_owner = self._make_user("foundowner3@mju.ac.kr", "습득자")
        stranger = self._make_user("stranger@mju.ac.kr", "제3자")
        lost_id = self._make_lost_post(lost_owner)
        found_id = self._make_found_post(found_owner)

        with self.assertRaises(database.PermissionDeniedError):
            database.create_match(lost_id, found_id, 0.5, stranger)
        self.assertIsNone(database.get_match_by_posts(lost_id, found_id))

    def test_match_duplicate_returns_existing_id_without_creating_new_row(self):
        uid = self._make_user()
        lost_id = self._make_lost_post(uid)
        found_id = self._make_found_post(uid)

        first_id = database.create_match(lost_id, found_id, 0.7, uid)
        second_id = database.create_match(lost_id, found_id, 0.99, uid)

        self.assertEqual(first_id, second_id)
        self.assertEqual(len(database.list_matches_for_lost_post(lost_id)), 1)
        # score from the first confirmation is preserved, not silently overwritten
        self.assertAlmostEqual(database.get_match(first_id)["score"], 0.7)

    def test_match_unique_constraint_enforced_even_via_raw_connection(self):
        """Duplicate prevention holds even if create_match() is bypassed entirely."""
        uid = self._make_user()
        lost_id = self._make_lost_post(uid)
        found_id = self._make_found_post(uid)
        database.create_match(lost_id, found_id, 0.7, uid)

        with self.assertRaises(sqlite3.IntegrityError):
            with database.get_connection() as conn:
                conn.execute(
                    "INSERT INTO Match (lost_post_id, found_post_id, score) VALUES (?, ?, ?)",
                    (lost_id, found_id, 0.42),
                )

    def test_match_score_stored_exactly_as_given(self):
        uid = self._make_user()
        lost_id = self._make_lost_post(uid)
        found_id = self._make_found_post(uid)

        ai_score = 0.906512  # e.g. an ai.matching.MatchCandidate.score value
        match_id = database.create_match(lost_id, found_id, ai_score, uid)
        self.assertAlmostEqual(database.get_match(match_id)["score"], ai_score, places=6)

    # ---------- list_matches_by_user ----------

    def test_list_matches_by_user_finds_match_as_lost_post_owner(self):
        lost_owner = self._make_user("lo1@mju.ac.kr", "분실자")
        found_owner = self._make_user("fo1@mju.ac.kr", "습득자")
        lost_id = self._make_lost_post(lost_owner)
        found_id = self._make_found_post(found_owner)
        database.create_match(lost_id, found_id, 0.87, lost_owner)

        matches = database.list_matches_by_user(lost_owner)
        self.assertEqual(len(matches), 1)
        row = matches[0]
        self.assertEqual(row["lost_post_id"], lost_id)
        self.assertEqual(row["found_post_id"], found_id)
        self.assertEqual(row["lost_title"], "검은색 에어팟")
        self.assertEqual(row["found_title"], "검은색 무선 이어폰")
        self.assertAlmostEqual(row["score"], 0.87)

    def test_list_matches_by_user_finds_match_as_found_post_owner(self):
        lost_owner = self._make_user("lo2@mju.ac.kr", "분실자")
        found_owner = self._make_user("fo2@mju.ac.kr", "습득자")
        lost_id = self._make_lost_post(lost_owner)
        found_id = self._make_found_post(found_owner)
        database.create_match(lost_id, found_id, 0.75, found_owner)

        matches = database.list_matches_by_user(found_owner)
        self.assertEqual(len(matches), 1)
        self.assertEqual(matches[0]["match_id"], database.get_match_by_posts(lost_id, found_id)["id"])

    def test_list_matches_by_user_excludes_unrelated_users(self):
        lost_owner = self._make_user("lo3@mju.ac.kr", "분실자")
        found_owner = self._make_user("fo3@mju.ac.kr", "습득자")
        stranger = self._make_user("stranger3@mju.ac.kr", "제3자")
        lost_id = self._make_lost_post(lost_owner)
        found_id = self._make_found_post(found_owner)
        database.create_match(lost_id, found_id, 0.8, lost_owner)

        self.assertEqual(database.list_matches_by_user(stranger), [])

    def test_list_matches_by_user_empty_for_user_with_no_matches(self):
        uid = self._make_user()
        self.assertEqual(database.list_matches_by_user(uid), [])

    # ---------- delete_match ----------

    def test_delete_match_by_lost_post_owner(self):
        lost_owner = self._make_user("lo4@mju.ac.kr", "분실자")
        found_owner = self._make_user("fo4@mju.ac.kr", "습득자")
        lost_id = self._make_lost_post(lost_owner)
        found_id = self._make_found_post(found_owner)
        match_id = database.create_match(lost_id, found_id, 0.8, lost_owner)

        database.delete_match(match_id, lost_owner)
        self.assertIsNone(database.get_match(match_id))

    def test_delete_match_by_found_post_owner(self):
        lost_owner = self._make_user("lo5@mju.ac.kr", "분실자")
        found_owner = self._make_user("fo5@mju.ac.kr", "습득자")
        lost_id = self._make_lost_post(lost_owner)
        found_id = self._make_found_post(found_owner)
        match_id = database.create_match(lost_id, found_id, 0.8, found_owner)

        database.delete_match(match_id, found_owner)
        self.assertIsNone(database.get_match(match_id))

    def test_delete_match_rejected_for_unrelated_user(self):
        lost_owner = self._make_user("lo6@mju.ac.kr", "분실자")
        found_owner = self._make_user("fo6@mju.ac.kr", "습득자")
        stranger = self._make_user("stranger6@mju.ac.kr", "제3자")
        lost_id = self._make_lost_post(lost_owner)
        found_id = self._make_found_post(found_owner)
        match_id = database.create_match(lost_id, found_id, 0.8, lost_owner)

        with self.assertRaises(database.PermissionDeniedError):
            database.delete_match(match_id, stranger)
        self.assertIsNotNone(database.get_match(match_id))

    def test_delete_nonexistent_match_raises_value_error(self):
        uid = self._make_user()
        with self.assertRaises(ValueError):
            database.delete_match(99999, uid)

    def test_delete_match_does_not_touch_posts_or_their_status(self):
        lost_owner = self._make_user("lo7@mju.ac.kr", "분실자")
        found_owner = self._make_user("fo7@mju.ac.kr", "습득자")
        lost_id = self._make_lost_post(lost_owner)
        found_id = self._make_found_post(found_owner)
        match_id = database.create_match(lost_id, found_id, 0.8, lost_owner)

        database.delete_match(match_id, lost_owner)

        lost_post = database.get_lost_post(lost_id)
        found_post = database.get_found_post(found_id)
        self.assertIsNotNone(lost_post)
        self.assertIsNotNone(found_post)
        self.assertEqual(lost_post["status"], "찾는 중")
        self.assertEqual(found_post["status"], "보관 중")

    # ---------- Match deletion lifecycle (ON DELETE CASCADE) ----------

    def test_deleting_lost_post_cascades_to_its_match(self):
        uid = self._make_user()
        lost_id = self._make_lost_post(uid)
        found_id = self._make_found_post(uid)
        match_id = database.create_match(lost_id, found_id, 0.8, uid)

        database.delete_lost_post(lost_id, uid)

        self.assertIsNone(database.get_match(match_id))

    def test_deleting_found_post_cascades_to_its_match(self):
        uid = self._make_user()
        lost_id = self._make_lost_post(uid)
        found_id = self._make_found_post(uid)
        match_id = database.create_match(lost_id, found_id, 0.8, uid)

        database.delete_found_post(found_id, uid)

        self.assertIsNone(database.get_match(match_id))

    def test_deleting_lost_post_does_not_delete_the_found_post(self):
        uid = self._make_user()
        lost_id = self._make_lost_post(uid)
        found_id = self._make_found_post(uid)
        database.create_match(lost_id, found_id, 0.8, uid)

        database.delete_lost_post(lost_id, uid)

        self.assertIsNotNone(database.get_found_post(found_id))

    def test_deleting_found_post_does_not_delete_the_lost_post(self):
        uid = self._make_user()
        lost_id = self._make_lost_post(uid)
        found_id = self._make_found_post(uid)
        database.create_match(lost_id, found_id, 0.8, uid)

        database.delete_found_post(found_id, uid)

        self.assertIsNotNone(database.get_lost_post(lost_id))

    def test_deleting_lost_post_no_integrity_error_and_leaves_unrelated_match_intact(self):
        uid = self._make_user()
        lost_id = self._make_lost_post(uid, title="분실물 삭제 대상")
        found_id = self._make_found_post(uid)
        other_lost_id = self._make_lost_post(uid, title="다른 분실물")

        target_match_id = database.create_match(lost_id, found_id, 0.8, uid)
        other_match_id = database.create_match(other_lost_id, found_id, 0.6, uid)

        try:
            database.delete_lost_post(lost_id, uid)
        except sqlite3.IntegrityError:
            self.fail("deleting a LostPost with a Match must not raise IntegrityError")

        self.assertIsNone(database.get_match(target_match_id))
        self.assertIsNotNone(database.get_match(other_match_id))

    def test_deleting_found_post_no_integrity_error_and_leaves_unrelated_match_intact(self):
        uid = self._make_user()
        found_id = self._make_found_post(uid, title="습득물 삭제 대상")
        lost_id = self._make_lost_post(uid)
        other_found_id = self._make_found_post(uid, title="다른 습득물")

        target_match_id = database.create_match(lost_id, found_id, 0.8, uid)
        other_match_id = database.create_match(lost_id, other_found_id, 0.6, uid)

        try:
            database.delete_found_post(found_id, uid)
        except sqlite3.IntegrityError:
            self.fail("deleting a FoundPost with a Match must not raise IntegrityError")

        self.assertIsNone(database.get_match(target_match_id))
        self.assertIsNotNone(database.get_match(other_match_id))

    def test_deleting_post_with_multiple_matches_removes_all_of_them(self):
        uid = self._make_user()
        lost_id = self._make_lost_post(uid)
        found_ids = [self._make_found_post(uid, title=f"습득물 {i}") for i in range(3)]
        match_ids = [database.create_match(lost_id, fid, 0.5, uid) for fid in found_ids]

        database.delete_lost_post(lost_id, uid)

        for match_id in match_ids:
            self.assertIsNone(database.get_match(match_id))

    def test_deleted_post_match_no_longer_appears_in_list_matches_by_user(self):
        lost_owner = self._make_user("lo8@mju.ac.kr", "분실자")
        found_owner = self._make_user("fo8@mju.ac.kr", "습득자")
        lost_id = self._make_lost_post(lost_owner)
        found_id = self._make_found_post(found_owner)
        database.create_match(lost_id, found_id, 0.8, lost_owner)

        database.delete_lost_post(lost_id, lost_owner)

        self.assertEqual(database.list_matches_by_user(lost_owner), [])
        self.assertEqual(database.list_matches_by_user(found_owner), [])

    def test_post_ownership_still_enforced_after_cascade_migration(self):
        """Regression: the cascade migration must not weaken normal delete
        ownership checks for posts that have no Match at all."""
        owner = self._make_user("owner_regress@mju.ac.kr", "작성자")
        other = self._make_user("other_regress@mju.ac.kr", "다른사람")
        lost_id = self._make_lost_post(owner)
        found_id = self._make_found_post(owner)

        with self.assertRaises(database.PermissionDeniedError):
            database.delete_lost_post(lost_id, other)
        with self.assertRaises(database.PermissionDeniedError):
            database.delete_found_post(found_id, other)

        self.assertIsNotNone(database.get_lost_post(lost_id))
        self.assertIsNotNone(database.get_found_post(found_id))

    # ---------- Relationship tests ----------

    def test_one_user_multiple_lost_posts(self):
        uid = self._make_user()
        for i in range(3):
            self._make_lost_post(uid, title=f"분실물 {i}")
        posts = database.list_lost_posts_by_user(uid)
        self.assertEqual(len(posts), 3)

    def test_one_user_multiple_found_posts(self):
        uid = self._make_user()
        for i in range(3):
            self._make_found_post(uid, title=f"습득물 {i}")
        posts = database.list_found_posts_by_user(uid)
        self.assertEqual(len(posts), 3)

    def test_one_lost_post_matches_multiple_found_posts(self):
        uid = self._make_user()
        lost_id = self._make_lost_post(uid)
        found_ids = [self._make_found_post(uid, title=f"습득물 {i}") for i in range(3)]
        for i, found_id in enumerate(found_ids):
            database.create_match(lost_id, found_id, 0.5 + i * 0.1, uid)

        matches = database.list_matches_for_lost_post(lost_id)
        self.assertEqual(len(matches), 3)
        # ordered by score DESC
        scores = [m["score"] for m in matches]
        self.assertEqual(scores, sorted(scores, reverse=True))

    def test_one_found_post_matches_multiple_lost_posts(self):
        uid = self._make_user()
        found_id = self._make_found_post(uid)
        lost_ids = [self._make_lost_post(uid, title=f"분실물 {i}") for i in range(3)]
        for lost_id in lost_ids:
            database.create_match(lost_id, found_id, 0.7, uid)

        matches = database.list_matches_for_found_post(found_id)
        self.assertEqual(len(matches), 3)

    # ---------- Foreign key enforcement ----------

    def test_lost_post_rejects_nonexistent_user(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self._make_lost_post(user_id=99999)

    def test_found_post_rejects_nonexistent_user(self):
        with self.assertRaises(sqlite3.IntegrityError):
            self._make_found_post(user_id=99999)

    def test_match_rejects_nonexistent_lost_post(self):
        uid = self._make_user()
        found_id = self._make_found_post(uid)
        with self.assertRaises(ValueError):
            database.create_match(99999, found_id, 0.5, uid)

    def test_match_rejects_nonexistent_found_post(self):
        uid = self._make_user()
        lost_id = self._make_lost_post(uid)
        with self.assertRaises(ValueError):
            database.create_match(lost_id, 99999, 0.5, uid)

    # ---------- SQL injection resistance ----------

    def test_sql_injection_in_text_fields_is_stored_literally(self):
        uid = self._make_user()
        malicious = "'; DROP TABLE User; --"
        pid = self._make_lost_post(uid, title=malicious)
        post = database.get_lost_post(pid)
        self.assertEqual(post["title"], malicious)
        # User table must still exist and be queryable
        self.assertEqual(len(database.list_users()), 1)

    # ---------- Data format validation ----------

    def test_invalid_datetime_format_rejected(self):
        uid = self._make_user()
        with self.assertRaises(ValueError):
            self._make_lost_post(uid, lost_at="8월 25일 15시")

    # ---------- Search ----------

    def test_search_lost_posts_by_keyword(self):
        uid = self._make_user()
        self._make_lost_post(uid, title="검은색 에어팟")
        self._make_lost_post(uid, title="파란색 우산")

        results = database.search_lost_posts(keyword="에어팟")
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["title"], "검은색 에어팟")

    def test_search_lost_posts_by_category_and_status(self):
        uid = self._make_user()
        self._make_lost_post(uid, title="에어팟", category="전자기기")
        self._make_lost_post(uid, title="지갑", category="지갑")

        results = database.search_lost_posts(category="지갑")
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["title"], "지갑")

        results = database.search_lost_posts(status="찾는 중")
        self.assertEqual(len(results), 2)
        results = database.search_lost_posts(status="찾음")
        self.assertEqual(len(results), 0)

    def test_search_found_posts_by_keyword(self):
        uid = self._make_user()
        self._make_found_post(uid, title="검은색 무선 이어폰")
        self._make_found_post(uid, title="검은색 우산")

        results = database.search_found_posts(keyword="이어폰")
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["title"], "검은색 무선 이어폰")

    def test_search_lost_posts_never_returns_found_posts_with_same_keyword(self):
        """회귀 테스트: LostPost/FoundPost 양쪽에 같은 키워드가 포함된
        게시글이 있어도, search_lost_posts()는 LostPost만 반환해야 한다."""
        uid = self._make_user()
        self._make_lost_post(uid, title="검은색 무선이어폰 분실")
        self._make_found_post(uid, title="검은색 무선이어폰 습득")

        results = database.search_lost_posts(keyword="무선이어폰")
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["title"], "검은색 무선이어폰 분실")

    def test_search_found_posts_never_returns_lost_posts_with_same_keyword(self):
        """회귀 테스트: search_found_posts()도 마찬가지로 FoundPost만
        반환해야 한다 (반대 방향)."""
        uid = self._make_user()
        self._make_lost_post(uid, title="검은색 무선이어폰 분실")
        self._make_found_post(uid, title="검은색 무선이어폰 습득")

        results = database.search_found_posts(keyword="무선이어폰")
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["title"], "검은색 무선이어폰 습득")


class MatchCascadeMigrationTestCase(unittest.TestCase):
    """A DB built against the pre-CASCADE Match schema, with real data in
    it, must be migrated in place (no data loss) the first time init_db()
    runs against it -- this is the scenario a pre-existing lost_found.db
    from before this change would be in."""

    _LEGACY_SCHEMA = """
        PRAGMA foreign_keys = ON;
        CREATE TABLE User (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE LostPost (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES User(id),
            title TEXT NOT NULL, description TEXT NOT NULL, category TEXT NOT NULL,
            location TEXT NOT NULL, lost_at TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT '찾는 중' CHECK (status IN ('찾는 중', '찾음')),
            image_url TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE FoundPost (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES User(id),
            title TEXT NOT NULL, description TEXT NOT NULL, category TEXT NOT NULL,
            location TEXT NOT NULL, found_at TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT '보관 중' CHECK (status IN ('보관 중', '완료')),
            image_url TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE Match (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            lost_post_id INTEGER NOT NULL REFERENCES LostPost(id),
            found_post_id INTEGER NOT NULL REFERENCES FoundPost(id),
            score REAL NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE (lost_post_id, found_post_id)
        );
    """

    def setUp(self):
        self._tmp_dir = tempfile.TemporaryDirectory()
        self._orig_db_path = database.DB_PATH
        database.DB_PATH = Path(self._tmp_dir.name) / "legacy.db"

        conn = sqlite3.connect(database.DB_PATH)
        conn.executescript(self._LEGACY_SCHEMA)
        conn.execute("INSERT INTO User (email, name) VALUES ('legacy@mju.ac.kr', '기존사용자')")
        conn.execute(
            "INSERT INTO LostPost (user_id, title, description, category, location, lost_at) "
            "VALUES (1, '기존 분실물', '설명', '기타', '장소', '2026-08-20 10:00')"
        )
        conn.execute(
            "INSERT INTO FoundPost (user_id, title, description, category, location, found_at) "
            "VALUES (1, '기존 습득물', '설명', '기타', '장소', '2026-08-20 11:00')"
        )
        conn.execute("INSERT INTO Match (lost_post_id, found_post_id, score) VALUES (1, 1, 0.77)")
        conn.commit()
        conn.close()

    def tearDown(self):
        database.DB_PATH = self._orig_db_path
        self._tmp_dir.cleanup()

    def test_migration_preserves_existing_rows(self):
        database.init_db()

        self.assertEqual(len(database.list_users()), 1)
        self.assertIsNotNone(database.get_lost_post(1))
        self.assertIsNotNone(database.get_found_post(1))
        match = database.get_match(1)
        self.assertIsNotNone(match)
        self.assertAlmostEqual(match["score"], 0.77)

    def test_migration_enables_cascade_delete(self):
        database.init_db()

        database.delete_lost_post(1, 1)

        self.assertIsNone(database.get_match(1))
        self.assertIsNotNone(database.get_found_post(1))

    def test_migration_is_idempotent(self):
        database.init_db()
        database.init_db()  # second run must be a no-op, not an error

        self.assertIsNotNone(database.get_match(1))
        conn = sqlite3.connect(database.DB_PATH)
        try:
            fk_rows = conn.execute("PRAGMA foreign_key_list(Match)").fetchall()
        finally:
            conn.close()
        # PRAGMA foreign_key_list columns: id, seq, table, from, to, on_update, on_delete, match
        self.assertTrue(all(row[6] == "CASCADE" for row in fk_rows))


class ChatTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp_dir = tempfile.TemporaryDirectory()
        self._orig_db_path = database.DB_PATH
        database.DB_PATH = Path(self._tmp_dir.name) / "test_chat.db"
        database.init_db()

        self.lost_owner = database.create_user("lostowner@mju.ac.kr", "분실자실명")
        self.found_owner = database.create_user("foundowner@mju.ac.kr", "습득자실명")
        self.stranger = database.create_user("stranger@mju.ac.kr", "제3자실명")
        database.set_initial_nickname(self.lost_owner, "분실자")
        database.set_initial_nickname(self.found_owner, "습득자")
        database.set_initial_nickname(self.stranger, "제3자")
        self.lost_id = database.create_lost_post(
            self.lost_owner, "검은색 에어팟", "설명", "전자기기", "도서관", "2026-08-25 15:00"
        )
        self.found_id = database.create_found_post(
            self.found_owner, "검은색 무선 이어폰", "설명", "전자기기", "도서관", "2026-08-25 16:00"
        )
        self.match_id = database.create_match(self.lost_id, self.found_id, 0.9, self.lost_owner)

    def tearDown(self):
        database.DB_PATH = self._orig_db_path
        self._tmp_dir.cleanup()

    # ---------- get_or_create_chat_room ----------

    def test_get_or_create_chat_room_creates_once(self):
        room1 = database.get_or_create_chat_room(self.match_id, self.lost_owner)
        room2 = database.get_or_create_chat_room(self.match_id, self.found_owner)
        self.assertEqual(room1["id"], room2["id"])
        self.assertEqual(room1["match_id"], self.match_id)

    def test_both_participants_can_create_or_get_chat_room(self):
        room_by_lost = database.get_or_create_chat_room(self.match_id, self.lost_owner)
        room_by_found = database.get_or_create_chat_room(self.match_id, self.found_owner)
        self.assertEqual(room_by_lost["id"], room_by_found["id"])

    def test_stranger_cannot_create_chat_room(self):
        with self.assertRaises(database.PermissionDeniedError):
            database.get_or_create_chat_room(self.match_id, self.stranger)

    def test_get_or_create_chat_room_rejects_nonexistent_match(self):
        with self.assertRaises(ValueError):
            database.get_or_create_chat_room(99999, self.lost_owner)

    def test_chat_room_unique_per_match_even_via_raw_connection(self):
        """Duplicate prevention holds even if get_or_create_chat_room() is bypassed."""
        database.get_or_create_chat_room(self.match_id, self.lost_owner)
        with self.assertRaises(sqlite3.IntegrityError):
            with database.get_connection() as conn:
                conn.execute("INSERT INTO ChatRoom (match_id) VALUES (?)", (self.match_id,))

    # ---------- get_chat_room ----------

    def test_get_chat_room_allows_both_participants(self):
        room = database.get_or_create_chat_room(self.match_id, self.lost_owner)
        self.assertEqual(database.get_chat_room(room["id"], self.lost_owner)["id"], room["id"])
        self.assertEqual(database.get_chat_room(room["id"], self.found_owner)["id"], room["id"])

    def test_get_chat_room_rejects_stranger(self):
        room = database.get_or_create_chat_room(self.match_id, self.lost_owner)
        with self.assertRaises(database.PermissionDeniedError):
            database.get_chat_room(room["id"], self.stranger)

    def test_get_chat_room_rejects_nonexistent_room(self):
        with self.assertRaises(ValueError):
            database.get_chat_room(99999, self.lost_owner)

    # ---------- send_message / list_messages ----------

    def test_send_message_and_list_messages_time_order(self):
        room = database.get_or_create_chat_room(self.match_id, self.lost_owner)
        database.send_message(room["id"], self.lost_owner, "안녕하세요, 제 에어팟 같아요!")
        database.send_message(room["id"], self.found_owner, "네 맞는 것 같아요!")

        messages = database.list_messages(room["id"], self.lost_owner)
        self.assertEqual(len(messages), 2)
        self.assertEqual(messages[0]["content"], "안녕하세요, 제 에어팟 같아요!")
        self.assertEqual(messages[1]["content"], "네 맞는 것 같아요!")
        self.assertEqual(messages[0]["sender_user_id"], self.lost_owner)
        self.assertEqual(messages[1]["sender_user_id"], self.found_owner)
        self.assertEqual(messages[0]["sender_nickname"], "분실자")
        self.assertEqual(messages[1]["sender_nickname"], "습득자")

    def test_both_participants_can_send_messages(self):
        room = database.get_or_create_chat_room(self.match_id, self.lost_owner)
        m1 = database.send_message(room["id"], self.lost_owner, "hi")
        m2 = database.send_message(room["id"], self.found_owner, "hello")
        self.assertEqual(m1["sender_user_id"], self.lost_owner)
        self.assertEqual(m2["sender_user_id"], self.found_owner)

    def test_stranger_cannot_send_message(self):
        room = database.get_or_create_chat_room(self.match_id, self.lost_owner)
        with self.assertRaises(database.PermissionDeniedError):
            database.send_message(room["id"], self.stranger, "몰래 보낼래요")
        self.assertEqual(database.list_messages(room["id"], self.lost_owner), [])

    def test_stranger_cannot_list_messages(self):
        room = database.get_or_create_chat_room(self.match_id, self.lost_owner)
        database.send_message(room["id"], self.lost_owner, "hi")
        with self.assertRaises(database.PermissionDeniedError):
            database.list_messages(room["id"], self.stranger)

    def test_empty_message_rejected(self):
        room = database.get_or_create_chat_room(self.match_id, self.lost_owner)
        with self.assertRaises(ValueError):
            database.send_message(room["id"], self.lost_owner, "")

    def test_whitespace_only_message_rejected(self):
        room = database.get_or_create_chat_room(self.match_id, self.lost_owner)
        with self.assertRaises(ValueError):
            database.send_message(room["id"], self.lost_owner, "   \n\t  ")

    def test_message_content_is_trimmed(self):
        room = database.get_or_create_chat_room(self.match_id, self.lost_owner)
        msg = database.send_message(room["id"], self.lost_owner, "  안녕하세요  ")
        self.assertEqual(msg["content"], "안녕하세요")

    def test_sender_user_id_cannot_be_forged(self):
        """send_message() only accepts requesting_user_id as the sender --
        there's no parameter that would let a caller name a different sender."""
        import inspect

        params = list(inspect.signature(database.send_message).parameters)
        self.assertEqual(params, ["chat_room_id", "requesting_user_id", "content"])

        room = database.get_or_create_chat_room(self.match_id, self.lost_owner)
        msg = database.send_message(room["id"], self.found_owner, "hi")
        self.assertEqual(msg["sender_user_id"], self.found_owner)

    def test_list_messages_on_room_with_no_messages_returns_empty(self):
        room = database.get_or_create_chat_room(self.match_id, self.lost_owner)
        self.assertEqual(database.list_messages(room["id"], self.lost_owner), [])

    # ---------- CASCADE lifecycle ----------

    def test_match_deletion_cascades_chat_room_and_messages(self):
        room = database.get_or_create_chat_room(self.match_id, self.lost_owner)
        msg = database.send_message(room["id"], self.lost_owner, "hi")

        database.delete_match(self.match_id, self.lost_owner)

        with database.get_connection() as conn:
            self.assertIsNone(
                conn.execute("SELECT * FROM ChatRoom WHERE id = ?", (room["id"],)).fetchone()
            )
            self.assertIsNone(
                conn.execute("SELECT * FROM Message WHERE id = ?", (msg["id"],)).fetchone()
            )

    def test_lost_post_deletion_cascades_match_chat_room_and_messages(self):
        room = database.get_or_create_chat_room(self.match_id, self.lost_owner)
        msg = database.send_message(room["id"], self.lost_owner, "hi")

        database.delete_lost_post(self.lost_id, self.lost_owner)

        self.assertIsNone(database.get_match(self.match_id))
        with database.get_connection() as conn:
            self.assertIsNone(
                conn.execute("SELECT * FROM ChatRoom WHERE id = ?", (room["id"],)).fetchone()
            )
            self.assertIsNone(
                conn.execute("SELECT * FROM Message WHERE id = ?", (msg["id"],)).fetchone()
            )
        self.assertIsNotNone(database.get_found_post(self.found_id))

    def test_found_post_deletion_cascades_match_chat_room_and_messages(self):
        room = database.get_or_create_chat_room(self.match_id, self.lost_owner)
        msg = database.send_message(room["id"], self.found_owner, "hi")

        database.delete_found_post(self.found_id, self.found_owner)

        self.assertIsNone(database.get_match(self.match_id))
        with database.get_connection() as conn:
            self.assertIsNone(
                conn.execute("SELECT * FROM ChatRoom WHERE id = ?", (room["id"],)).fetchone()
            )
            self.assertIsNone(
                conn.execute("SELECT * FROM Message WHERE id = ?", (msg["id"],)).fetchone()
            )
        self.assertIsNotNone(database.get_lost_post(self.lost_id))

    def test_existing_match_permission_checks_unaffected_by_chat_tables(self):
        """Regression: adding ChatRoom/Message must not weaken Match's own
        ownership checks."""
        with self.assertRaises(database.PermissionDeniedError):
            database.create_match(self.lost_id, self.found_id, 0.5, self.stranger)
        with self.assertRaises(database.PermissionDeniedError):
            database.delete_match(self.match_id, self.stranger)

    def test_cascade_delete_still_removes_messages_with_read_at_column_present(self):
        """Regression: adding Message.read_at must not break the existing
        Match -> ChatRoom -> Message CASCADE chain."""
        room = database.get_or_create_chat_room(self.match_id, self.lost_owner)
        msg = database.send_message(room["id"], self.lost_owner, "hi")
        database.mark_messages_as_read(room["id"], self.found_owner)

        database.delete_match(self.match_id, self.lost_owner)

        with database.get_connection() as conn:
            self.assertIsNone(
                conn.execute("SELECT * FROM Message WHERE id = ?", (msg["id"],)).fetchone()
            )


class ChatReadStatusTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp_dir = tempfile.TemporaryDirectory()
        self._orig_db_path = database.DB_PATH
        database.DB_PATH = Path(self._tmp_dir.name) / "test_chat_read.db"
        database.init_db()

        self.lost_owner = database.create_user("lostowner@mju.ac.kr", "분실자")
        self.found_owner = database.create_user("foundowner@mju.ac.kr", "습득자")
        self.stranger = database.create_user("stranger@mju.ac.kr", "제3자")
        self.lost_id = database.create_lost_post(
            self.lost_owner, "검은색 에어팟", "설명", "전자기기", "도서관", "2026-08-25 15:00"
        )
        self.found_id = database.create_found_post(
            self.found_owner, "검은색 무선 이어폰", "설명", "전자기기", "도서관", "2026-08-25 16:00"
        )
        self.match_id = database.create_match(self.lost_id, self.found_id, 0.9, self.lost_owner)
        self.room = database.get_or_create_chat_room(self.match_id, self.lost_owner)

    def tearDown(self):
        database.DB_PATH = self._orig_db_path
        self._tmp_dir.cleanup()

    # ---------- basic read_at behavior ----------

    def test_new_message_defaults_to_unread(self):
        msg = database.send_message(self.room["id"], self.lost_owner, "hi")
        self.assertIsNone(msg["read_at"])

    def test_participant_can_mark_messages_as_read(self):
        database.send_message(self.room["id"], self.lost_owner, "hi")
        updated = database.mark_messages_as_read(self.room["id"], self.found_owner)
        self.assertEqual(updated, 1)

    def test_only_other_participants_messages_are_marked_read(self):
        database.send_message(self.room["id"], self.lost_owner, "A가 보낸 메시지")
        database.send_message(self.room["id"], self.found_owner, "B가 보낸 메시지")

        database.mark_messages_as_read(self.room["id"], self.lost_owner)

        messages = database.list_messages(self.room["id"], self.lost_owner)
        by_sender = {m["sender_user_id"]: m for m in messages}
        self.assertIsNone(by_sender[self.lost_owner]["read_at"])  # my own message: untouched
        self.assertIsNotNone(by_sender[self.found_owner]["read_at"])  # the other's: read

    def test_already_read_message_is_not_changed_again(self):
        database.send_message(self.room["id"], self.found_owner, "hi")
        database.mark_messages_as_read(self.room["id"], self.lost_owner)
        messages = database.list_messages(self.room["id"], self.lost_owner)
        first_read_at = messages[0]["read_at"]

        # mark again -- rowcount should be 0 and the timestamp must not move
        updated = database.mark_messages_as_read(self.room["id"], self.lost_owner)
        self.assertEqual(updated, 0)
        messages_again = database.list_messages(self.room["id"], self.lost_owner)
        self.assertEqual(messages_again[0]["read_at"], first_read_at)

    def test_multiple_unread_messages_all_marked_read(self):
        for i in range(3):
            database.send_message(self.room["id"], self.found_owner, f"메시지 {i}")

        updated = database.mark_messages_as_read(self.room["id"], self.lost_owner)
        self.assertEqual(updated, 3)

        messages = database.list_messages(self.room["id"], self.lost_owner)
        self.assertTrue(all(m["read_at"] is not None for m in messages))

    def test_stranger_cannot_mark_messages_as_read(self):
        database.send_message(self.room["id"], self.lost_owner, "hi")
        with self.assertRaises(database.PermissionDeniedError):
            database.mark_messages_as_read(self.room["id"], self.stranger)

    def test_mark_read_on_nonexistent_chat_room_raises_value_error(self):
        with self.assertRaises(ValueError):
            database.mark_messages_as_read(99999, self.lost_owner)

    # ---------- count_unread_messages_by_user ----------

    def test_count_unread_messages_basic(self):
        database.send_message(self.room["id"], self.lost_owner, "A1")
        database.send_message(self.room["id"], self.lost_owner, "A2")
        database.send_message(self.room["id"], self.found_owner, "B1")

        self.assertEqual(database.count_unread_messages_by_user(self.found_owner), 2)
        self.assertEqual(database.count_unread_messages_by_user(self.lost_owner), 1)

    def test_own_unread_messages_not_counted(self):
        database.send_message(self.room["id"], self.lost_owner, "A1")
        # lost_owner sent it, so it must not count as lost_owner's own unread
        self.assertEqual(database.count_unread_messages_by_user(self.lost_owner), 0)

    def test_unread_count_does_not_mix_other_chat_rooms(self):
        other_lost_owner = database.create_user("other_lost@mju.ac.kr", "다른분실자")
        other_lost_id = database.create_lost_post(
            other_lost_owner, "다른 분실물", "설명", "기타", "장소", "2026-08-25 10:00"
        )
        other_match_id = database.create_match(other_lost_id, self.found_id, 0.5, self.found_owner)
        other_room = database.get_or_create_chat_room(other_match_id, self.found_owner)
        database.send_message(other_room["id"], self.found_owner, "다른 채팅방 메시지")

        # this message is in a chat room self.lost_owner has no part in
        self.assertEqual(database.count_unread_messages_by_user(self.lost_owner), 0)
        self.assertEqual(database.count_unread_messages_by_user(other_lost_owner), 1)

    def test_unread_count_decreases_after_marking_read(self):
        database.send_message(self.room["id"], self.found_owner, "hi")
        self.assertEqual(database.count_unread_messages_by_user(self.lost_owner), 1)

        database.mark_messages_as_read(self.room["id"], self.lost_owner)
        self.assertEqual(database.count_unread_messages_by_user(self.lost_owner), 0)

    def test_unread_count_zero_for_user_with_no_chat_rooms(self):
        lone_user = database.create_user("lone@mju.ac.kr", "혼자")
        self.assertEqual(database.count_unread_messages_by_user(lone_user), 0)

    # ---------- list_matches_by_user unread_count ----------

    def test_list_matches_by_user_includes_unread_count(self):
        database.send_message(self.room["id"], self.found_owner, "hi")
        database.send_message(self.room["id"], self.found_owner, "hi again")

        matches = database.list_matches_by_user(self.lost_owner)
        self.assertEqual(matches[0]["unread_count"], 2)

        matches_for_found_owner = database.list_matches_by_user(self.found_owner)
        self.assertEqual(matches_for_found_owner[0]["unread_count"], 0)

    def test_list_matches_by_user_unread_count_zero_without_chat_room(self):
        lost_id2 = database.create_lost_post(
            self.lost_owner, "채팅 없는 분실물", "설명", "기타", "장소", "2026-08-25 09:00"
        )
        found_id2 = database.create_found_post(
            self.found_owner, "채팅 없는 습득물", "설명", "기타", "장소", "2026-08-25 09:30"
        )
        database.create_match(lost_id2, found_id2, 0.4, self.lost_owner)

        matches = database.list_matches_by_user(self.lost_owner)
        no_chat_match = next(m for m in matches if m["lost_post_id"] == lost_id2)
        self.assertEqual(no_chat_match["unread_count"], 0)


class ChatRoomListTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp_dir = tempfile.TemporaryDirectory()
        self._orig_db_path = database.DB_PATH
        database.DB_PATH = Path(self._tmp_dir.name) / "test_chat_room_list.db"
        database.init_db()

        self.lost_owner = database.create_user("lostowner@mju.ac.kr", "분실자")
        self.found_owner = database.create_user("foundowner@mju.ac.kr", "습득자")
        self.stranger = database.create_user("stranger@mju.ac.kr", "제3자")
        self.lost_id = database.create_lost_post(
            self.lost_owner, "검은색 에어팟", "설명", "전자기기", "도서관", "2026-08-25 15:00"
        )
        self.found_id = database.create_found_post(
            self.found_owner, "검은색 무선 이어폰", "설명", "전자기기", "도서관", "2026-08-25 16:00"
        )
        self.match_id = database.create_match(self.lost_id, self.found_id, 0.9, self.lost_owner)
        self.room = database.get_or_create_chat_room(self.match_id, self.lost_owner)

    def tearDown(self):
        database.DB_PATH = self._orig_db_path
        self._tmp_dir.cleanup()

    def test_lost_post_owner_sees_own_chat_room(self):
        rooms = database.list_chat_rooms_by_user(self.lost_owner)
        self.assertEqual(len(rooms), 1)
        self.assertEqual(rooms[0]["chat_room_id"], self.room["id"])
        self.assertEqual(rooms[0]["lost_post_user_id"], self.lost_owner)
        self.assertEqual(rooms[0]["found_post_user_id"], self.found_owner)

    def test_found_post_owner_sees_own_chat_room(self):
        rooms = database.list_chat_rooms_by_user(self.found_owner)
        self.assertEqual(len(rooms), 1)
        self.assertEqual(rooms[0]["chat_room_id"], self.room["id"])

    def test_stranger_sees_no_chat_rooms(self):
        self.assertEqual(database.list_chat_rooms_by_user(self.stranger), [])

    def test_rooms_ordered_by_most_recent_message_first(self):
        lost_id2 = database.create_lost_post(
            self.lost_owner, "분실물2", "설명", "기타", "장소", "2026-08-25 09:00"
        )
        found_id2 = database.create_found_post(
            self.found_owner, "습득물2", "설명", "기타", "장소", "2026-08-25 09:30"
        )
        match_id2 = database.create_match(lost_id2, found_id2, 0.5, self.lost_owner)
        room2 = database.get_or_create_chat_room(match_id2, self.lost_owner)

        database.send_message(self.room["id"], self.lost_owner, "먼저 보낸 메시지")
        database.send_message(room2["id"], self.lost_owner, "나중에 보낸 메시지")

        rooms = database.list_chat_rooms_by_user(self.lost_owner)
        self.assertEqual(rooms[0]["chat_room_id"], room2["id"])
        self.assertEqual(rooms[1]["chat_room_id"], self.room["id"])

    def test_room_with_no_messages_still_listed_after_rooms_with_messages(self):
        lost_id2 = database.create_lost_post(
            self.lost_owner, "분실물2", "설명", "기타", "장소", "2026-08-25 09:00"
        )
        found_id2 = database.create_found_post(
            self.found_owner, "습득물2", "설명", "기타", "장소", "2026-08-25 09:30"
        )
        match_id2 = database.create_match(lost_id2, found_id2, 0.5, self.lost_owner)
        empty_room = database.get_or_create_chat_room(match_id2, self.lost_owner)

        database.send_message(self.room["id"], self.lost_owner, "메시지 있음")

        rooms = database.list_chat_rooms_by_user(self.lost_owner)
        self.assertEqual(len(rooms), 2)
        self.assertEqual(rooms[0]["chat_room_id"], self.room["id"])
        self.assertEqual(rooms[1]["chat_room_id"], empty_room["id"])
        self.assertIsNone(rooms[1]["last_message_content"])

    def test_last_message_content_and_time_are_accurate(self):
        database.send_message(self.room["id"], self.lost_owner, "첫 메시지")
        last = database.send_message(self.room["id"], self.found_owner, "가장 최근 메시지")

        rooms = database.list_chat_rooms_by_user(self.lost_owner)
        self.assertEqual(rooms[0]["last_message_content"], "가장 최근 메시지")
        self.assertEqual(rooms[0]["last_message_created_at"], last["created_at"])

    def test_unread_count_accurate_and_excludes_own_messages(self):
        database.send_message(self.room["id"], self.lost_owner, "내가 보낸 메시지")
        database.send_message(self.room["id"], self.found_owner, "상대가 보낸 메시지1")
        database.send_message(self.room["id"], self.found_owner, "상대가 보낸 메시지2")

        rooms_for_lost_owner = database.list_chat_rooms_by_user(self.lost_owner)
        self.assertEqual(rooms_for_lost_owner[0]["unread_count"], 2)

        rooms_for_found_owner = database.list_chat_rooms_by_user(self.found_owner)
        self.assertEqual(rooms_for_found_owner[0]["unread_count"], 1)  # only lost_owner's message

    def test_match_without_chat_room_not_listed(self):
        lost_id2 = database.create_lost_post(
            self.lost_owner, "채팅 없는 분실물", "설명", "기타", "장소", "2026-08-25 09:00"
        )
        found_id2 = database.create_found_post(
            self.found_owner, "채팅 없는 습득물", "설명", "기타", "장소", "2026-08-25 09:30"
        )
        database.create_match(lost_id2, found_id2, 0.4, self.lost_owner)  # no get_or_create_chat_room call

        rooms = database.list_chat_rooms_by_user(self.lost_owner)
        self.assertEqual(len(rooms), 1)  # only self.room, not the chat-room-less match
        self.assertEqual(rooms[0]["chat_room_id"], self.room["id"])


class ChatRoomListDirectChatIntegrationTestCase(unittest.TestCase):
    """list_chat_rooms_by_user()/count_unread_messages_by_user() must fold
    direct chat rooms (Match 없이 게시글에서 바로 시작한 채팅) into the same
    "내 채팅" list and unread badge as Match-based rooms."""

    def setUp(self):
        self._tmp_dir = tempfile.TemporaryDirectory()
        self._orig_db_path = database.DB_PATH
        database.DB_PATH = Path(self._tmp_dir.name) / "test_chat_room_list_direct.db"
        database.init_db()

        self.author = database.create_user("author@mju.ac.kr", "작성자실명")
        self.viewer = database.create_user("viewer@mju.ac.kr", "열람자실명")
        self.stranger = database.create_user("stranger@mju.ac.kr", "제3자실명")
        database.set_initial_nickname(self.author, "작성자")
        database.set_initial_nickname(self.viewer, "열람자")
        database.set_initial_nickname(self.stranger, "제3자")
        self.lost_id = database.create_lost_post(
            self.author, "검은색 에어팟", "설명", "전자기기", "도서관", "2026-08-25 15:00"
        )

    def tearDown(self):
        database.DB_PATH = self._orig_db_path
        self._tmp_dir.cleanup()

    # A: direct chat room appears in the initiator's list
    def test_direct_chat_room_appears_in_initiators_list(self):
        room = database.get_or_create_direct_chat_room("lost", self.lost_id, self.viewer)

        rooms = database.list_chat_rooms_by_user(self.viewer)
        self.assertEqual(len(rooms), 1)
        self.assertEqual(rooms[0]["chat_room_id"], room["id"])
        self.assertEqual(rooms[0]["room_type"], "direct")
        self.assertEqual(rooms[0]["other_user_id"], self.author)
        self.assertEqual(rooms[0]["other_nickname"], "작성자")
        self.assertEqual(rooms[0]["post_title"], "검은색 에어팟")

    # A (author side): also appears for the post owner, with the initiator as "other"
    def test_direct_chat_room_appears_in_authors_list_too(self):
        database.get_or_create_direct_chat_room("lost", self.lost_id, self.viewer)

        rooms = database.list_chat_rooms_by_user(self.author)
        self.assertEqual(len(rooms), 1)
        self.assertEqual(rooms[0]["room_type"], "direct")
        self.assertEqual(rooms[0]["other_user_id"], self.viewer)
        self.assertEqual(rooms[0]["other_nickname"], "열람자")

    # B: sender's own unread stays 0, recipient's unread increases
    def test_first_message_increases_only_recipients_unread(self):
        room = database.get_or_create_direct_chat_room("lost", self.lost_id, self.viewer)
        database.send_message(room["id"], self.viewer, "안녕하세요, 제 물건 같아요")

        self.assertEqual(database.count_unread_messages_by_user(self.author), 1)
        self.assertEqual(database.count_unread_messages_by_user(self.viewer), 0)

    # C: reply increases the initiator's unread, and the room stays reachable via listing
    def test_reply_increases_initiators_unread_and_room_stays_listed(self):
        room = database.get_or_create_direct_chat_room("lost", self.lost_id, self.viewer)
        database.send_message(room["id"], self.viewer, "안녕하세요")
        database.mark_messages_as_read(room["id"], self.author)
        database.send_message(room["id"], self.author, "네 맞아요!")

        self.assertEqual(database.count_unread_messages_by_user(self.viewer), 1)

        rooms = database.list_chat_rooms_by_user(self.viewer)
        self.assertEqual(len(rooms), 1)
        self.assertEqual(rooms[0]["chat_room_id"], room["id"])
        self.assertEqual(rooms[0]["last_message_content"], "네 맞아요!")

    # D: a fresh call to list_chat_rooms_by_user() (no session/cache involved)
    # still finds the room -- the DB layer has no session-scoped state at all.
    def test_room_discoverable_via_fresh_list_call_without_any_session_state(self):
        room = database.get_or_create_direct_chat_room("lost", self.lost_id, self.viewer)
        database.send_message(room["id"], self.viewer, "안녕하세요")

        # simulate "a new browser session" by calling the DB layer fresh,
        # exactly as a brand new AppTest/page load would -- nothing here
        # depends on any prior in-process state.
        rooms = database.list_chat_rooms_by_user(self.viewer)
        self.assertEqual(len(rooms), 1)
        self.assertEqual(rooms[0]["chat_room_id"], room["id"])

    # E: existing Match-based rooms are unaffected
    def test_match_based_room_listing_unaffected(self):
        found_id = database.create_found_post(
            self.stranger, "검은색 무선 이어폰", "설명", "전자기기", "도서관", "2026-08-25 16:00"
        )
        match_id = database.create_match(self.lost_id, found_id, 0.9, self.author)
        match_room = database.get_or_create_chat_room(match_id, self.author)

        rooms = database.list_chat_rooms_by_user(self.author)
        self.assertEqual(len(rooms), 1)
        self.assertEqual(rooms[0]["room_type"], "match")
        self.assertEqual(rooms[0]["chat_room_id"], match_room["id"])
        self.assertEqual(rooms[0]["lost_post_id"], self.lost_id)
        self.assertEqual(rooms[0]["found_post_id"], found_id)

    # F: direct and Match rooms coexist and both show up, ordered correctly
    def test_direct_and_match_rooms_both_listed_together(self):
        found_id = database.create_found_post(
            self.stranger, "검은색 무선 이어폰", "설명", "전자기기", "도서관", "2026-08-25 16:00"
        )
        match_id = database.create_match(self.lost_id, found_id, 0.9, self.author)
        match_room = database.get_or_create_chat_room(match_id, self.author)
        direct_room = database.get_or_create_direct_chat_room("lost", self.lost_id, self.viewer)

        database.send_message(match_room["id"], self.author, "매칭 채팅 메시지")
        database.send_message(direct_room["id"], self.viewer, "다이렉트 채팅 메시지")

        rooms = database.list_chat_rooms_by_user(self.author)
        self.assertEqual({r["chat_room_id"] for r in rooms}, {match_room["id"], direct_room["id"]})
        room_types = {r["chat_room_id"]: r["room_type"] for r in rooms}
        self.assertEqual(room_types[match_room["id"]], "match")
        self.assertEqual(room_types[direct_room["id"]], "direct")
        # most-recently-messaged room (direct, sent second) sorts first
        self.assertEqual(rooms[0]["chat_room_id"], direct_room["id"])

    # G: a stranger with no participation in the direct room cannot list or open it
    def test_stranger_cannot_see_or_open_direct_chat_room(self):
        room = database.get_or_create_direct_chat_room("lost", self.lost_id, self.viewer)

        self.assertEqual(database.list_chat_rooms_by_user(self.stranger), [])
        with self.assertRaises(database.PermissionDeniedError):
            database.get_chat_room(room["id"], self.stranger)

    # H: a direct room with no messages contributes zero unread
    def test_direct_room_with_no_messages_has_zero_unread(self):
        database.get_or_create_direct_chat_room("lost", self.lost_id, self.viewer)

        self.assertEqual(database.count_unread_messages_by_user(self.author), 0)
        self.assertEqual(database.count_unread_messages_by_user(self.viewer), 0)

    # I: unread count is accurate across a mix of direct and Match rooms
    def test_unread_count_accurate_across_mixed_direct_and_match_rooms(self):
        found_id = database.create_found_post(
            self.stranger, "검은색 무선 이어폰", "설명", "전자기기", "도서관", "2026-08-25 16:00"
        )
        match_id = database.create_match(self.lost_id, found_id, 0.9, self.author)
        match_room = database.get_or_create_chat_room(match_id, self.author)
        direct_room = database.get_or_create_direct_chat_room("lost", self.lost_id, self.viewer)

        database.send_message(match_room["id"], self.stranger, "매칭방 메시지1")
        database.send_message(match_room["id"], self.stranger, "매칭방 메시지2")
        database.send_message(direct_room["id"], self.viewer, "다이렉트방 메시지")

        # author participates in both rooms and didn't send any of these
        self.assertEqual(database.count_unread_messages_by_user(self.author), 3)
        # viewer only participates in the direct room, and sent that message themselves
        self.assertEqual(database.count_unread_messages_by_user(self.viewer), 0)
        # stranger only participates in the match room (as found post owner), and sent those
        self.assertEqual(database.count_unread_messages_by_user(self.stranger), 0)

    # J: self-chat is still blocked (regression guard for the existing rule)
    def test_author_still_cannot_direct_chat_with_own_post(self):
        with self.assertRaises(database.PermissionDeniedError):
            database.get_or_create_direct_chat_room("lost", self.lost_id, self.author)


class MessageReadAtMigrationTestCase(unittest.TestCase):
    """A DB built against the pre-read_at Message schema, with real message
    data in it, must be migrated in place (no data loss) the first time
    init_db() runs against it."""

    _LEGACY_SCHEMA = """
        PRAGMA foreign_keys = ON;
        CREATE TABLE User (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE LostPost (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES User(id),
            title TEXT NOT NULL, description TEXT NOT NULL, category TEXT NOT NULL,
            location TEXT NOT NULL, lost_at TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT '찾는 중' CHECK (status IN ('찾는 중', '찾음')),
            image_url TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE FoundPost (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES User(id),
            title TEXT NOT NULL, description TEXT NOT NULL, category TEXT NOT NULL,
            location TEXT NOT NULL, found_at TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT '보관 중' CHECK (status IN ('보관 중', '완료')),
            image_url TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE Match (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            lost_post_id INTEGER NOT NULL REFERENCES LostPost(id) ON DELETE CASCADE,
            found_post_id INTEGER NOT NULL REFERENCES FoundPost(id) ON DELETE CASCADE,
            score REAL NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE (lost_post_id, found_post_id)
        );
        CREATE TABLE ChatRoom (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            match_id INTEGER NOT NULL UNIQUE REFERENCES Match(id) ON DELETE CASCADE,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE Message (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_room_id INTEGER NOT NULL REFERENCES ChatRoom(id) ON DELETE CASCADE,
            sender_user_id INTEGER NOT NULL REFERENCES User(id),
            content TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
    """

    def setUp(self):
        self._tmp_dir = tempfile.TemporaryDirectory()
        self._orig_db_path = database.DB_PATH
        database.DB_PATH = Path(self._tmp_dir.name) / "legacy_read_at.db"

        conn = sqlite3.connect(database.DB_PATH)
        conn.executescript(self._LEGACY_SCHEMA)
        conn.execute("INSERT INTO User (email, name) VALUES ('legacy@mju.ac.kr', '기존사용자')")
        conn.execute("INSERT INTO User (email, name) VALUES ('legacy2@mju.ac.kr', '기존사용자2')")
        conn.execute(
            "INSERT INTO LostPost (user_id, title, description, category, location, lost_at) "
            "VALUES (1, '기존 분실물', '설명', '기타', '장소', '2026-08-20 10:00')"
        )
        conn.execute(
            "INSERT INTO FoundPost (user_id, title, description, category, location, found_at) "
            "VALUES (2, '기존 습득물', '설명', '기타', '장소', '2026-08-20 11:00')"
        )
        conn.execute("INSERT INTO Match (lost_post_id, found_post_id, score) VALUES (1, 1, 0.77)")
        conn.execute("INSERT INTO ChatRoom (match_id) VALUES (1)")
        conn.execute(
            "INSERT INTO Message (chat_room_id, sender_user_id, content) VALUES (1, 1, '기존 메시지')"
        )
        conn.commit()
        conn.close()

    def tearDown(self):
        database.DB_PATH = self._orig_db_path
        self._tmp_dir.cleanup()

    def test_migration_preserves_existing_message_and_adds_null_read_at(self):
        database.init_db()

        with database.get_connection() as conn:
            msg = conn.execute("SELECT * FROM Message WHERE id = 1").fetchone()
        self.assertIsNotNone(msg)
        self.assertEqual(msg["content"], "기존 메시지")
        self.assertIsNone(msg["read_at"])

    def test_migration_is_idempotent(self):
        database.init_db()
        database.init_db()  # second run must be a no-op, not an error

        with database.get_connection() as conn:
            columns = [row[1] for row in conn.execute("PRAGMA table_info(Message)").fetchall()]
        self.assertEqual(columns.count("read_at"), 1)  # not duplicated

        msg = database.get_or_create_chat_room(1, 1)
        self.assertIsNotNone(msg)

    def test_migrated_message_can_be_marked_read_normally(self):
        database.init_db()
        # user 2 (FoundPost owner) reads user 1's legacy message
        updated = database.mark_messages_as_read(1, 2)
        self.assertEqual(updated, 1)


class UserNicknameMigrationTestCase(unittest.TestCase):
    """Same pre-nickname legacy schema as MessageReadAtMigrationTestCase
    (User has no nickname column yet) -- must migrate in place, preserving
    every existing row, with existing users ending up nickname = NULL."""

    _LEGACY_SCHEMA = MessageReadAtMigrationTestCase._LEGACY_SCHEMA

    def setUp(self):
        self._tmp_dir = tempfile.TemporaryDirectory()
        self._orig_db_path = database.DB_PATH
        database.DB_PATH = Path(self._tmp_dir.name) / "legacy_nickname.db"

        conn = sqlite3.connect(database.DB_PATH)
        conn.executescript(self._LEGACY_SCHEMA)
        conn.execute("INSERT INTO User (email, name) VALUES ('legacy@mju.ac.kr', '기존사용자')")
        conn.execute("INSERT INTO User (email, name) VALUES ('legacy2@mju.ac.kr', '기존사용자2')")
        conn.execute(
            "INSERT INTO LostPost (user_id, title, description, category, location, lost_at) "
            "VALUES (1, '기존 분실물', '설명', '기타', '장소', '2026-08-20 10:00')"
        )
        conn.execute(
            "INSERT INTO FoundPost (user_id, title, description, category, location, found_at) "
            "VALUES (2, '기존 습득물', '설명', '기타', '장소', '2026-08-20 11:00')"
        )
        conn.execute("INSERT INTO Match (lost_post_id, found_post_id, score) VALUES (1, 1, 0.77)")
        conn.execute("INSERT INTO ChatRoom (match_id) VALUES (1)")
        conn.execute(
            "INSERT INTO Message (chat_room_id, sender_user_id, content) VALUES (1, 1, '기존 메시지')"
        )
        conn.commit()
        conn.close()

    def tearDown(self):
        database.DB_PATH = self._orig_db_path
        self._tmp_dir.cleanup()

    def test_migration_adds_nickname_column_as_null_for_existing_users(self):
        database.init_db()

        user1 = database.get_user_by_id(1)
        user2 = database.get_user_by_id(2)
        self.assertIsNotNone(user1)
        self.assertIsNotNone(user2)
        self.assertIsNone(user1["nickname"])
        self.assertIsNone(user2["nickname"])
        # real name/email untouched by the migration
        self.assertEqual(user1["email"], "legacy@mju.ac.kr")
        self.assertEqual(user1["name"], "기존사용자")

    def test_migration_preserves_all_existing_data(self):
        database.init_db()

        self.assertIsNotNone(database.get_lost_post(1))
        self.assertIsNotNone(database.get_found_post(1))
        self.assertIsNotNone(database.get_match(1))
        with database.get_connection() as conn:
            chat_room = conn.execute("SELECT * FROM ChatRoom WHERE id = 1").fetchone()
            message = conn.execute("SELECT * FROM Message WHERE id = 1").fetchone()
        self.assertIsNotNone(chat_room)
        self.assertIsNotNone(message)
        self.assertEqual(message["content"], "기존 메시지")

    def test_migration_is_idempotent(self):
        database.init_db()
        database.init_db()  # second run must be a no-op, not an error

        with database.get_connection() as conn:
            columns = [row[1] for row in conn.execute("PRAGMA table_info(User)").fetchall()]
        self.assertEqual(columns.count("nickname"), 1)  # not duplicated

        self.assertIsNone(database.get_user_by_id(1)["nickname"])

    def test_existing_user_can_set_nickname_after_migration(self):
        database.init_db()
        database.set_initial_nickname(1, "기존사용자닉")
        self.assertEqual(database.get_user_by_id(1)["nickname"], "기존사용자닉")


class NicknameTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp_dir = tempfile.TemporaryDirectory()
        self._orig_db_path = database.DB_PATH
        database.DB_PATH = Path(self._tmp_dir.name) / "test_nickname.db"
        database.init_db()

        self.uid = database.create_user("student@mju.ac.kr", "실명학생")

    def tearDown(self):
        database.DB_PATH = self._orig_db_path
        self._tmp_dir.cleanup()

    def test_new_user_has_null_nickname(self):
        self.assertIsNone(database.get_user_by_id(self.uid)["nickname"])

    def test_set_initial_nickname_success(self):
        database.set_initial_nickname(self.uid, "고정닉네임1")
        self.assertEqual(database.get_user_by_id(self.uid)["nickname"], "고정닉네임1")

    def test_nickname_is_trimmed_of_surrounding_whitespace(self):
        database.set_initial_nickname(self.uid, "  공백닉네임  ")
        self.assertEqual(database.get_user_by_id(self.uid)["nickname"], "공백닉네임")

    def test_korean_english_number_mixed_nickname_allowed(self):
        database.set_initial_nickname(self.uid, "닉네임abc123")
        self.assertEqual(database.get_user_by_id(self.uid)["nickname"], "닉네임abc123")

    def test_empty_nickname_rejected(self):
        with self.assertRaises(ValueError):
            database.set_initial_nickname(self.uid, "")

    def test_whitespace_only_nickname_rejected(self):
        with self.assertRaises(ValueError):
            database.set_initial_nickname(self.uid, "   ")
        self.assertIsNone(database.get_user_by_id(self.uid)["nickname"])

    def test_too_short_nickname_rejected(self):
        with self.assertRaises(ValueError):
            database.set_initial_nickname(self.uid, "a")

    def test_too_long_nickname_rejected(self):
        too_long = "가" * (database.NICKNAME_MAX_LENGTH + 1)
        with self.assertRaises(ValueError):
            database.set_initial_nickname(self.uid, too_long)

    def test_max_length_nickname_accepted(self):
        exactly_max = "가" * database.NICKNAME_MAX_LENGTH
        database.set_initial_nickname(self.uid, exactly_max)
        self.assertEqual(database.get_user_by_id(self.uid)["nickname"], exactly_max)

    def test_html_script_injection_characters_rejected(self):
        for bad in ["<script>alert(1)</script>", "닉네임<b>", "test'; DROP TABLE User;--", "a&b"]:
            with self.assertRaises(ValueError):
                database.set_initial_nickname(self.uid, bad)

    def test_space_inside_nickname_rejected(self):
        with self.assertRaises(ValueError):
            database.set_initial_nickname(self.uid, "공백 포함 닉네임")

    def test_duplicate_nickname_rejected(self):
        other_uid = database.create_user("other@mju.ac.kr", "실명학생2")
        database.set_initial_nickname(self.uid, "중복테스트닉")
        with self.assertRaises(ValueError):
            database.set_initial_nickname(other_uid, "중복테스트닉")
        self.assertIsNone(database.get_user_by_id(other_uid)["nickname"])

    def test_duplicate_nickname_rejected_even_via_raw_connection(self):
        """Final backstop: the UNIQUE index itself, independent of the
        set_initial_nickname() pre-check."""
        database.set_initial_nickname(self.uid, "레이스테스트닉")
        with self.assertRaises(sqlite3.IntegrityError):
            with database.get_connection() as conn:
                conn.execute(
                    "UPDATE User SET nickname = ? WHERE id = ?",
                    ("레이스테스트닉", database.create_user("race@mju.ac.kr", "레이스")),
                )

    def test_already_set_nickname_cannot_be_set_again(self):
        database.set_initial_nickname(self.uid, "최초닉네임")
        with self.assertRaises(ValueError):
            database.set_initial_nickname(self.uid, "변경시도닉네임")
        # original nickname is untouched
        self.assertEqual(database.get_user_by_id(self.uid)["nickname"], "최초닉네임")

    def test_nickname_cannot_be_changed_by_a_different_caller_either(self):
        """No caller -- including one acting on behalf of a different user
        -- can overwrite an already-set nickname. set_initial_nickname()
        takes no requesting_user_id because the invariant it enforces
        ("immutable once set") doesn't depend on who's asking."""
        database.set_initial_nickname(self.uid, "원래닉네임")
        with self.assertRaises(ValueError):
            database.set_initial_nickname(self.uid, "누군가바꾸려함")
        self.assertEqual(database.get_user_by_id(self.uid)["nickname"], "원래닉네임")

    def test_set_nickname_for_nonexistent_user_raises_value_error(self):
        with self.assertRaises(ValueError):
            database.set_initial_nickname(99999, "유령닉네임")

    def test_no_update_nickname_function_exists(self):
        """Structural guarantee: there's no rename/update API to misuse."""
        self.assertFalse(hasattr(database, "update_nickname"))
        self.assertFalse(hasattr(database, "change_nickname"))
        self.assertFalse(hasattr(database, "update_user_nickname"))


class ReportTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp_dir = tempfile.TemporaryDirectory()
        self._orig_db_path = database.DB_PATH
        database.DB_PATH = Path(self._tmp_dir.name) / "test_report.db"
        database.init_db()

        self.reporter = database.create_user("reporter@mju.ac.kr", "신고자실명")
        self.target_user = database.create_user("target@mju.ac.kr", "대상실명")
        database.set_initial_nickname(self.reporter, "신고자닉")
        database.set_initial_nickname(self.target_user, "대상닉")

        self.lost_id = database.create_lost_post(
            self.target_user, "검은색 에어팟", "설명", "전자기기", "도서관", "2026-08-25 15:00"
        )
        self.found_id = database.create_found_post(
            self.target_user, "검은색 무선 이어폰", "설명", "전자기기", "도서관", "2026-08-25 16:00"
        )
        self.match_id = database.create_match(self.lost_id, self.found_id, 0.9, self.target_user)
        self.room = database.get_or_create_chat_room(self.match_id, self.target_user)
        self.message = database.send_message(self.room["id"], self.target_user, "안녕하세요")

    def tearDown(self):
        database.DB_PATH = self._orig_db_path
        self._tmp_dir.cleanup()

    # ---------- normal reports ----------

    def test_report_post_success(self):
        report_id = database.create_report(
            self.reporter, "post", self.lost_id, "사기/허위 정보", "가짜 게시물 같아요"
        )
        report = database.get_report(report_id)
        self.assertEqual(report["reporter_user_id"], self.reporter)
        self.assertEqual(report["target_type"], "post")
        self.assertEqual(report["target_id"], self.lost_id)
        self.assertEqual(report["reason"], "사기/허위 정보")
        self.assertEqual(report["detail"], "가짜 게시물 같아요")

    def test_report_found_post_success(self):
        # FoundPost ids are negated for target_type="post" (see
        # db.create_report()) since LostPost/FoundPost autoincrement
        # independently and their ids commonly collide.
        report_id = database.create_report(self.reporter, "post", -self.found_id, "기타")
        report = database.get_report(report_id)
        self.assertIsNotNone(report)
        self.assertEqual(report["target_id"], -self.found_id)

    def test_report_message_success(self):
        report_id = database.create_report(self.reporter, "message", self.message["id"], "욕설/비방")
        report = database.get_report(report_id)
        self.assertEqual(report["target_type"], "message")
        self.assertEqual(report["target_id"], self.message["id"])

    def test_report_user_success(self):
        report_id = database.create_report(self.reporter, "user", self.target_user, "개인정보 노출")
        self.assertIsNotNone(database.get_report(report_id))

    def test_report_detail_is_optional(self):
        report_id = database.create_report(self.reporter, "post", self.lost_id, "도배/스팸")
        self.assertIsNone(database.get_report(report_id)["detail"])

    # ---------- nonexistent targets ----------

    def test_report_nonexistent_post_rejected(self):
        with self.assertRaises(ValueError):
            database.create_report(self.reporter, "post", 99999, "기타")

    def test_report_nonexistent_message_rejected(self):
        with self.assertRaises(ValueError):
            database.create_report(self.reporter, "message", 99999, "기타")

    def test_report_nonexistent_user_rejected(self):
        with self.assertRaises(ValueError):
            database.create_report(self.reporter, "user", 99999, "기타")

    def test_report_by_nonexistent_reporter_rejected(self):
        with self.assertRaises(ValueError):
            database.create_report(99999, "post", self.lost_id, "기타")

    # ---------- self-report rejection ----------

    def test_self_user_report_rejected(self):
        with self.assertRaises(ValueError):
            database.create_report(self.reporter, "user", self.reporter, "기타")

    def test_own_post_report_rejected(self):
        with self.assertRaises(ValueError):
            database.create_report(self.target_user, "post", self.lost_id, "기타")
        with self.assertRaises(ValueError):
            database.create_report(self.target_user, "post", -self.found_id, "기타")

    def test_own_message_report_rejected(self):
        with self.assertRaises(ValueError):
            database.create_report(self.target_user, "message", self.message["id"], "기타")

    # ---------- input validation ----------

    def test_invalid_target_type_rejected(self):
        with self.assertRaises(ValueError):
            database.create_report(self.reporter, "lostpost", self.lost_id, "기타")

    def test_blank_reason_rejected(self):
        with self.assertRaises(ValueError):
            database.create_report(self.reporter, "post", self.lost_id, "")
        with self.assertRaises(ValueError):
            database.create_report(self.reporter, "post", self.lost_id, "   ")

    # ---------- duplicate prevention ----------

    def test_duplicate_report_rejected(self):
        database.create_report(self.reporter, "post", self.lost_id, "기타")
        with self.assertRaises(ValueError):
            database.create_report(self.reporter, "post", self.lost_id, "다른 사유")

    def test_duplicate_report_rejected_even_via_raw_connection(self):
        """Final backstop: the UNIQUE index itself, independent of the
        create_report() pre-check."""
        database.create_report(self.reporter, "post", self.lost_id, "기타")
        with self.assertRaises(sqlite3.IntegrityError):
            with database.get_connection() as conn:
                conn.execute(
                    "INSERT INTO Report (reporter_user_id, target_type, target_id, reason) "
                    "VALUES (?, 'post', ?, '우회시도')",
                    (self.reporter, self.lost_id),
                )

    def test_different_reporters_can_each_report_the_same_target(self):
        other_reporter = database.create_user("other_reporter@mju.ac.kr", "다른신고자")
        database.set_initial_nickname(other_reporter, "다른신고자닉")

        database.create_report(self.reporter, "post", self.lost_id, "기타")
        database.create_report(other_reporter, "post", self.lost_id, "기타")  # must not raise

    # ---------- bypass attempts (direct DB calls, not via UI) ----------

    def test_arbitrary_reporter_and_target_ids_cannot_bypass_self_report_check(self):
        """Simulates a UI-bypassing caller trying arbitrary ids -- the
        validation is in create_report() itself, not the UI layer."""
        with self.assertRaises(ValueError):
            database.create_report(self.target_user, "post", self.lost_id, "우회시도")
        with self.assertRaises(ValueError):
            database.create_report(self.target_user, "message", self.message["id"], "우회시도")
        with self.assertRaises(ValueError):
            database.create_report(self.target_user, "user", self.target_user, "우회시도")

    # ---------- list_reports_by_reporter isolation ----------

    def test_list_reports_by_reporter_does_not_mix_other_users_reports(self):
        other_reporter = database.create_user("other_reporter2@mju.ac.kr", "다른신고자2")
        database.set_initial_nickname(other_reporter, "다른신고자2닉")

        database.create_report(self.reporter, "post", self.lost_id, "기타")
        database.create_report(other_reporter, "post", -self.found_id, "기타")

        reporter_reports = database.list_reports_by_reporter(self.reporter)
        other_reports = database.list_reports_by_reporter(other_reporter)

        self.assertEqual(len(reporter_reports), 1)
        self.assertEqual(reporter_reports[0]["target_id"], self.lost_id)
        self.assertEqual(len(other_reports), 1)
        self.assertEqual(other_reports[0]["target_id"], -self.found_id)

    def test_list_reports_by_reporter_empty_for_user_with_no_reports(self):
        self.assertEqual(database.list_reports_by_reporter(self.reporter), [])

    # ---------- CASCADE / lifecycle independence ----------

    def test_report_survives_target_post_deletion(self):
        """Reports are polymorphic (no FK on target_id) specifically so they
        outlive the target's own lifecycle -- deleting the reported post
        must not delete or corrupt the Report row."""
        report_id = database.create_report(self.reporter, "post", self.lost_id, "기타")
        database.delete_lost_post(self.lost_id, self.target_user)
        self.assertIsNotNone(database.get_report(report_id))

    def test_existing_match_chat_cascade_unaffected_by_reports(self):
        """Regression: adding Report must not change Match/ChatRoom/Message
        CASCADE behavior."""
        report_id = database.create_report(self.reporter, "message", self.message["id"], "기타")
        database.delete_match(self.match_id, self.target_user)
        with database.get_connection() as conn:
            self.assertIsNone(
                conn.execute(
                    "SELECT * FROM ChatRoom WHERE id = ?", (self.room["id"],)
                ).fetchone()
            )
        # the report itself still exists even though the message is gone
        self.assertIsNotNone(database.get_report(report_id))


class AdminReportTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp_dir = tempfile.TemporaryDirectory()
        self._orig_db_path = database.DB_PATH
        database.DB_PATH = Path(self._tmp_dir.name) / "test_admin_report.db"
        database.init_db()

        self.reporter = database.create_user("reporter@mju.ac.kr", "신고자실명")
        self.target_user = database.create_user("target@mju.ac.kr", "대상실명")
        self.admin = database.create_user("admin@mju.ac.kr", "관리자실명")
        database.set_initial_nickname(self.reporter, "신고자닉")
        database.set_initial_nickname(self.target_user, "대상닉")
        database.set_initial_nickname(self.admin, "관리자닉")
        # is_admin has no self-service promotion API by design -- granting
        # admin status is a manual DB update, exactly as documented in
        # _migrate_user_table_add_is_admin().
        with database.get_connection() as conn:
            conn.execute("UPDATE User SET is_admin = 1 WHERE id = ?", (self.admin,))

        self.lost_id = database.create_lost_post(
            self.target_user, "검은색 에어팟", "설명", "전자기기", "도서관", "2026-08-25 15:00"
        )
        self.found_id = database.create_found_post(
            self.target_user, "검은색 무선 이어폰", "설명", "전자기기", "도서관", "2026-08-25 16:00"
        )
        self.match_id = database.create_match(self.lost_id, self.found_id, 0.9, self.target_user)
        self.room = database.get_or_create_chat_room(self.match_id, self.target_user)
        self.message = database.send_message(self.room["id"], self.target_user, "안녕하세요")

        self.post_report_id = database.create_report(
            self.reporter, "post", self.lost_id, "사기/허위 정보", "가짜 같아요"
        )

    def tearDown(self):
        database.DB_PATH = self._orig_db_path
        self._tmp_dir.cleanup()

    # ---------- is_admin ----------

    def test_is_admin_true_for_flagged_user(self):
        self.assertTrue(database.is_admin(self.admin))

    def test_is_admin_false_for_normal_user(self):
        self.assertFalse(database.is_admin(self.reporter))

    def test_is_admin_false_for_nonexistent_user(self):
        self.assertFalse(database.is_admin(99999))

    def test_admin_check_constraint_enforced_on_fresh_db(self):
        """Final backstop on a freshly-created User table (schema.sql's
        CHECK): independent of any app-layer validation."""
        with self.assertRaises(sqlite3.IntegrityError):
            with database.get_connection() as conn:
                conn.execute("UPDATE User SET is_admin = 2 WHERE id = ?", (self.reporter,))

    # ---------- permission: non-admin blocked ----------

    def test_list_reports_for_admin_rejects_non_admin(self):
        with self.assertRaises(database.PermissionDeniedError):
            database.list_reports_for_admin(self.reporter)

    def test_list_reports_for_admin_rejects_nonexistent_user(self):
        with self.assertRaises(database.PermissionDeniedError):
            database.list_reports_for_admin(99999)

    def test_process_report_rejects_non_admin(self):
        with self.assertRaises(database.PermissionDeniedError):
            database.process_report(self.post_report_id, self.reporter, "dismissed")

    def test_process_report_rejects_reporter_processing_own_report(self):
        """A non-admin cannot process a report -- even one they themselves
        filed. Filing a report grants no special processing rights."""
        with self.assertRaises(database.PermissionDeniedError):
            database.process_report(self.post_report_id, self.reporter, "actioned")

    def test_process_report_rejects_target_user_too(self):
        """The reported user is not an admin either -- proves this isn't a
        participant-based check like the chat/match permission functions,
        it's strictly is_admin."""
        with self.assertRaises(database.PermissionDeniedError):
            database.process_report(self.post_report_id, self.target_user, "dismissed")

    def test_bypass_attempt_with_arbitrary_ids_cannot_gain_admin(self):
        """Simulates a UI-bypassing caller calling the DB functions directly
        with made-up ids -- there is no argument or session_state value that
        grants admin access; only User.is_admin in the DB does."""
        for fake_admin_id in (self.reporter, self.target_user, 99999, -1, 0):
            with self.assertRaises(database.PermissionDeniedError):
                database.list_reports_for_admin(fake_admin_id)
            with self.assertRaises(database.PermissionDeniedError):
                database.process_report(self.post_report_id, fake_admin_id, "dismissed")

    # ---------- admin can list/process ----------

    def test_admin_can_list_reports(self):
        reports = database.list_reports_for_admin(self.admin)
        self.assertEqual(len(reports), 1)
        self.assertEqual(reports[0]["id"], self.post_report_id)
        self.assertEqual(reports[0]["reporter_nickname"], "신고자닉")

    def test_admin_can_process_report_not_filed_against_their_own_data(self):
        """The report's reporter/target have no relation to the admin --
        processing must not be blocked by that (admin is not a participant)."""
        database.process_report(self.post_report_id, self.admin, "dismissed", "확인 결과 문제 없음")
        report = database.get_report(self.post_report_id)
        self.assertEqual(report["status"], "dismissed")
        self.assertEqual(report["admin_note"], "확인 결과 문제 없음")

    def test_processed_by_user_id_is_the_real_requesting_admin(self):
        other_admin = database.create_user("admin2@mju.ac.kr", "관리자2실명")
        database.set_initial_nickname(other_admin, "관리자2닉")
        with database.get_connection() as conn:
            conn.execute("UPDATE User SET is_admin = 1 WHERE id = ?", (other_admin,))

        database.process_report(self.post_report_id, other_admin, "actioned")
        report = database.get_report(self.post_report_id)
        self.assertEqual(report["processed_by_user_id"], other_admin)
        self.assertNotEqual(report["processed_by_user_id"], self.reporter)

    def test_admin_note_is_trimmed_and_blank_becomes_null(self):
        database.process_report(self.post_report_id, self.admin, "dismissed", "   ")
        self.assertIsNone(database.get_report(self.post_report_id)["admin_note"])

        report_id_2 = database.create_report(self.reporter, "message", self.message["id"], "기타")
        database.process_report(report_id_2, self.admin, "actioned", "  공백 포함 메모  ")
        self.assertEqual(database.get_report(report_id_2)["admin_note"], "공백 포함 메모")

    # ---------- validation ----------

    def test_process_nonexistent_report_raises_value_error(self):
        with self.assertRaises(ValueError):
            database.process_report(99999, self.admin, "dismissed")

    def test_process_report_invalid_status_rejected(self):
        with self.assertRaises(ValueError):
            database.process_report(self.post_report_id, self.admin, "resolved")

    def test_process_report_cannot_set_status_back_to_pending(self):
        with self.assertRaises(ValueError):
            database.process_report(self.post_report_id, self.admin, "pending")

    def test_invalid_status_rejected_even_via_raw_connection(self):
        """Final backstop: the CHECK constraint itself, independent of the
        process_report() pre-check."""
        with self.assertRaises(sqlite3.IntegrityError):
            with database.get_connection() as conn:
                conn.execute(
                    "UPDATE Report SET status = 'resolved' WHERE id = ?",
                    (self.post_report_id,),
                )

    # ---------- re-processing policy ----------

    def test_already_processed_report_cannot_be_reprocessed(self):
        database.process_report(self.post_report_id, self.admin, "dismissed", "1차 처리")
        with self.assertRaises(ValueError):
            database.process_report(self.post_report_id, self.admin, "actioned", "2차 처리 시도")
        # the original decision is untouched
        report = database.get_report(self.post_report_id)
        self.assertEqual(report["status"], "dismissed")
        self.assertEqual(report["admin_note"], "1차 처리")

    def test_reprocess_rejected_even_by_a_different_admin(self):
        other_admin = database.create_user("admin3@mju.ac.kr", "관리자3실명")
        database.set_initial_nickname(other_admin, "관리자3닉")
        with database.get_connection() as conn:
            conn.execute("UPDATE User SET is_admin = 1 WHERE id = ?", (other_admin,))

        database.process_report(self.post_report_id, self.admin, "actioned")
        with self.assertRaises(ValueError):
            database.process_report(self.post_report_id, other_admin, "dismissed")
        self.assertEqual(database.get_report(self.post_report_id)["processed_by_user_id"], self.admin)

    # ---------- deleted targets still listable ----------

    def test_deleted_post_target_still_listed_and_flagged(self):
        database.delete_lost_post(self.lost_id, self.target_user)
        reports = database.list_reports_for_admin(self.admin)
        self.assertEqual(len(reports), 1)
        self.assertTrue(reports[0]["target_deleted"])
        self.assertIsNone(reports[0]["target_info"])

    def test_deleted_message_target_still_listed_and_flagged(self):
        msg_report_id = database.create_report(self.reporter, "message", self.message["id"], "기타")
        database.delete_match(self.match_id, self.target_user)  # cascades ChatRoom -> Message
        reports = database.list_reports_for_admin(self.admin, target_type="message")
        self.assertEqual(len(reports), 1)
        self.assertEqual(reports[0]["id"], msg_report_id)
        self.assertTrue(reports[0]["target_deleted"])

    def test_non_deleted_post_target_info_populated(self):
        reports = database.list_reports_for_admin(self.admin)
        self.assertFalse(reports[0]["target_deleted"])
        info = reports[0]["target_info"]
        self.assertEqual(info["post_kind"], "lost")
        self.assertEqual(info["title"], "검은색 에어팟")
        self.assertEqual(info["author_nickname"], "대상닉")

    # ---------- filters / ordering ----------

    def test_status_filter_narrows_list(self):
        database.process_report(self.post_report_id, self.admin, "dismissed")
        pending = database.list_reports_for_admin(self.admin, status="pending")
        dismissed = database.list_reports_for_admin(self.admin, status="dismissed")
        self.assertEqual(pending, [])
        self.assertEqual(len(dismissed), 1)

    def test_target_type_filter_narrows_list(self):
        database.create_report(self.reporter, "user", self.target_user, "기타")
        posts_only = database.list_reports_for_admin(self.admin, target_type="post")
        users_only = database.list_reports_for_admin(self.admin, target_type="user")
        self.assertEqual(len(posts_only), 1)
        self.assertEqual(len(users_only), 1)
        self.assertEqual(posts_only[0]["target_type"], "post")
        self.assertEqual(users_only[0]["target_type"], "user")

    def test_pending_reports_sort_before_processed_ones(self):
        second_report_id = database.create_report(self.reporter, "user", self.target_user, "기타")
        database.process_report(second_report_id, self.admin, "dismissed")
        # self.post_report_id stays pending
        reports = database.list_reports_for_admin(self.admin)
        self.assertEqual(reports[0]["id"], self.post_report_id)
        self.assertEqual(reports[0]["status"], "pending")

    def test_invalid_status_filter_rejected(self):
        with self.assertRaises(ValueError):
            database.list_reports_for_admin(self.admin, status="resolved")

    def test_invalid_target_type_filter_rejected(self):
        with self.assertRaises(ValueError):
            database.list_reports_for_admin(self.admin, target_type="comment")

    # ---------- pagination ----------

    def test_limit_and_offset_paginate_results(self):
        for i in range(3):
            other = database.create_user(f"reporter{i}@mju.ac.kr", f"신고자{i}")
            database.set_initial_nickname(other, f"신고자{i}닉")
            database.create_report(other, "user", self.target_user, "기타")

        page1 = database.list_reports_for_admin(self.admin, limit=2, offset=0)
        page2 = database.list_reports_for_admin(self.admin, limit=2, offset=2)
        self.assertEqual(len(page1), 2)
        self.assertEqual(len(page2), 2)  # 4 total reports now
        self.assertNotEqual({r["id"] for r in page1}, {r["id"] for r in page2})


class AdminMigrationTestCase(unittest.TestCase):
    """A DB built against the pre-admin-system schema (no User.is_admin, no
    Report.status/processed_at/processed_by_user_id/admin_note), with real
    report data in it, must be migrated in place -- preserving every row --
    the first time init_db() runs against it."""

    _LEGACY_SCHEMA = """
        PRAGMA foreign_keys = ON;
        CREATE TABLE User (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, nickname TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE LostPost (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES User(id),
            title TEXT NOT NULL, description TEXT NOT NULL, category TEXT NOT NULL,
            location TEXT NOT NULL, lost_at TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT '찾는 중' CHECK (status IN ('찾는 중', '찾음')),
            image_url TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE FoundPost (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES User(id),
            title TEXT NOT NULL, description TEXT NOT NULL, category TEXT NOT NULL,
            location TEXT NOT NULL, found_at TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT '보관 중' CHECK (status IN ('보관 중', '완료')),
            image_url TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE Match (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            lost_post_id INTEGER NOT NULL REFERENCES LostPost(id) ON DELETE CASCADE,
            found_post_id INTEGER NOT NULL REFERENCES FoundPost(id) ON DELETE CASCADE,
            score REAL NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE (lost_post_id, found_post_id)
        );
        CREATE TABLE ChatRoom (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            match_id INTEGER NOT NULL UNIQUE REFERENCES Match(id) ON DELETE CASCADE,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE Message (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_room_id INTEGER NOT NULL REFERENCES ChatRoom(id) ON DELETE CASCADE,
            sender_user_id INTEGER NOT NULL REFERENCES User(id),
            content TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            read_at TEXT
        );
        CREATE TABLE Report (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            reporter_user_id INTEGER NOT NULL REFERENCES User(id),
            target_type TEXT NOT NULL CHECK (target_type IN ('post', 'message', 'user')),
            target_id INTEGER NOT NULL,
            reason TEXT NOT NULL,
            detail TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE (reporter_user_id, target_type, target_id)
        );
    """

    def setUp(self):
        self._tmp_dir = tempfile.TemporaryDirectory()
        self._orig_db_path = database.DB_PATH
        database.DB_PATH = Path(self._tmp_dir.name) / "legacy_admin.db"

        conn = sqlite3.connect(database.DB_PATH)
        conn.executescript(self._LEGACY_SCHEMA)
        conn.execute(
            "INSERT INTO User (email, name, nickname) VALUES ('legacy1@mju.ac.kr', '기존사용자1', '기존닉1')"
        )
        conn.execute(
            "INSERT INTO User (email, name, nickname) VALUES ('legacy2@mju.ac.kr', '기존사용자2', '기존닉2')"
        )
        conn.execute(
            "INSERT INTO LostPost (user_id, title, description, category, location, lost_at) "
            "VALUES (2, '기존 분실물', '설명', '기타', '장소', '2026-08-20 10:00')"
        )
        conn.execute(
            "INSERT INTO Report (reporter_user_id, target_type, target_id, reason, detail) "
            "VALUES (1, 'post', 1, '사기/허위 정보', '마이그레이션 전 기존 신고')"
        )
        conn.commit()
        conn.close()

    def tearDown(self):
        database.DB_PATH = self._orig_db_path
        self._tmp_dir.cleanup()

    def test_migration_preserves_existing_report_as_pending(self):
        database.init_db()

        report = database.get_report(1)
        self.assertIsNotNone(report)
        self.assertEqual(report["reason"], "사기/허위 정보")
        self.assertEqual(report["detail"], "마이그레이션 전 기존 신고")
        self.assertEqual(report["status"], "pending")
        self.assertIsNone(report["processed_at"])
        self.assertIsNone(report["processed_by_user_id"])
        self.assertIsNone(report["admin_note"])

    def test_migration_gives_existing_users_is_admin_zero(self):
        database.init_db()
        self.assertFalse(database.is_admin(1))
        self.assertFalse(database.is_admin(2))

    def test_migrated_report_can_be_processed_normally(self):
        database.init_db()
        with database.get_connection() as conn:
            conn.execute("UPDATE User SET is_admin = 1 WHERE id = 2")
        database.process_report(1, 2, "actioned", "마이그레이션 후 정상 처리")
        report = database.get_report(1)
        self.assertEqual(report["status"], "actioned")
        self.assertEqual(report["processed_by_user_id"], 2)

    def test_migration_is_idempotent(self):
        database.init_db()
        database.init_db()  # second run must be a no-op, not an error

        with database.get_connection() as conn:
            user_columns = [row[1] for row in conn.execute("PRAGMA table_info(User)").fetchall()]
            report_columns = [row[1] for row in conn.execute("PRAGMA table_info(Report)").fetchall()]
        self.assertEqual(user_columns.count("is_admin"), 1)
        self.assertEqual(report_columns.count("status"), 1)

        # data still intact and functional after two migration runs
        self.assertIsNotNone(database.get_report(1))
        self.assertEqual(database.list_reports_by_reporter(1)[0]["id"], 1)

    def test_is_admin_column_added_by_migration_defaults_to_zero(self):
        """is_admin.CHECK is only enforced on a freshly-created User table
        (schema.sql) -- see test_admin_check_constraint_enforced in
        AdminReportTestCase for that. This migration adds the column via a
        plain ALTER TABLE (no CHECK possible retroactively without a table
        rebuild, same tradeoff as every other ALTER-only migration in this
        module), so it's only verified to default correctly here."""
        database.init_db()
        self.assertEqual(database.get_user_by_id(1)["is_admin"], 0)


class ModerationTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp_dir = tempfile.TemporaryDirectory()
        self._orig_db_path = database.DB_PATH
        database.DB_PATH = Path(self._tmp_dir.name) / "test_moderation.db"
        database.init_db()

        self.reporter = database.create_user("reporter@mju.ac.kr", "신고자실명")
        self.target_user = database.create_user("target@mju.ac.kr", "대상실명")
        self.admin = database.create_user("admin@mju.ac.kr", "관리자실명")
        database.set_initial_nickname(self.reporter, "신고자닉")
        database.set_initial_nickname(self.target_user, "대상닉")
        database.set_initial_nickname(self.admin, "관리자닉")
        with database.get_connection() as conn:
            conn.execute("UPDATE User SET is_admin = 1 WHERE id = ?", (self.admin,))

        self.lost_id = database.create_lost_post(
            self.target_user, "검은색 에어팟", "설명", "전자기기", "도서관", "2026-08-25 15:00"
        )
        self.found_id = database.create_found_post(
            self.target_user, "검은색 무선 이어폰", "설명", "전자기기", "도서관", "2026-08-25 16:00"
        )
        self.match_id = database.create_match(self.lost_id, self.found_id, 0.9, self.target_user)
        self.room = database.get_or_create_chat_room(self.match_id, self.target_user)
        self.message = database.send_message(self.room["id"], self.target_user, "안녕하세요 원본 메시지")

        self.post_report_id = database.create_report(self.reporter, "post", self.lost_id, "기타")
        self.message_report_id = database.create_report(
            self.reporter, "message", self.message["id"], "욕설/비방"
        )
        self.user_report_id = database.create_report(self.reporter, "user", self.target_user, "기타")

    def tearDown(self):
        database.DB_PATH = self._orig_db_path
        self._tmp_dir.cleanup()

    # ---------- permission ----------

    def test_non_admin_cannot_call_apply_report_action(self):
        with self.assertRaises(database.PermissionDeniedError):
            database.apply_report_action(self.post_report_id, self.reporter, "delete_post")

    def test_target_user_cannot_call_apply_report_action_either(self):
        with self.assertRaises(database.PermissionDeniedError):
            database.apply_report_action(self.user_report_id, self.target_user, "suspend_user")

    def test_bypass_attempt_with_arbitrary_ids_cannot_apply_action(self):
        for fake_admin_id in (self.reporter, self.target_user, 99999, -1, 0):
            with self.assertRaises(database.PermissionDeniedError):
                database.apply_report_action(self.post_report_id, fake_admin_id, "delete_post")

    # ---------- delete_post ----------

    def test_admin_can_action_post_report_with_delete_post(self):
        database.apply_report_action(self.post_report_id, self.admin, "delete_post", action_reason="가짜 게시물")
        report = database.get_report(self.post_report_id)
        self.assertEqual(report["status"], "actioned")
        self.assertEqual(report["processed_by_user_id"], self.admin)

    def test_delete_post_actually_deletes_the_lost_post(self):
        database.apply_report_action(self.post_report_id, self.admin, "delete_post")
        self.assertIsNone(database.get_lost_post(self.lost_id))

    def test_delete_post_actually_deletes_the_found_post(self):
        found_report_id = database.create_report(self.reporter, "post", -self.found_id, "기타")
        database.apply_report_action(found_report_id, self.admin, "delete_post")
        self.assertIsNone(database.get_found_post(self.found_id))

    def test_report_survives_admin_post_deletion(self):
        database.apply_report_action(self.post_report_id, self.admin, "delete_post")
        self.assertIsNotNone(database.get_report(self.post_report_id))

    def test_moderation_action_survives_admin_post_deletion(self):
        action_id = database.apply_report_action(self.post_report_id, self.admin, "delete_post", "삭제사유")
        ma = database.get_moderation_action_for_report(self.post_report_id)
        self.assertIsNotNone(ma)
        self.assertEqual(ma["id"], action_id)
        self.assertEqual(ma["action_type"], "delete_post")
        self.assertEqual(ma["reason"], "삭제사유")
        self.assertEqual(ma["target_type"], "post")
        self.assertEqual(ma["target_id"], self.lost_id)
        self.assertEqual(ma["admin_user_id"], self.admin)

    def test_delete_post_cascades_match_chatroom_message(self):
        """Regression: admin post deletion must go through the same
        ON DELETE CASCADE chain as a normal owner deletion."""
        database.apply_report_action(self.post_report_id, self.admin, "delete_post")
        self.assertIsNone(database.get_match(self.match_id))
        with database.get_connection() as conn:
            self.assertIsNone(
                conn.execute("SELECT * FROM ChatRoom WHERE id = ?", (self.room["id"],)).fetchone()
            )
            self.assertIsNone(
                conn.execute("SELECT * FROM Message WHERE id = ?", (self.message["id"],)).fetchone()
            )

    def test_target_deleted_before_action_is_rejected(self):
        """The target may have been removed (by its owner, or a prior
        action) between when the admin's list loaded and the action being
        submitted -- must be rejected, not silently no-op."""
        database.delete_lost_post(self.lost_id, self.target_user)
        with self.assertRaises(ValueError):
            database.apply_report_action(self.post_report_id, self.admin, "delete_post")
        # atomicity: neither the Report nor a ModerationAction changed
        self.assertEqual(database.get_report(self.post_report_id)["status"], "pending")
        self.assertIsNone(database.get_moderation_action_for_report(self.post_report_id))

    # ---------- hide_message ----------

    def test_admin_can_action_message_report_with_hide_message(self):
        database.apply_report_action(self.message_report_id, self.admin, "hide_message", "욕설 확인됨")
        report = database.get_report(self.message_report_id)
        self.assertEqual(report["status"], "actioned")
        ma = database.get_moderation_action_for_report(self.message_report_id)
        self.assertEqual(ma["action_type"], "hide_message")
        self.assertEqual(ma["reason"], "욕설 확인됨")

    def test_hidden_message_content_masked_in_normal_list_messages(self):
        database.apply_report_action(self.message_report_id, self.admin, "hide_message")
        messages = database.list_messages(self.room["id"], self.target_user)
        hidden = next(m for m in messages if m["id"] == self.message["id"])
        self.assertEqual(hidden["content"], database.HIDDEN_MESSAGE_PLACEHOLDER)
        self.assertNotIn("안녕하세요 원본 메시지", hidden["content"])

    def test_hidden_message_original_content_preserved_in_db(self):
        """Not a real DELETE -- the row and its original content still exist."""
        database.apply_report_action(self.message_report_id, self.admin, "hide_message")
        with database.get_connection() as conn:
            row = conn.execute(
                "SELECT content, hidden_at, hidden_by_user_id FROM Message WHERE id = ?",
                (self.message["id"],),
            ).fetchone()
        self.assertEqual(row["content"], "안녕하세요 원본 메시지")
        self.assertIsNotNone(row["hidden_at"])
        self.assertEqual(row["hidden_by_user_id"], self.admin)

    def test_admin_report_view_shows_original_hidden_message_content(self):
        """Admin reviewing the report must still see the real content, even
        after it's hidden from normal chat participants."""
        database.apply_report_action(self.message_report_id, self.admin, "hide_message")
        reports = database.list_reports_for_admin(self.admin, target_type="message")
        r = next(x for x in reports if x["id"] == self.message_report_id)
        self.assertEqual(r["target_info"]["content"], "안녕하세요 원본 메시지")

    def test_other_messages_in_same_room_unaffected_by_hiding(self):
        other_msg = database.send_message(self.room["id"], self.target_user, "숨겨지지 않은 메시지")
        database.apply_report_action(self.message_report_id, self.admin, "hide_message")
        messages = database.list_messages(self.room["id"], self.target_user)
        untouched = next(m for m in messages if m["id"] == other_msg["id"])
        self.assertEqual(untouched["content"], "숨겨지지 않은 메시지")

    def test_target_message_deleted_before_action_is_rejected(self):
        database.delete_match(self.match_id, self.target_user)  # cascades the Message away
        with self.assertRaises(ValueError):
            database.apply_report_action(self.message_report_id, self.admin, "hide_message")
        self.assertEqual(database.get_report(self.message_report_id)["status"], "pending")

    # ---------- suspend_user ----------

    def test_admin_can_suspend_user_for_7_days(self):
        database.apply_report_action(
            self.user_report_id, self.admin, "suspend_user", suspend_duration_days=7
        )
        user = database.get_user_by_id(self.target_user)
        self.assertEqual(user["is_suspended"], 1)
        self.assertIsNotNone(user["suspended_until"])
        self.assertTrue(database.is_user_suspended(self.target_user))

    def test_admin_can_suspend_user_for_30_days(self):
        database.apply_report_action(
            self.user_report_id, self.admin, "suspend_user", suspend_duration_days=30
        )
        ma = database.get_moderation_action_for_report(self.user_report_id)
        self.assertIsNotNone(ma["expires_at"])
        self.assertTrue(database.is_user_suspended(self.target_user))

    def test_admin_can_suspend_user_permanently(self):
        database.apply_report_action(self.user_report_id, self.admin, "suspend_user")
        user = database.get_user_by_id(self.target_user)
        self.assertEqual(user["is_suspended"], 1)
        self.assertIsNone(user["suspended_until"])
        ma = database.get_moderation_action_for_report(self.user_report_id)
        self.assertIsNone(ma["expires_at"])
        self.assertTrue(database.is_user_suspended(self.target_user))

    def test_invalid_suspend_duration_rejected(self):
        with self.assertRaises(ValueError):
            database.apply_report_action(
                self.user_report_id, self.admin, "suspend_user", suspend_duration_days=0
            )
        with self.assertRaises(ValueError):
            database.apply_report_action(
                self.user_report_id, self.admin, "suspend_user", suspend_duration_days=-3
            )

    # ---------- suspension blocks new interactions ----------

    def test_suspended_user_cannot_create_lost_post(self):
        database.apply_report_action(self.user_report_id, self.admin, "suspend_user")
        with self.assertRaises(database.PermissionDeniedError):
            database.create_lost_post(
                self.target_user, "새 게시물", "설명", "기타", "장소", "2026-08-27 10:00"
            )

    def test_suspended_user_cannot_create_found_post(self):
        database.apply_report_action(self.user_report_id, self.admin, "suspend_user")
        with self.assertRaises(database.PermissionDeniedError):
            database.create_found_post(
                self.target_user, "새 게시물", "설명", "기타", "장소", "2026-08-27 10:00"
            )

    def test_suspended_user_cannot_confirm_match(self):
        other_lost = database.create_lost_post(
            self.reporter, "다른 분실물", "설명", "기타", "장소", "2026-08-27 09:00"
        )
        database.apply_report_action(self.user_report_id, self.admin, "suspend_user")
        with self.assertRaises(database.PermissionDeniedError):
            database.create_match(other_lost, self.found_id, 0.8, self.target_user)

    def test_suspended_user_cannot_send_message(self):
        database.apply_report_action(self.user_report_id, self.admin, "suspend_user")
        with self.assertRaises(database.PermissionDeniedError):
            database.send_message(self.room["id"], self.target_user, "정지된 상태에서 보내려는 메시지")

    def test_suspended_user_error_message_is_the_documented_constant(self):
        database.apply_report_action(self.user_report_id, self.admin, "suspend_user")
        try:
            database.create_lost_post(
                self.target_user, "새 게시물", "설명", "기타", "장소", "2026-08-27 10:00"
            )
            self.fail("expected PermissionDeniedError")
        except database.PermissionDeniedError as e:
            self.assertEqual(str(e), database.SUSPENDED_ACCOUNT_MESSAGE)

    def test_suspended_user_can_still_view_own_data(self):
        """Suspension blocks new interactions only -- existing list/get
        functions must remain fully usable."""
        database.apply_report_action(self.user_report_id, self.admin, "suspend_user")
        self.assertIsNotNone(database.get_lost_post(self.lost_id))
        self.assertEqual(len(database.list_lost_posts_by_user(self.target_user)), 1)
        self.assertEqual(len(database.list_reports_by_reporter(self.reporter)), 3)
        # can still read chat history
        messages = database.list_messages(self.room["id"], self.target_user)
        self.assertEqual(len(messages), 1)

    def test_expired_timed_suspension_allows_use_again(self):
        database.apply_report_action(
            self.user_report_id, self.admin, "suspend_user", suspend_duration_days=7
        )
        # simulate the suspension having already expired
        with database.get_connection() as conn:
            conn.execute(
                "UPDATE User SET suspended_until = datetime('now', '-1 minute') WHERE id = ?",
                (self.target_user,),
            )
        self.assertFalse(database.is_user_suspended(self.target_user))
        new_id = database.create_lost_post(
            self.target_user, "정지 만료 후 새 게시물", "설명", "기타", "장소", "2026-08-27 10:00"
        )
        self.assertIsNotNone(database.get_lost_post(new_id))

    def test_permanent_suspension_does_not_expire(self):
        database.apply_report_action(self.user_report_id, self.admin, "suspend_user")
        self.assertTrue(database.is_user_suspended(self.target_user))

    # ---------- action_type validation ----------

    def test_invalid_action_type_rejected(self):
        with self.assertRaises(ValueError):
            database.apply_report_action(self.post_report_id, self.admin, "ban_hammer")

    def test_action_type_target_type_mismatch_rejected(self):
        with self.assertRaises(ValueError):
            database.apply_report_action(self.post_report_id, self.admin, "hide_message")
        with self.assertRaises(ValueError):
            database.apply_report_action(self.post_report_id, self.admin, "suspend_user")
        with self.assertRaises(ValueError):
            database.apply_report_action(self.message_report_id, self.admin, "delete_post")
        with self.assertRaises(ValueError):
            database.apply_report_action(self.user_report_id, self.admin, "delete_post")
        # rejected before anything happens
        self.assertEqual(database.get_report(self.post_report_id)["status"], "pending")

    # ---------- re-processing / duplicate action prevention ----------

    def test_already_actioned_report_cannot_be_actioned_again(self):
        database.apply_report_action(self.post_report_id, self.admin, "delete_post")
        with self.assertRaises(ValueError):
            database.apply_report_action(self.post_report_id, self.admin, "delete_post")

    def test_dismissed_report_cannot_then_be_actioned(self):
        database.process_report(self.post_report_id, self.admin, "dismissed")
        with self.assertRaises(ValueError):
            database.apply_report_action(self.post_report_id, self.admin, "delete_post")

    def test_actioned_report_cannot_then_be_dismissed(self):
        database.apply_report_action(self.post_report_id, self.admin, "delete_post")
        with self.assertRaises(ValueError):
            database.process_report(self.post_report_id, self.admin, "dismissed")

    def test_duplicate_moderation_action_rejected_even_via_raw_connection(self):
        """Final backstop: the UNIQUE(report_id) constraint itself,
        independent of apply_report_action()'s own pre-check."""
        database.apply_report_action(self.post_report_id, self.admin, "delete_post")
        with self.assertRaises(sqlite3.IntegrityError):
            with database.get_connection() as conn:
                conn.execute(
                    """
                    INSERT INTO ModerationAction
                        (report_id, target_type, target_id, action_type, admin_user_id)
                    VALUES (?, 'post', ?, 'delete_post', ?)
                    """,
                    (self.post_report_id, self.lost_id, self.admin),
                )

    def test_concurrent_style_double_action_does_not_duplicate(self):
        """Simulates a second admin's request arriving after the first has
        already committed its ModerationAction+Report update -- the second
        call must be rejected cleanly, and only one ModerationAction must
        exist for the report."""
        other_admin = database.create_user("admin2@mju.ac.kr", "관리자2실명")
        database.set_initial_nickname(other_admin, "관리자2닉")
        with database.get_connection() as conn:
            conn.execute("UPDATE User SET is_admin = 1 WHERE id = ?", (other_admin,))

        database.apply_report_action(self.post_report_id, self.admin, "delete_post")
        with self.assertRaises(ValueError):
            database.apply_report_action(self.post_report_id, other_admin, "delete_post")

        with database.get_connection() as conn:
            count = conn.execute(
                "SELECT COUNT(*) c FROM ModerationAction WHERE report_id = ?",
                (self.post_report_id,),
            ).fetchone()["c"]
        self.assertEqual(count, 1)

    # ---------- existing Report processing / filters untouched ----------

    def test_process_report_dismissed_path_still_works_unchanged(self):
        database.process_report(self.post_report_id, self.admin, "dismissed", "문제 없음")
        report = database.get_report(self.post_report_id)
        self.assertEqual(report["status"], "dismissed")
        self.assertIsNone(database.get_moderation_action_for_report(self.post_report_id))

    def test_list_reports_for_admin_still_filters_and_paginates(self):
        reports = database.list_reports_for_admin(self.admin, status="pending")
        self.assertEqual(len(reports), 3)
        database.apply_report_action(self.post_report_id, self.admin, "delete_post")
        pending = database.list_reports_for_admin(self.admin, status="pending")
        actioned = database.list_reports_for_admin(self.admin, status="actioned")
        self.assertEqual(len(pending), 2)
        self.assertEqual(len(actioned), 1)

    def test_list_reports_for_admin_includes_moderation_action(self):
        database.apply_report_action(self.post_report_id, self.admin, "delete_post", "테스트 사유")
        reports = database.list_reports_for_admin(self.admin, status="actioned")
        r = next(x for x in reports if x["id"] == self.post_report_id)
        self.assertIsNotNone(r["moderation_action"])
        self.assertEqual(r["moderation_action"]["action_type"], "delete_post")
        self.assertEqual(r["moderation_action"]["admin_nickname"], "관리자닉")

    def test_pending_report_has_no_moderation_action(self):
        reports = database.list_reports_for_admin(self.admin, status="pending")
        self.assertTrue(all(r["moderation_action"] is None for r in reports))

    def test_target_deleted_still_shown_after_admin_deletes_it(self):
        """Deleting via apply_report_action() must leave the report visible
        with target_deleted=True, same as a normal owner deletion would."""
        database.apply_report_action(self.post_report_id, self.admin, "delete_post")
        reports = database.list_reports_for_admin(self.admin, status="actioned")
        r = next(x for x in reports if x["id"] == self.post_report_id)
        self.assertTrue(r["target_deleted"])


class ModerationMigrationTestCase(unittest.TestCase):
    """A DB built against the pre-moderation schema (Report already has
    status/processed_*/admin_note and User already has is_admin, but no
    User.is_suspended/suspended_until, no Message.hidden_*, no
    ModerationAction table), with real report data in it, must be migrated
    in place -- preserving every row -- the first time init_db() runs
    against it."""

    _LEGACY_SCHEMA = """
        PRAGMA foreign_keys = ON;
        CREATE TABLE User (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, nickname TEXT,
            is_admin INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE LostPost (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES User(id),
            title TEXT NOT NULL, description TEXT NOT NULL, category TEXT NOT NULL,
            location TEXT NOT NULL, lost_at TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT '찾는 중' CHECK (status IN ('찾는 중', '찾음')),
            image_url TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE FoundPost (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES User(id),
            title TEXT NOT NULL, description TEXT NOT NULL, category TEXT NOT NULL,
            location TEXT NOT NULL, found_at TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT '보관 중' CHECK (status IN ('보관 중', '완료')),
            image_url TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE Match (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            lost_post_id INTEGER NOT NULL REFERENCES LostPost(id) ON DELETE CASCADE,
            found_post_id INTEGER NOT NULL REFERENCES FoundPost(id) ON DELETE CASCADE,
            score REAL NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE (lost_post_id, found_post_id)
        );
        CREATE TABLE ChatRoom (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            match_id INTEGER NOT NULL UNIQUE REFERENCES Match(id) ON DELETE CASCADE,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE Message (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_room_id INTEGER NOT NULL REFERENCES ChatRoom(id) ON DELETE CASCADE,
            sender_user_id INTEGER NOT NULL REFERENCES User(id),
            content TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            read_at TEXT
        );
        CREATE TABLE Report (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            reporter_user_id INTEGER NOT NULL REFERENCES User(id),
            target_type TEXT NOT NULL CHECK (target_type IN ('post', 'message', 'user')),
            target_id INTEGER NOT NULL,
            reason TEXT NOT NULL,
            detail TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'dismissed', 'actioned')),
            processed_at TEXT,
            processed_by_user_id INTEGER REFERENCES User(id),
            admin_note TEXT,
            UNIQUE (reporter_user_id, target_type, target_id)
        );
    """

    def setUp(self):
        self._tmp_dir = tempfile.TemporaryDirectory()
        self._orig_db_path = database.DB_PATH
        database.DB_PATH = Path(self._tmp_dir.name) / "legacy_moderation.db"

        conn = sqlite3.connect(database.DB_PATH)
        conn.executescript(self._LEGACY_SCHEMA)
        conn.execute(
            "INSERT INTO User (email, name, nickname, is_admin) "
            "VALUES ('legacy1@mju.ac.kr', '기존사용자1', '기존닉1', 0)"
        )
        conn.execute(
            "INSERT INTO User (email, name, nickname, is_admin) "
            "VALUES ('legacy2@mju.ac.kr', '기존사용자2', '기존닉2', 1)"
        )
        conn.execute(
            "INSERT INTO LostPost (user_id, title, description, category, location, lost_at) "
            "VALUES (1, '기존 분실물', '설명', '기타', '장소', '2026-08-20 10:00')"
        )
        conn.execute(
            "INSERT INTO Report (reporter_user_id, target_type, target_id, reason, status) "
            "VALUES (1, 'post', 1, '사기/허위 정보', 'pending')"
        )
        conn.commit()
        conn.close()

    def tearDown(self):
        database.DB_PATH = self._orig_db_path
        self._tmp_dir.cleanup()

    def test_migration_preserves_existing_report_and_users(self):
        database.init_db()
        self.assertIsNotNone(database.get_report(1))
        self.assertEqual(database.get_report(1)["status"], "pending")
        self.assertTrue(database.is_admin(2))
        self.assertFalse(database.is_admin(1))

    def test_migration_adds_suspension_columns_defaulting_to_not_suspended(self):
        database.init_db()
        user = database.get_user_by_id(1)
        self.assertEqual(user["is_suspended"], 0)
        self.assertIsNone(user["suspended_until"])
        self.assertFalse(database.is_user_suspended(1))

    def test_migration_adds_message_hidden_columns(self):
        database.init_db()
        with database.get_connection() as conn:
            columns = [row[1] for row in conn.execute("PRAGMA table_info(Message)").fetchall()]
        self.assertIn("hidden_at", columns)
        self.assertIn("hidden_by_user_id", columns)
        self.assertIn("hidden_reason", columns)

    def test_migration_creates_moderation_action_table(self):
        database.init_db()
        with database.get_connection() as conn:
            table = conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='ModerationAction'"
            ).fetchone()
        self.assertIsNotNone(table)

    def test_migrated_report_can_be_actioned_normally(self):
        database.init_db()
        database.apply_report_action(1, 2, "delete_post", "마이그레이션 후 정상 조치")
        self.assertIsNone(database.get_lost_post(1))
        report = database.get_report(1)
        self.assertEqual(report["status"], "actioned")
        ma = database.get_moderation_action_for_report(1)
        self.assertEqual(ma["action_type"], "delete_post")

    def test_migration_is_idempotent(self):
        database.init_db()
        database.init_db()  # second run must be a no-op, not an error

        with database.get_connection() as conn:
            user_columns = [row[1] for row in conn.execute("PRAGMA table_info(User)").fetchall()]
            message_columns = [row[1] for row in conn.execute("PRAGMA table_info(Message)").fetchall()]
        self.assertEqual(user_columns.count("is_suspended"), 1)
        self.assertEqual(user_columns.count("suspended_until"), 1)
        self.assertEqual(message_columns.count("hidden_at"), 1)

        # data still intact and functional after two migration runs
        self.assertIsNotNone(database.get_report(1))
        database.apply_report_action(1, 2, "delete_post")
        self.assertIsNone(database.get_lost_post(1))


class NotificationTestCase(unittest.TestCase):
    """Direct tests of the Notification CRUD/permission API in isolation
    (create_notification/list_notifications_by_user/count_unread_notifications/
    mark_notification_as_read/mark_all_notifications_as_read) -- event-source
    integration (send_message/create_match/process_report/apply_report_action
    actually creating the right notifications, atomically) is covered
    separately below in NotificationEventTestCase."""

    def setUp(self):
        self._tmp_dir = tempfile.TemporaryDirectory()
        self._orig_db_path = database.DB_PATH
        database.DB_PATH = Path(self._tmp_dir.name) / "test_notification.db"
        database.init_db()

        self.userA = database.create_user("usera@mju.ac.kr", "사용자A실명")
        self.userB = database.create_user("userb@mju.ac.kr", "사용자B실명")
        database.set_initial_nickname(self.userA, "사용자A닉")
        database.set_initial_nickname(self.userB, "사용자B닉")

    def tearDown(self):
        database.DB_PATH = self._orig_db_path
        self._tmp_dir.cleanup()

    # ---------- create_notification ----------

    def test_create_notification_success(self):
        nid = database.create_notification(
            self.userA, "message", "제목", "내용", related_type="message", related_id=1
        )
        n = database.get_notification(nid)
        self.assertEqual(n["user_id"], self.userA)
        self.assertEqual(n["type"], "message")
        self.assertEqual(n["title"], "제목")
        self.assertEqual(n["content"], "내용")
        self.assertEqual(n["related_type"], "message")
        self.assertEqual(n["related_id"], 1)
        self.assertEqual(n["is_read"], 0)

    def test_create_notification_without_related_object(self):
        nid = database.create_notification(self.userA, "match", "제목", "내용")
        n = database.get_notification(nid)
        self.assertIsNone(n["related_type"])
        self.assertIsNone(n["related_id"])

    def test_create_notification_nonexistent_user_rejected(self):
        with self.assertRaises(ValueError):
            database.create_notification(99999, "message", "제목", "내용")

    def test_create_notification_invalid_type_rejected(self):
        with self.assertRaises(ValueError):
            database.create_notification(self.userA, "spam", "제목", "내용")

    def test_create_notification_blank_title_rejected(self):
        with self.assertRaises(ValueError):
            database.create_notification(self.userA, "match", "", "내용")
        with self.assertRaises(ValueError):
            database.create_notification(self.userA, "match", "   ", "내용")

    def test_create_notification_blank_content_rejected(self):
        with self.assertRaises(ValueError):
            database.create_notification(self.userA, "match", "제목", "")

    def test_create_notification_inconsistent_related_pair_rejected(self):
        with self.assertRaises(ValueError):
            database.create_notification(self.userA, "match", "제목", "내용", related_type="match")
        with self.assertRaises(ValueError):
            database.create_notification(self.userA, "match", "제목", "내용", related_id=1)

    # ---------- listing / ordering / pagination ----------

    def test_list_notifications_newest_first(self):
        n1 = database.create_notification(self.userA, "match", "1번", "내용", related_type="match", related_id=1)
        n2 = database.create_notification(self.userA, "match", "2번", "내용", related_type="match", related_id=2)
        notifications = database.list_notifications_by_user(self.userA)
        self.assertEqual([n["id"] for n in notifications], [n2, n1])

    def test_list_notifications_pagination(self):
        for i in range(5):
            database.create_notification(
                self.userA, "match", f"{i}번", "내용", related_type="match", related_id=i
            )
        page1 = database.list_notifications_by_user(self.userA, limit=2, offset=0)
        page2 = database.list_notifications_by_user(self.userA, limit=2, offset=2)
        self.assertEqual(len(page1), 2)
        self.assertEqual(len(page2), 2)
        self.assertNotEqual({n["id"] for n in page1}, {n["id"] for n in page2})

    def test_list_notifications_only_returns_own(self):
        database.create_notification(self.userA, "match", "A의 알림", "내용", related_type="match", related_id=1)
        database.create_notification(self.userB, "match", "B의 알림", "내용", related_type="match", related_id=2)
        a_notifications = database.list_notifications_by_user(self.userA)
        self.assertEqual(len(a_notifications), 1)
        self.assertEqual(a_notifications[0]["title"], "A의 알림")

    def test_list_notifications_empty_for_user_with_none(self):
        self.assertEqual(database.list_notifications_by_user(self.userA), [])

    # ---------- unread count ----------

    def test_count_unread_notifications(self):
        database.create_notification(self.userA, "match", "1", "내용", related_type="match", related_id=1)
        database.create_notification(self.userA, "match", "2", "내용", related_type="match", related_id=2)
        self.assertEqual(database.count_unread_notifications(self.userA), 2)

    def test_count_unread_notifications_excludes_other_users(self):
        database.create_notification(self.userB, "match", "B", "내용", related_type="match", related_id=1)
        self.assertEqual(database.count_unread_notifications(self.userA), 0)

    def test_count_unread_notifications_zero_when_no_notifications(self):
        self.assertEqual(database.count_unread_notifications(self.userA), 0)

    # ---------- mark_notification_as_read ----------

    def test_mark_notification_as_read_success(self):
        nid = database.create_notification(self.userA, "match", "1", "내용", related_type="match", related_id=1)
        database.mark_notification_as_read(nid, self.userA)
        self.assertEqual(database.get_notification(nid)["is_read"], 1)
        self.assertEqual(database.count_unread_notifications(self.userA), 0)

    def test_mark_notification_as_read_nonexistent_raises_value_error(self):
        with self.assertRaises(ValueError):
            database.mark_notification_as_read(99999, self.userA)

    def test_mark_notification_as_read_rejects_other_users_notification(self):
        nid = database.create_notification(self.userA, "match", "A의 알림", "내용", related_type="match", related_id=1)
        with self.assertRaises(database.PermissionDeniedError):
            database.mark_notification_as_read(nid, self.userB)
        self.assertEqual(database.get_notification(nid)["is_read"], 0)

    def test_mark_notification_as_read_blocked_even_via_raw_sql_where_clause(self):
        """Verifies the UPDATE's own WHERE id=? AND user_id=? actually
        excludes another user's row -- not just the pre-check above."""
        nid = database.create_notification(self.userA, "match", "A의 알림", "내용", related_type="match", related_id=1)
        with database.get_connection() as conn:
            cursor = conn.execute(
                "UPDATE Notification SET is_read = 1 WHERE id = ? AND user_id = ?",
                (nid, self.userB),
            )
        self.assertEqual(cursor.rowcount, 0)
        self.assertEqual(database.get_notification(nid)["is_read"], 0)

    def test_already_read_notification_can_be_marked_read_again(self):
        nid = database.create_notification(self.userA, "match", "1", "내용", related_type="match", related_id=1)
        database.mark_notification_as_read(nid, self.userA)
        database.mark_notification_as_read(nid, self.userA)  # must not raise
        self.assertEqual(database.get_notification(nid)["is_read"], 1)

    # ---------- mark_all_notifications_as_read ----------

    def test_mark_all_notifications_as_read(self):
        database.create_notification(self.userA, "match", "1", "내용", related_type="match", related_id=1)
        database.create_notification(self.userA, "match", "2", "내용", related_type="match", related_id=2)
        updated = database.mark_all_notifications_as_read(self.userA)
        self.assertEqual(updated, 2)
        self.assertEqual(database.count_unread_notifications(self.userA), 0)

    def test_mark_all_notifications_as_read_does_not_affect_other_users(self):
        database.create_notification(self.userA, "match", "A", "내용", related_type="match", related_id=1)
        database.create_notification(self.userB, "match", "B", "내용", related_type="match", related_id=2)
        database.mark_all_notifications_as_read(self.userA)
        self.assertEqual(database.count_unread_notifications(self.userB), 1)

    def test_mark_all_notifications_as_read_returns_zero_when_none_unread(self):
        self.assertEqual(database.mark_all_notifications_as_read(self.userA), 0)

    # ---------- duplicate prevention ----------

    def test_duplicate_notification_is_not_created_twice(self):
        n1 = database.create_notification(
            self.userA, "match", "1", "내용", related_type="match", related_id=1
        )
        n2 = database.create_notification(
            self.userA, "match", "1", "내용", related_type="match", related_id=1
        )
        self.assertEqual(n1, n2)
        self.assertEqual(len(database.list_notifications_by_user(self.userA)), 1)

    def test_duplicate_prevented_even_via_raw_connection(self):
        """Final backstop: the UNIQUE(user_id, type, related_type,
        related_id) constraint itself."""
        database.create_notification(
            self.userA, "match", "1", "내용", related_type="match", related_id=1
        )
        with self.assertRaises(sqlite3.IntegrityError):
            with database.get_connection() as conn:
                conn.execute(
                    """
                    INSERT INTO Notification (user_id, type, title, content, related_type, related_id)
                    VALUES (?, 'match', '중복', '내용', 'match', 1)
                    """,
                    (self.userA,),
                )

    def test_different_related_id_is_not_a_duplicate(self):
        database.create_notification(self.userA, "match", "1", "내용", related_type="match", related_id=1)
        database.create_notification(self.userA, "match", "2", "내용", related_type="match", related_id=2)
        self.assertEqual(len(database.list_notifications_by_user(self.userA)), 2)


class NotificationEventTestCase(unittest.TestCase):
    """Verifies the four real event sources -- send_message(), create_match(),
    process_report(), apply_report_action() -- create exactly the right
    Notification rows, atomically with the event itself."""

    def setUp(self):
        self._tmp_dir = tempfile.TemporaryDirectory()
        self._orig_db_path = database.DB_PATH
        database.DB_PATH = Path(self._tmp_dir.name) / "test_notification_events.db"
        database.init_db()

        self.reporter = database.create_user("reporter@mju.ac.kr", "신고자실명")
        self.target_user = database.create_user("target@mju.ac.kr", "대상실명")
        self.admin = database.create_user("admin@mju.ac.kr", "관리자실명")
        database.set_initial_nickname(self.reporter, "신고자닉")
        database.set_initial_nickname(self.target_user, "대상닉")
        database.set_initial_nickname(self.admin, "관리자닉")
        with database.get_connection() as conn:
            conn.execute("UPDATE User SET is_admin = 1 WHERE id = ?", (self.admin,))

        self.lost_id = database.create_lost_post(
            self.target_user, "검은색 에어팟", "설명", "전자기기", "도서관", "2026-08-25 15:00"
        )
        self.found_id = database.create_found_post(
            self.reporter, "검은색 무선 이어폰", "설명", "전자기기", "도서관", "2026-08-25 16:00"
        )

    def tearDown(self):
        database.DB_PATH = self._orig_db_path
        self._tmp_dir.cleanup()

    # ---------- message ----------

    def test_send_message_notifies_only_the_other_participant(self):
        match_id = database.create_match(self.lost_id, self.found_id, 0.9, self.target_user)
        room = database.get_or_create_chat_room(match_id, self.target_user)

        msg = database.send_message(room["id"], self.target_user, "안녕하세요")

        reporter_message_notifications = [
            n for n in database.list_notifications_by_user(self.reporter) if n["type"] == "message"
        ]
        target_message_notifications = [
            n for n in database.list_notifications_by_user(self.target_user) if n["type"] == "message"
        ]
        self.assertEqual(len(reporter_message_notifications), 1)
        self.assertEqual(reporter_message_notifications[0]["related_type"], "message")
        self.assertEqual(reporter_message_notifications[0]["related_id"], msg["id"])
        self.assertIn("대상닉", reporter_message_notifications[0]["content"])
        self.assertEqual(target_message_notifications, [])  # sender gets no notification

    def test_send_message_notification_uses_sender_nickname_not_name_or_email(self):
        match_id = database.create_match(self.lost_id, self.found_id, 0.9, self.target_user)
        room = database.get_or_create_chat_room(match_id, self.target_user)
        database.send_message(room["id"], self.target_user, "안녕하세요")

        n = database.list_notifications_by_user(self.reporter)[0]
        self.assertIn("대상닉", n["content"])
        self.assertNotIn("대상실명", n["content"])
        self.assertNotIn("target@mju.ac.kr", n["content"])

    def _message_notifications(self, user_id):
        return [n for n in database.list_notifications_by_user(user_id) if n["type"] == "message"]

    def test_one_message_creates_exactly_one_notification(self):
        match_id = database.create_match(self.lost_id, self.found_id, 0.9, self.target_user)
        room = database.get_or_create_chat_room(match_id, self.target_user)

        database.send_message(room["id"], self.target_user, "메시지 1")
        self.assertEqual(len(self._message_notifications(self.reporter)), 1)

    def test_two_messages_create_two_distinct_notifications(self):
        """related_id is the message id (not the chat_room_id) specifically
        so distinct messages in the same room don't collide on the
        UNIQUE(user_id, type, related_type, related_id) constraint."""
        match_id = database.create_match(self.lost_id, self.found_id, 0.9, self.target_user)
        room = database.get_or_create_chat_room(match_id, self.target_user)

        database.send_message(room["id"], self.target_user, "메시지 1")
        database.send_message(room["id"], self.target_user, "메시지 2")
        notifications = self._message_notifications(self.reporter)
        self.assertEqual(len(notifications), 2)
        self.assertNotEqual(notifications[0]["related_id"], notifications[1]["related_id"])

    def test_repeated_send_message_calls_do_not_deduplicate_real_distinct_messages(self):
        """Simulates a Streamlit rerun scenario: calling send_message() again
        is a *new* real message (unlike a page-render notification, this is
        a genuine user action each time) -- each gets its own notification,
        which is correct, not a bug; rerun-safety here means "no notification
        created by rendering", which is verified separately by the fact that
        list_/count_ functions never call create/insert."""
        match_id = database.create_match(self.lost_id, self.found_id, 0.9, self.target_user)
        room = database.get_or_create_chat_room(match_id, self.target_user)

        for _ in range(3):
            database.send_message(room["id"], self.target_user, "같은 내용")
        self.assertEqual(len(self._message_notifications(self.reporter)), 3)

    def test_hidden_message_notification_content_unaffected(self):
        match_id = database.create_match(self.lost_id, self.found_id, 0.9, self.target_user)
        room = database.get_or_create_chat_room(match_id, self.target_user)
        msg = database.send_message(room["id"], self.target_user, "안녕하세요")
        report_id = database.create_report(self.reporter, "message", msg["id"], "욕설/비방")
        database.apply_report_action(report_id, self.admin, "hide_message")

        # the original "message" notification (about the now-hidden message)
        # keeps its own recorded content -- notifications are historical.
        n = next(n for n in database.list_notifications_by_user(self.reporter) if n["type"] == "message")
        self.assertIn("메시지를 보냈습니다", n["content"])

    # ---------- match ----------

    def test_create_match_notifies_both_participants(self):
        match_id = database.create_match(self.lost_id, self.found_id, 0.9, self.target_user)

        target_notifications = database.list_notifications_by_user(self.target_user)
        reporter_notifications = database.list_notifications_by_user(self.reporter)
        self.assertEqual(len(target_notifications), 1)
        self.assertEqual(len(reporter_notifications), 1)
        for n in (target_notifications[0], reporter_notifications[0]):
            self.assertEqual(n["type"], "match")
            self.assertEqual(n["related_type"], "match")
            self.assertEqual(n["related_id"], match_id)

    def test_idempotent_match_creation_does_not_duplicate_notifications(self):
        database.create_match(self.lost_id, self.found_id, 0.9, self.target_user)
        database.create_match(self.lost_id, self.found_id, 0.9, self.target_user)  # already exists
        self.assertEqual(len(database.list_notifications_by_user(self.target_user)), 1)
        self.assertEqual(len(database.list_notifications_by_user(self.reporter)), 1)

    def test_match_creation_rolls_back_if_notification_insert_fails(self):
        """Forces _insert_notification() to fail mid-transaction (an
        unsupported type) and verifies the Match itself was never
        committed -- the whole create_match() transaction is atomic."""
        with patch.object(database, "NOTIFICATION_TYPES", set()):
            with self.assertRaises(ValueError):
                database.create_match(self.lost_id, self.found_id, 0.9, self.target_user)
        self.assertIsNone(database.get_match_by_posts(self.lost_id, self.found_id))

    def test_message_send_rolls_back_if_notification_insert_fails(self):
        match_id = database.create_match(self.lost_id, self.found_id, 0.9, self.target_user)
        room = database.get_or_create_chat_room(match_id, self.target_user)
        before = database.list_messages(room["id"], self.target_user)

        with patch.object(database, "NOTIFICATION_TYPES", set()):
            with self.assertRaises(ValueError):
                database.send_message(room["id"], self.target_user, "실패해야 하는 메시지")

        after = database.list_messages(room["id"], self.target_user)
        self.assertEqual(len(before), len(after))  # no half-sent message persisted

    # ---------- report processing (dismissed) ----------

    def test_process_report_dismissed_notifies_reporter(self):
        report_id = database.create_report(self.reporter, "post", self.lost_id, "기타")
        database.process_report(report_id, self.admin, "dismissed", "문제 없음")

        notifications = database.list_notifications_by_user(self.reporter)
        self.assertEqual(len(notifications), 1)
        self.assertEqual(notifications[0]["type"], "report_processed")
        self.assertEqual(notifications[0]["related_type"], "report")
        self.assertEqual(notifications[0]["related_id"], report_id)
        self.assertIn("반려", notifications[0]["content"])

    def test_process_report_does_not_notify_the_report_target(self):
        report_id = database.create_report(self.reporter, "post", self.lost_id, "기타")
        database.process_report(report_id, self.admin, "dismissed")
        self.assertEqual(database.list_notifications_by_user(self.target_user), [])

    # ---------- delete_post ----------

    def test_delete_post_action_notifies_target_author_and_reporter(self):
        report_id = database.create_report(self.reporter, "post", self.lost_id, "기타")
        database.apply_report_action(report_id, self.admin, "delete_post", "허위 게시물")

        author_notifications = database.list_notifications_by_user(self.target_user)
        reporter_notifications = database.list_notifications_by_user(self.reporter)
        self.assertEqual(len(author_notifications), 1)
        self.assertEqual(author_notifications[0]["type"], "post_deleted")
        self.assertEqual(author_notifications[0]["related_type"], "report")
        self.assertEqual(author_notifications[0]["related_id"], report_id)

        report_processed = [n for n in reporter_notifications if n["type"] == "report_processed"]
        self.assertEqual(len(report_processed), 1)
        self.assertEqual(report_processed[0]["related_id"], report_id)

    def test_delete_post_action_rolls_back_everything_if_notification_fails(self):
        report_id = database.create_report(self.reporter, "post", self.lost_id, "기타")
        with patch.object(database, "NOTIFICATION_TYPES", set()):
            with self.assertRaises(ValueError):
                database.apply_report_action(report_id, self.admin, "delete_post")

        # nothing committed: post still exists, report still pending, no ModerationAction
        self.assertIsNotNone(database.get_lost_post(self.lost_id))
        self.assertEqual(database.get_report(report_id)["status"], "pending")
        self.assertIsNone(database.get_moderation_action_for_report(report_id))

    # ---------- hide_message ----------

    def test_hide_message_action_notifies_sender_and_reporter(self):
        match_id = database.create_match(self.lost_id, self.found_id, 0.9, self.target_user)
        room = database.get_or_create_chat_room(match_id, self.target_user)
        msg = database.send_message(room["id"], self.reporter, "신고 대상 메시지")
        report_id = database.create_report(self.target_user, "message", msg["id"], "욕설/비방")
        database.mark_all_notifications_as_read(self.reporter)
        database.mark_all_notifications_as_read(self.target_user)

        database.apply_report_action(report_id, self.admin, "hide_message", "욕설 확인됨")

        sender_notifications = database.list_notifications_by_user(self.reporter)
        reporter_notifications = database.list_notifications_by_user(self.target_user)
        message_hidden = [n for n in sender_notifications if n["type"] == "message_hidden"]
        report_processed = [n for n in reporter_notifications if n["type"] == "report_processed"]
        self.assertEqual(len(message_hidden), 1)
        self.assertEqual(message_hidden[0]["related_id"], report_id)
        self.assertEqual(len(report_processed), 1)

    # ---------- suspend_user ----------

    def test_suspend_user_action_notifies_target_and_reporter(self):
        report_id = database.create_report(self.reporter, "user", self.target_user, "기타")
        database.apply_report_action(report_id, self.admin, "suspend_user", suspend_duration_days=7)

        target_notifications = database.list_notifications_by_user(self.target_user)
        reporter_notifications = database.list_notifications_by_user(self.reporter)
        suspended = [n for n in target_notifications if n["type"] == "user_suspended"]
        report_processed = [n for n in reporter_notifications if n["type"] == "report_processed"]
        self.assertEqual(len(suspended), 1)
        self.assertIn("7일", suspended[0]["content"])
        self.assertEqual(len(report_processed), 1)

    def test_permanent_suspension_notification_says_permanent(self):
        report_id = database.create_report(self.reporter, "user", self.target_user, "기타")
        database.apply_report_action(report_id, self.admin, "suspend_user")
        n = next(
            n for n in database.list_notifications_by_user(self.target_user) if n["type"] == "user_suspended"
        )
        self.assertIn("영구", n["content"])

    def test_suspended_user_can_still_list_and_read_own_notifications(self):
        report_id = database.create_report(self.reporter, "user", self.target_user, "기타")
        database.apply_report_action(report_id, self.admin, "suspend_user")

        notifications = database.list_notifications_by_user(self.target_user)
        self.assertGreaterEqual(len(notifications), 1)
        # must not raise despite the user being suspended -- notification
        # read access is never gated by suspension status
        database.mark_notification_as_read(notifications[0]["id"], self.target_user)
        self.assertEqual(database.get_notification(notifications[0]["id"])["is_read"], 1)

    # ---------- mark_message_notifications_as_read_for_chat_room ----------

    def test_entering_chat_room_marks_message_notifications_read(self):
        match_id = database.create_match(self.lost_id, self.found_id, 0.9, self.target_user)
        room = database.get_or_create_chat_room(match_id, self.target_user)
        database.mark_all_notifications_as_read(self.reporter)

        database.send_message(room["id"], self.target_user, "메시지")
        self.assertEqual(database.count_unread_notifications(self.reporter), 1)

        database.mark_messages_as_read(room["id"], self.reporter)
        database.mark_message_notifications_as_read_for_chat_room(room["id"], self.reporter)
        self.assertEqual(database.count_unread_notifications(self.reporter), 0)

    def test_entering_chat_room_does_not_affect_other_rooms_notifications(self):
        match_id = database.create_match(self.lost_id, self.found_id, 0.9, self.target_user)
        room = database.get_or_create_chat_room(match_id, self.target_user)

        other_lost = database.create_lost_post(
            self.admin, "다른 분실물", "설명", "기타", "장소", "2026-08-26 09:00"
        )
        other_match = database.create_match(other_lost, self.found_id, 0.5, self.reporter)
        other_room = database.get_or_create_chat_room(other_match, self.reporter)
        database.mark_all_notifications_as_read(self.reporter)

        database.send_message(other_room["id"], self.admin, "다른 방 메시지")
        self.assertEqual(database.count_unread_notifications(self.reporter), 1)

        database.mark_message_notifications_as_read_for_chat_room(room["id"], self.reporter)
        self.assertEqual(database.count_unread_notifications(self.reporter), 1)  # unaffected

    def test_mark_message_notifications_requires_participant(self):
        match_id = database.create_match(self.lost_id, self.found_id, 0.9, self.target_user)
        room = database.get_or_create_chat_room(match_id, self.target_user)
        with self.assertRaises(database.PermissionDeniedError):
            database.mark_message_notifications_as_read_for_chat_room(room["id"], self.admin)


class NotificationMigrationTestCase(unittest.TestCase):
    """Notification is a brand-new table -- CREATE TABLE IF NOT EXISTS is
    enough for both a fresh DB and a pre-existing one, but this verifies
    init_db() actually creates it on top of real pre-existing data (built
    against the previous step's full schema) without disturbing anything,
    and that running init_db() twice is safe."""

    def setUp(self):
        self._tmp_dir = tempfile.TemporaryDirectory()
        self._orig_db_path = database.DB_PATH
        database.DB_PATH = Path(self._tmp_dir.name) / "pre_notification.db"

        # Build a DB using the previous step's full schema (everything up
        # to and including ModerationAction, but no Notification table).
        database.init_db()
        with database.get_connection() as conn:
            conn.execute("DROP TABLE Notification")
        self.uid = database.create_user("existing@mju.ac.kr", "기존사용자")
        database.set_initial_nickname(self.uid, "기존닉")
        self.lost_id = database.create_lost_post(
            self.uid, "기존 게시물", "설명", "기타", "장소", "2026-08-20 10:00"
        )

    def tearDown(self):
        database.DB_PATH = self._orig_db_path
        self._tmp_dir.cleanup()

    def test_init_db_creates_notification_table(self):
        database.init_db()
        with database.get_connection() as conn:
            table = conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='Notification'"
            ).fetchone()
        self.assertIsNotNone(table)

    def test_init_db_preserves_existing_data(self):
        database.init_db()
        self.assertIsNotNone(database.get_user_by_id(self.uid))
        self.assertIsNotNone(database.get_lost_post(self.lost_id))

    def test_notification_api_works_after_table_created(self):
        database.init_db()
        nid = database.create_notification(self.uid, "match", "제목", "내용", related_type="match", related_id=1)
        self.assertIsNotNone(database.get_notification(nid))

    def test_init_db_is_idempotent(self):
        database.init_db()
        database.init_db()  # second run must be a no-op, not an error
        with database.get_connection() as conn:
            count = conn.execute(
                "SELECT COUNT(*) c FROM sqlite_master WHERE type='table' AND name='Notification'"
            ).fetchone()["c"]
        self.assertEqual(count, 1)
        self.assertIsNotNone(database.get_user_by_id(self.uid))


class MessagePaginationTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp_dir = tempfile.TemporaryDirectory()
        self._orig_db_path = database.DB_PATH
        database.DB_PATH = Path(self._tmp_dir.name) / "test_message_pagination.db"
        database.init_db()

        self.lost_owner = database.create_user("lostowner@mju.ac.kr", "분실자실명")
        self.found_owner = database.create_user("foundowner@mju.ac.kr", "습득자실명")
        self.stranger = database.create_user("stranger@mju.ac.kr", "제3자실명")
        self.admin = database.create_user("admin@mju.ac.kr", "관리자실명")
        database.set_initial_nickname(self.lost_owner, "분실자")
        database.set_initial_nickname(self.found_owner, "습득자")
        database.set_initial_nickname(self.stranger, "제3자")
        database.set_initial_nickname(self.admin, "관리자닉")
        with database.get_connection() as conn:
            conn.execute("UPDATE User SET is_admin = 1 WHERE id = ?", (self.admin,))

        self.lost_id = database.create_lost_post(
            self.lost_owner, "검은색 에어팟", "설명", "전자기기", "도서관", "2026-08-25 15:00"
        )
        self.found_id = database.create_found_post(
            self.found_owner, "검은색 무선 이어폰", "설명", "전자기기", "도서관", "2026-08-25 16:00"
        )
        self.match_id = database.create_match(self.lost_id, self.found_id, 0.9, self.lost_owner)
        self.room = database.get_or_create_chat_room(self.match_id, self.lost_owner)

    def tearDown(self):
        database.DB_PATH = self._orig_db_path
        self._tmp_dir.cleanup()

    # ---------- helpers ----------

    def _insert_messages(self, count: int, created_at: str | None = None) -> list[int]:
        """Bulk-insert `count` messages directly (bypassing send_message()'s
        notification overhead, irrelevant to pagination correctness) --
        alternating sender so both participants appear, in strictly
        increasing id order. If created_at is given, every row shares that
        exact timestamp (used to test the id tiebreaker)."""
        ids = []
        with database.get_connection() as conn:
            for i in range(count):
                sender = self.lost_owner if i % 2 == 0 else self.found_owner
                if created_at is not None:
                    cursor = conn.execute(
                        "INSERT INTO Message (chat_room_id, sender_user_id, content, created_at) "
                        "VALUES (?, ?, ?, ?)",
                        (self.room["id"], sender, f"메시지{i}", created_at),
                    )
                else:
                    cursor = conn.execute(
                        "INSERT INTO Message (chat_room_id, sender_user_id, content) VALUES (?, ?, ?)",
                        (self.room["id"], sender, f"메시지{i}"),
                    )
                ids.append(cursor.lastrowid)
        return ids

    # ---------- basic counts ----------

    def test_empty_chat_room(self):
        self.assertEqual(database.list_messages(self.room["id"], self.lost_owner), [])

    def test_single_message(self):
        self._insert_messages(1)
        messages = database.list_messages(self.room["id"], self.lost_owner)
        self.assertEqual(len(messages), 1)
        self.assertEqual(messages[0]["content"], "메시지0")

    def test_exactly_page_size_messages(self):
        ids = self._insert_messages(database.MESSAGE_PAGE_SIZE)
        messages = database.list_messages(self.room["id"], self.lost_owner)
        self.assertEqual(len(messages), database.MESSAGE_PAGE_SIZE)
        self.assertEqual([m["id"] for m in messages], ids)  # oldest-first, none missing

    def test_page_size_plus_one_messages(self):
        ids = self._insert_messages(database.MESSAGE_PAGE_SIZE + 1)
        messages = database.list_messages(self.room["id"], self.lost_owner)
        self.assertEqual(len(messages), database.MESSAGE_PAGE_SIZE)
        # default call (no before_id) returns the *newest* page_size messages
        self.assertEqual([m["id"] for m in messages], ids[1:])

    def test_full_pagination_walk_101_messages(self):
        """The scenario called out explicitly: 101 messages, walked back
        page by page (50 + 50 + 1), must total exactly 101 with zero
        duplicates and zero gaps."""
        ids = self._insert_messages(101)

        page1 = database.list_messages(self.room["id"], self.lost_owner, limit=database.MESSAGE_PAGE_SIZE + 1)
        has_more1 = len(page1) > database.MESSAGE_PAGE_SIZE
        page1 = page1[-database.MESSAGE_PAGE_SIZE:] if has_more1 else page1
        self.assertTrue(has_more1)
        self.assertEqual(len(page1), 50)

        page2 = database.list_messages(
            self.room["id"], self.lost_owner,
            limit=database.MESSAGE_PAGE_SIZE + 1, before_id=page1[0]["id"],
        )
        has_more2 = len(page2) > database.MESSAGE_PAGE_SIZE
        page2 = page2[-database.MESSAGE_PAGE_SIZE:] if has_more2 else page2
        self.assertTrue(has_more2)
        self.assertEqual(len(page2), 50)

        page3 = database.list_messages(
            self.room["id"], self.lost_owner,
            limit=database.MESSAGE_PAGE_SIZE + 1, before_id=page2[0]["id"],
        )
        has_more3 = len(page3) > database.MESSAGE_PAGE_SIZE
        self.assertFalse(has_more3)
        self.assertEqual(len(page3), 1)

        all_ids = [m["id"] for m in page3] + [m["id"] for m in page2] + [m["id"] for m in page1]
        self.assertEqual(all_ids, ids)  # exact order, no dup, no gap
        self.assertEqual(len(set(all_ids)), 101)

    def test_full_pagination_walk_100_messages(self):
        ids = self._insert_messages(100)

        page1 = database.list_messages(self.room["id"], self.lost_owner, limit=database.MESSAGE_PAGE_SIZE + 1)
        has_more1 = len(page1) > database.MESSAGE_PAGE_SIZE
        page1 = page1[-database.MESSAGE_PAGE_SIZE:] if has_more1 else page1
        self.assertTrue(has_more1)

        page2 = database.list_messages(
            self.room["id"], self.lost_owner,
            limit=database.MESSAGE_PAGE_SIZE + 1, before_id=page1[0]["id"],
        )
        has_more2 = len(page2) > database.MESSAGE_PAGE_SIZE
        self.assertFalse(has_more2)
        self.assertEqual(len(page2), 50)

        all_ids = [m["id"] for m in page2] + [m["id"] for m in page1]
        self.assertEqual(all_ids, ids)
        self.assertEqual(len(set(all_ids)), 100)

    # ---------- limit ----------

    def test_default_limit_is_message_page_size(self):
        self._insert_messages(database.MESSAGE_PAGE_SIZE + 20)
        self.assertEqual(len(database.list_messages(self.room["id"], self.lost_owner)), database.MESSAGE_PAGE_SIZE)

    def test_custom_limit_respected(self):
        self._insert_messages(30)
        messages = database.list_messages(self.room["id"], self.lost_owner, limit=10)
        self.assertEqual(len(messages), 10)

    # ---------- before_id ----------

    def test_no_before_id_returns_latest(self):
        ids = self._insert_messages(5)
        messages = database.list_messages(self.room["id"], self.lost_owner, limit=3)
        self.assertEqual([m["id"] for m in messages], ids[-3:])

    def test_before_id_returns_older_page(self):
        ids = self._insert_messages(10)
        older = database.list_messages(self.room["id"], self.lost_owner, limit=3, before_id=ids[7])
        self.assertEqual([m["id"] for m in older], ids[4:7])

    def test_no_overlap_between_consecutive_pages(self):
        ids = self._insert_messages(20)
        page1 = database.list_messages(self.room["id"], self.lost_owner, limit=10)
        page2 = database.list_messages(self.room["id"], self.lost_owner, limit=10, before_id=page1[0]["id"])
        self.assertEqual(set(m["id"] for m in page1) & set(m["id"] for m in page2), set())
        self.assertEqual([m["id"] for m in page2] + [m["id"] for m in page1], ids)

    def test_no_gap_between_consecutive_pages(self):
        ids = self._insert_messages(17)
        page1 = database.list_messages(self.room["id"], self.lost_owner, limit=10)
        page2 = database.list_messages(self.room["id"], self.lost_owner, limit=10, before_id=page1[0]["id"])
        combined = [m["id"] for m in page2] + [m["id"] for m in page1]
        self.assertEqual(combined, ids)

    # ---------- ordering / tiebreaker ----------

    def test_same_timestamp_messages_ordered_by_id(self):
        ids = self._insert_messages(5, created_at="2026-08-27 12:00:00")
        messages = database.list_messages(self.room["id"], self.lost_owner)
        self.assertEqual([m["id"] for m in messages], ids)
        self.assertEqual([m["created_at"] for m in messages], ["2026-08-27 12:00:00"] * 5)

    def test_id_tiebreaker_holds_across_pagination_boundary(self):
        ids = self._insert_messages(6, created_at="2026-08-27 12:00:00")
        page1 = database.list_messages(self.room["id"], self.lost_owner, limit=3)
        page2 = database.list_messages(self.room["id"], self.lost_owner, limit=3, before_id=page1[0]["id"])
        self.assertEqual([m["id"] for m in page2] + [m["id"] for m in page1], ids)

    # ---------- has_more determination (limit+1 pattern, exercised by callers) ----------

    def test_has_more_false_at_oldest_page(self):
        ids = self._insert_messages(3)
        page = database.list_messages(self.room["id"], self.lost_owner, limit=database.MESSAGE_PAGE_SIZE + 1)
        self.assertFalse(len(page) > database.MESSAGE_PAGE_SIZE)

    def test_has_more_true_when_older_page_exists(self):
        self._insert_messages(database.MESSAGE_PAGE_SIZE + 5)
        page = database.list_messages(self.room["id"], self.lost_owner, limit=database.MESSAGE_PAGE_SIZE + 1)
        self.assertTrue(len(page) > database.MESSAGE_PAGE_SIZE)

    # ---------- room isolation ----------

    def test_other_chat_room_messages_not_mixed_in(self):
        self._insert_messages(3)
        other_lost = database.create_lost_post(
            self.stranger, "다른 분실물", "설명", "기타", "장소", "2026-08-26 09:00"
        )
        other_match = database.create_match(other_lost, self.found_id, 0.5, self.stranger)
        other_room = database.get_or_create_chat_room(other_match, self.stranger)
        database.send_message(other_room["id"], self.stranger, "다른 방 메시지")

        messages = database.list_messages(self.room["id"], self.lost_owner)
        self.assertEqual(len(messages), 3)
        self.assertTrue(all(m["chat_room_id"] == self.room["id"] for m in messages))

    # ---------- permission ----------

    def test_stranger_blocked_from_list_messages(self):
        self._insert_messages(2)
        with self.assertRaises(database.PermissionDeniedError):
            database.list_messages(self.room["id"], self.stranger)

    def test_third_party_direct_call_with_own_user_id_and_others_room_blocked(self):
        """Simulates a UI-bypassing caller passing someone else's
        chat_room_id with their own (valid) user_id -- must still be
        rejected by get_chat_room()'s participant check inside
        list_messages(), not merely by hiding the UI."""
        self._insert_messages(2)
        with self.assertRaises(database.PermissionDeniedError):
            database.list_messages(self.room["id"], self.stranger, limit=10, before_id=None)

    def test_invalid_chat_room_id_raises_value_error(self):
        with self.assertRaises(ValueError):
            database.list_messages(99999, self.lost_owner)

    # ---------- hidden message masking ----------

    def test_hidden_message_masked_across_pagination(self):
        ids = self._insert_messages(database.MESSAGE_PAGE_SIZE + 5)
        hidden_id = ids[0]  # will end up on the *older* page
        report_id = database.create_report(self.found_owner, "message", hidden_id, "욕설/비방")
        database.apply_report_action(report_id, self.admin, "hide_message")

        latest = database.list_messages(self.room["id"], self.lost_owner, limit=database.MESSAGE_PAGE_SIZE + 1)
        older = database.list_messages(
            self.room["id"], self.lost_owner,
            limit=database.MESSAGE_PAGE_SIZE + 1, before_id=latest[0]["id"],
        )
        hidden_row = next(m for m in older if m["id"] == hidden_id)
        self.assertEqual(hidden_row["content"], database.HIDDEN_MESSAGE_PLACEHOLDER)

    def test_admin_still_sees_original_content_of_hidden_message(self):
        """Regression: pagination must not affect the admin report-review
        path, which reads Message.content directly (not via
        list_messages())."""
        msg_id = self._insert_messages(1)[0]
        report_id = database.create_report(self.found_owner, "message", msg_id, "욕설/비방")
        database.apply_report_action(report_id, self.admin, "hide_message")

        reports = database.list_reports_for_admin(self.admin, target_type="message")
        r = next(x for x in reports if x["id"] == report_id)
        self.assertEqual(r["target_info"]["content"], "메시지0")

    # ---------- read_at / sender_nickname preserved ----------

    def test_read_at_preserved_across_pagination(self):
        self._insert_messages(3)
        database.mark_messages_as_read(self.room["id"], self.found_owner)
        messages = database.list_messages(self.room["id"], self.found_owner)
        # lost_owner's messages (indices 0, 2) were read by found_owner
        self.assertIsNotNone(messages[0]["read_at"])

    def test_sender_nickname_present_and_correct(self):
        self._insert_messages(2)
        messages = database.list_messages(self.room["id"], self.lost_owner)
        self.assertEqual(messages[0]["sender_nickname"], "분실자")
        self.assertEqual(messages[1]["sender_nickname"], "습득자")

    # ---------- invalid limit / before_id ----------

    def test_zero_or_negative_limit_rejected(self):
        with self.assertRaises(ValueError):
            database.list_messages(self.room["id"], self.lost_owner, limit=0)
        with self.assertRaises(ValueError):
            database.list_messages(self.room["id"], self.lost_owner, limit=-5)

    def test_non_integer_limit_rejected(self):
        with self.assertRaises(ValueError):
            database.list_messages(self.room["id"], self.lost_owner, limit="50")
        with self.assertRaises(ValueError):
            database.list_messages(self.room["id"], self.lost_owner, limit=True)

    def test_zero_or_negative_before_id_rejected(self):
        with self.assertRaises(ValueError):
            database.list_messages(self.room["id"], self.lost_owner, before_id=0)
        with self.assertRaises(ValueError):
            database.list_messages(self.room["id"], self.lost_owner, before_id=-1)

    def test_non_integer_before_id_rejected(self):
        with self.assertRaises(ValueError):
            database.list_messages(self.room["id"], self.lost_owner, before_id="10")

    def test_before_id_beyond_all_messages_returns_empty(self):
        ids = self._insert_messages(3)
        messages = database.list_messages(self.room["id"], self.lost_owner, before_id=ids[0])
        self.assertEqual(messages, [])

    # ---------- backward-compatible call shape ----------

    def test_call_with_only_required_args_still_works(self):
        """The pre-pagination call shape list_messages(room_id, user_id)
        still works and behaves identically for a room with <=
        MESSAGE_PAGE_SIZE messages."""
        self._insert_messages(5)
        messages = database.list_messages(self.room["id"], self.lost_owner)
        self.assertEqual(len(messages), 5)


class LazyAutoInitTestCase(unittest.TestCase):
    """Reproduces the real Streamlit Cloud deployment bug: a completely
    fresh checkout has no db/lost_found.db file at all (it's gitignored,
    never committed), and nothing in app.py/pages/*.py ever called
    init_db() -- only tests (in setUp()) and `python db/database.py` (run
    manually, once, by a developer) did. On a first-ever deploy there's no
    such manual bootstrap step, so the very first query used to fail with
    "sqlite3.OperationalError: no such table: User".

    These tests deliberately do NOT call database.init_db() themselves --
    that's the whole point: they only point DB_PATH at a nonexistent file
    and immediately call a normal query function, exactly like a fresh
    Streamlit Cloud worker's first request would.
    """

    def setUp(self):
        self._tmp_dir = tempfile.TemporaryDirectory()
        self._orig_db_path = database.DB_PATH
        self._orig_db_ready = database._db_ready
        database.DB_PATH = Path(self._tmp_dir.name) / "never_initialized.db"
        database._db_ready = False  # simulate a fresh process, not a reused one
        # deliberately no database.init_db() call here

    def tearDown(self):
        database.DB_PATH = self._orig_db_path
        database._db_ready = self._orig_db_ready
        self._tmp_dir.cleanup()

    def test_query_on_never_initialized_db_no_longer_raises(self):
        """This is the exact call chain from the crash report:
        auth.current_user() -> current_user_id() -> resolve_user_id() ->
        db.get_user_by_email() -- reproduced directly at the DB layer."""
        self.assertFalse(self._tmp_dir.name and Path(database.DB_PATH).exists())
        result = database.get_user_by_email("student@mju.ac.kr")  # must not raise
        self.assertIsNone(result)  # no such user yet, but no OperationalError

    def test_write_on_never_initialized_db_also_works(self):
        user_id = database.create_user("fresh@mju.ac.kr", "새사용자")
        self.assertIsNotNone(database.get_user_by_id(user_id))

    def test_db_file_and_tables_are_created_on_first_use(self):
        self.assertFalse(Path(database.DB_PATH).exists())
        database.get_user_by_email("anyone@mju.ac.kr")
        self.assertTrue(Path(database.DB_PATH).exists())
        with database.get_connection() as conn:
            tables = {
                row["name"] for row in conn.execute(
                    "SELECT name FROM sqlite_master WHERE type='table'"
                ).fetchall()
            }
        self.assertIn("User", tables)
        self.assertIn("LostPost", tables)
        self.assertIn("Notification", tables)  # newest table -- migrations ran too

    def test_lazy_init_only_runs_once_per_process(self):
        """Second and later get_connection() calls must not re-run
        init_db() (which would re-read/re-execute schema.sql every query --
        wasteful, though harmless since it's idempotent)."""
        database.get_user_by_email("first@mju.ac.kr")  # triggers lazy init
        self.assertTrue(database._db_ready)
        with patch.object(database, "init_db") as mock_init:
            database.get_user_by_email("second@mju.ac.kr")
            mock_init.assert_not_called()

    def test_explicit_init_db_in_setup_still_works_as_before(self):
        """The existing test pattern (explicit database.init_db() in
        setUp(), used by every other test class in this file) must be
        completely unaffected by the new lazy path."""
        database.init_db()
        user_id = database.create_user("explicit@mju.ac.kr", "명시적초기화")
        self.assertIsNotNone(database.get_user_by_id(user_id))


class DirectChatTestCase(unittest.TestCase):
    """get_or_create_direct_chat_room() -- author-DM chat rooms that aren't
    mediated by a Match, started straight from a board post's detail view."""

    def setUp(self):
        self._tmp_dir = tempfile.TemporaryDirectory()
        self._orig_db_path = database.DB_PATH
        database.DB_PATH = Path(self._tmp_dir.name) / "test_direct_chat.db"
        database.init_db()

        self.author = database.create_user("author@mju.ac.kr", "작성자실명")
        self.viewer = database.create_user("viewer@mju.ac.kr", "조회자실명")
        self.stranger = database.create_user("stranger@mju.ac.kr", "제3자실명")
        database.set_initial_nickname(self.author, "작성자닉")
        database.set_initial_nickname(self.viewer, "조회자닉")
        database.set_initial_nickname(self.stranger, "제3자닉")

        self.lost_id = database.create_lost_post(
            self.author, "검은색 에어팟", "설명", "전자기기", "도서관", "2026-08-25 15:00"
        )
        self.found_id = database.create_found_post(
            self.author, "검은색 무선 이어폰", "설명", "전자기기", "도서관", "2026-08-25 16:00"
        )

    def tearDown(self):
        database.DB_PATH = self._orig_db_path
        self._tmp_dir.cleanup()

    # ---------- happy path ----------

    def test_viewer_can_start_direct_chat_with_lost_post_author(self):
        room = database.get_or_create_direct_chat_room("lost", self.lost_id, self.viewer)
        self.assertIsNone(room["match_id"])
        self.assertEqual(room["direct_lost_post_id"], self.lost_id)
        self.assertIsNone(room["direct_found_post_id"])
        self.assertEqual(room["initiator_user_id"], self.viewer)

    def test_viewer_can_start_direct_chat_with_found_post_author(self):
        room = database.get_or_create_direct_chat_room("found", self.found_id, self.viewer)
        self.assertEqual(room["direct_found_post_id"], self.found_id)
        self.assertIsNone(room["direct_lost_post_id"])

    def test_existing_match_based_flow_still_works_unaffected(self):
        """Regression: the original AI-match -> confirm -> chat flow must
        be completely untouched by the new direct-chat code path."""
        match_id = database.create_match(self.lost_id, self.found_id, 0.9, self.author)
        room = database.get_or_create_chat_room(match_id, self.author)
        self.assertEqual(room["match_id"], match_id)
        self.assertIsNone(room["direct_lost_post_id"])
        self.assertIsNone(room["direct_found_post_id"])
        self.assertIsNone(room["initiator_user_id"])

    # ---------- duplicate prevention ----------

    def test_second_call_for_same_post_and_viewer_returns_same_room(self):
        room1 = database.get_or_create_direct_chat_room("lost", self.lost_id, self.viewer)
        room2 = database.get_or_create_direct_chat_room("lost", self.lost_id, self.viewer)
        self.assertEqual(room1["id"], room2["id"])
        with database.get_connection() as conn:
            count = conn.execute(
                "SELECT COUNT(*) c FROM ChatRoom WHERE direct_lost_post_id = ? AND initiator_user_id = ?",
                (self.lost_id, self.viewer),
            ).fetchone()["c"]
        self.assertEqual(count, 1)

    def test_duplicate_prevented_even_via_raw_connection(self):
        """Final backstop: the partial UNIQUE index itself, independent of
        get_or_create_direct_chat_room()'s own pre-check."""
        database.get_or_create_direct_chat_room("lost", self.lost_id, self.viewer)
        with self.assertRaises(sqlite3.IntegrityError):
            with database.get_connection() as conn:
                conn.execute(
                    "INSERT INTO ChatRoom (direct_lost_post_id, initiator_user_id) VALUES (?, ?)",
                    (self.lost_id, self.viewer),
                )

    def test_different_viewers_each_get_their_own_room_for_the_same_post(self):
        room_viewer = database.get_or_create_direct_chat_room("lost", self.lost_id, self.viewer)
        room_stranger = database.get_or_create_direct_chat_room("lost", self.lost_id, self.stranger)
        self.assertNotEqual(room_viewer["id"], room_stranger["id"])

    def test_same_viewer_different_posts_get_different_rooms(self):
        room_lost = database.get_or_create_direct_chat_room("lost", self.lost_id, self.viewer)
        room_found = database.get_or_create_direct_chat_room("found", self.found_id, self.viewer)
        self.assertNotEqual(room_lost["id"], room_found["id"])

    # ---------- self-chat block ----------

    def test_author_cannot_start_direct_chat_with_self_on_lost_post(self):
        with self.assertRaises(database.PermissionDeniedError):
            database.get_or_create_direct_chat_room("lost", self.lost_id, self.author)

    def test_author_cannot_start_direct_chat_with_self_on_found_post(self):
        with self.assertRaises(database.PermissionDeniedError):
            database.get_or_create_direct_chat_room("found", self.found_id, self.author)

    # ---------- unauthorized / malformed input ----------

    def test_nonexistent_user_id_rejected(self):
        with self.assertRaises(ValueError):
            database.get_or_create_direct_chat_room("lost", self.lost_id, 99999)

    def test_nonexistent_post_rejected(self):
        with self.assertRaises(ValueError):
            database.get_or_create_direct_chat_room("lost", 99999, self.viewer)
        with self.assertRaises(ValueError):
            database.get_or_create_direct_chat_room("found", 99999, self.viewer)

    def test_invalid_post_kind_rejected(self):
        with self.assertRaises(ValueError):
            database.get_or_create_direct_chat_room("post", self.lost_id, self.viewer)

    def test_suspended_viewer_cannot_start_direct_chat(self):
        report_id = database.create_report(self.author, "user", self.viewer, "기타")
        admin = database.create_user("admin@mju.ac.kr", "관리자실명")
        database.set_initial_nickname(admin, "관리자닉")
        with database.get_connection() as conn:
            conn.execute("UPDATE User SET is_admin = 1 WHERE id = ?", (admin,))
        database.apply_report_action(report_id, admin, "suspend_user")

        with self.assertRaises(database.PermissionDeniedError):
            database.get_or_create_direct_chat_room("lost", self.lost_id, self.viewer)

    # ---------- once created, the room reuses the existing chat pipeline ----------

    def test_stranger_cannot_access_direct_chat_room_of_others(self):
        room = database.get_or_create_direct_chat_room("lost", self.lost_id, self.viewer)
        with self.assertRaises(database.PermissionDeniedError):
            database.get_chat_room(room["id"], self.stranger)
        with self.assertRaises(database.PermissionDeniedError):
            database.list_messages(room["id"], self.stranger)
        with self.assertRaises(database.PermissionDeniedError):
            database.send_message(room["id"], self.stranger, "몰래 들어온 메시지")

    def test_both_initiator_and_author_can_message_each_other(self):
        room = database.get_or_create_direct_chat_room("lost", self.lost_id, self.viewer)
        database.send_message(room["id"], self.viewer, "이거 제가 찾는 물건 같아요!")
        database.send_message(room["id"], self.author, "네 맞아요, 어디서 보셨나요?")
        messages = database.list_messages(room["id"], self.viewer)
        self.assertEqual(len(messages), 2)
        self.assertEqual(messages[0]["sender_user_id"], self.viewer)
        self.assertEqual(messages[1]["sender_user_id"], self.author)

    def test_message_notification_fires_for_direct_chat_too(self):
        room = database.get_or_create_direct_chat_room("lost", self.lost_id, self.viewer)
        database.send_message(room["id"], self.viewer, "안녕하세요")
        notifications = [
            n for n in database.list_notifications_by_user(self.author) if n["type"] == "message"
        ]
        self.assertEqual(len(notifications), 1)
        self.assertIn("조회자닉", notifications[0]["content"])

    def test_mark_messages_as_read_works_for_direct_chat_room(self):
        room = database.get_or_create_direct_chat_room("lost", self.lost_id, self.viewer)
        database.send_message(room["id"], self.viewer, "안녕하세요")
        updated = database.mark_messages_as_read(room["id"], self.author)
        self.assertEqual(updated, 1)

    def test_hidden_message_masked_in_direct_chat_room_too(self):
        room = database.get_or_create_direct_chat_room("lost", self.lost_id, self.viewer)
        msg = database.send_message(room["id"], self.viewer, "욕설이 담긴 메시지라고 가정")
        report_id = database.create_report(self.author, "message", msg["id"], "욕설/비방")
        admin = database.create_user("admin2@mju.ac.kr", "관리자2실명")
        database.set_initial_nickname(admin, "관리자2닉")
        with database.get_connection() as conn:
            conn.execute("UPDATE User SET is_admin = 1 WHERE id = ?", (admin,))
        database.apply_report_action(report_id, admin, "hide_message")

        messages = database.list_messages(room["id"], self.author)
        self.assertEqual(messages[0]["content"], database.HIDDEN_MESSAGE_PLACEHOLDER)

    def test_post_deletion_cascades_direct_chat_room_and_messages(self):
        room = database.get_or_create_direct_chat_room("lost", self.lost_id, self.viewer)
        msg = database.send_message(room["id"], self.viewer, "안녕하세요")

        database.delete_lost_post(self.lost_id, self.author)

        with database.get_connection() as conn:
            self.assertIsNone(
                conn.execute("SELECT * FROM ChatRoom WHERE id = ?", (room["id"],)).fetchone()
            )
            self.assertIsNone(
                conn.execute("SELECT * FROM Message WHERE id = ?", (msg["id"],)).fetchone()
            )


class ChatRoomDirectChatMigrationTestCase(unittest.TestCase):
    """A DB built against the pre-direct-chat schema (ChatRoom.match_id
    NOT NULL, no direct_* columns), with a real Match-based chat room in
    it, must be migrated in place -- preserving every row -- the first
    time init_db() runs against it."""

    _LEGACY_SCHEMA = """
        PRAGMA foreign_keys = ON;
        CREATE TABLE User (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, nickname TEXT,
            is_admin INTEGER NOT NULL DEFAULT 0,
            is_suspended INTEGER NOT NULL DEFAULT 0,
            suspended_until TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE LostPost (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES User(id),
            title TEXT NOT NULL, description TEXT NOT NULL, category TEXT NOT NULL,
            location TEXT NOT NULL, lost_at TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT '찾는 중' CHECK (status IN ('찾는 중', '찾음')),
            image_url TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE FoundPost (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES User(id),
            title TEXT NOT NULL, description TEXT NOT NULL, category TEXT NOT NULL,
            location TEXT NOT NULL, found_at TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT '보관 중' CHECK (status IN ('보관 중', '완료')),
            image_url TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE Match (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            lost_post_id INTEGER NOT NULL REFERENCES LostPost(id) ON DELETE CASCADE,
            found_post_id INTEGER NOT NULL REFERENCES FoundPost(id) ON DELETE CASCADE,
            score REAL NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
            UNIQUE (lost_post_id, found_post_id)
        );
        CREATE TABLE ChatRoom (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            match_id INTEGER NOT NULL UNIQUE REFERENCES Match(id) ON DELETE CASCADE,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE Message (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_room_id INTEGER NOT NULL REFERENCES ChatRoom(id) ON DELETE CASCADE,
            sender_user_id INTEGER NOT NULL REFERENCES User(id),
            content TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            read_at TEXT,
            hidden_at TEXT,
            hidden_by_user_id INTEGER REFERENCES User(id),
            hidden_reason TEXT
        );
    """

    def setUp(self):
        self._tmp_dir = tempfile.TemporaryDirectory()
        self._orig_db_path = database.DB_PATH
        database.DB_PATH = Path(self._tmp_dir.name) / "legacy_chatroom.db"

        conn = sqlite3.connect(database.DB_PATH)
        conn.executescript(self._LEGACY_SCHEMA)
        conn.execute("INSERT INTO User (email, name, nickname) VALUES ('a@mju.ac.kr', 'A', 'A닉')")
        conn.execute("INSERT INTO User (email, name, nickname) VALUES ('b@mju.ac.kr', 'B', 'B닉')")
        conn.execute(
            "INSERT INTO LostPost (user_id, title, description, category, location, lost_at) "
            "VALUES (1, '기존 분실물', '설명', '기타', '장소', '2026-08-20 10:00')"
        )
        conn.execute(
            "INSERT INTO FoundPost (user_id, title, description, category, location, found_at) "
            "VALUES (2, '기존 습득물', '설명', '기타', '장소', '2026-08-20 11:00')"
        )
        conn.execute("INSERT INTO Match (lost_post_id, found_post_id, score) VALUES (1, 1, 0.9)")
        conn.execute("INSERT INTO ChatRoom (match_id) VALUES (1)")
        conn.execute(
            "INSERT INTO Message (chat_room_id, sender_user_id, content) VALUES (1, 1, '기존 메시지')"
        )
        conn.commit()
        conn.close()

    def tearDown(self):
        database.DB_PATH = self._orig_db_path
        self._tmp_dir.cleanup()

    def test_migration_preserves_existing_chat_room_and_message(self):
        database.init_db()
        room = database.get_chat_room(1, 1)
        self.assertEqual(room["match_id"], 1)
        self.assertIsNone(room["direct_lost_post_id"])
        messages = database.list_messages(1, 1)
        self.assertEqual(len(messages), 1)
        self.assertEqual(messages[0]["content"], "기존 메시지")

    def test_migration_adds_direct_chat_columns(self):
        database.init_db()
        with database.get_connection() as conn:
            columns = [row[1] for row in conn.execute("PRAGMA table_info(ChatRoom)").fetchall()]
        self.assertIn("direct_lost_post_id", columns)
        self.assertIn("direct_found_post_id", columns)
        self.assertIn("initiator_user_id", columns)

    def test_new_direct_chat_works_normally_after_migration(self):
        database.init_db()
        room = database.get_or_create_direct_chat_room("lost", 1, 2)
        self.assertIsNone(room["match_id"])
        database.send_message(room["id"], 2, "마이그레이션 후 새 direct chat")
        self.assertEqual(len(database.list_messages(room["id"], 1)), 1)

    def test_migration_is_idempotent(self):
        database.init_db()
        database.init_db()  # second run must be a no-op, not an error

        with database.get_connection() as conn:
            columns = [row[1] for row in conn.execute("PRAGMA table_info(ChatRoom)").fetchall()]
        self.assertEqual(columns.count("direct_lost_post_id"), 1)

        # data still intact and functional after two migration runs
        self.assertIsNotNone(database.get_chat_room(1, 1))
        self.assertEqual(len(database.list_messages(1, 1)), 1)


if __name__ == "__main__":
    unittest.main()
