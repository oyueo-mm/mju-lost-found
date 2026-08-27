"""Genuine multi-threaded race-condition tests (not sequential simulation).

Two real threads hit the same DB function concurrently to verify SQLite's
locking + the code's own atomic WHERE-guards/UNIQUE constraints actually
serialize the outcome rather than relying on single-threaded test ordering
to "prove" safety.
"""

import sys
import tempfile
import threading
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from db import database


class RaceConditionTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp_dir = tempfile.TemporaryDirectory()
        self._orig_db_path = database.DB_PATH
        database.DB_PATH = Path(self._tmp_dir.name) / "test_race.db"
        database.init_db()

        self.reporter = database.create_user("racereporter@mju.ac.kr", "레이스신고자")
        self.target = database.create_user("racetarget@mju.ac.kr", "레이스대상")
        self.admin1 = database.create_user("raceadmin1@mju.ac.kr", "레이스관리자1")
        self.admin2 = database.create_user("raceadmin2@mju.ac.kr", "레이스관리자2")
        database.set_initial_nickname(self.reporter, "레이스신고자닉")
        database.set_initial_nickname(self.target, "레이스대상닉")
        database.set_initial_nickname(self.admin1, "레이스관리자1닉")
        database.set_initial_nickname(self.admin2, "레이스관리자2닉")
        with database.get_connection() as conn:
            conn.execute(
                "UPDATE User SET is_admin = 1 WHERE id IN (?, ?)", (self.admin1, self.admin2)
            )

        self.lost_id = database.create_lost_post(
            self.target, "지갑", "설명", "지갑", "장소", "2026-08-27 09:00"
        )
        self.report_id = database.create_report(self.reporter, "post", self.lost_id, "기타")

    def tearDown(self):
        database.DB_PATH = self._orig_db_path
        self._tmp_dir.cleanup()

    def test_two_admins_racing_apply_report_action_only_one_wins(self):
        """Two real threads call apply_report_action() on the same
        pending report at (as close to) the same instant as Python allows.
        Exactly one must succeed; the other must get a clean ValueError,
        never a second ModerationAction and never a crash."""
        barrier = threading.Barrier(2)
        results = {}

        def attempt(name, admin_id):
            barrier.wait()
            try:
                database.apply_report_action(self.report_id, admin_id, "delete_post")
                results[name] = "success"
            except ValueError as e:
                results[name] = f"value_error: {e}"
            except Exception as e:  # noqa: BLE001 -- want to see *any* unexpected crash
                results[name] = f"unexpected: {type(e).__name__}: {e}"

        t1 = threading.Thread(target=attempt, args=("t1", self.admin1))
        t2 = threading.Thread(target=attempt, args=("t2", self.admin2))
        t1.start()
        t2.start()
        t1.join(timeout=10)
        t2.join(timeout=10)

        outcomes = list(results.values())
        successes = [o for o in outcomes if o == "success"]
        failures = [o for o in outcomes if o.startswith("value_error")]
        crashes = [o for o in outcomes if o.startswith("unexpected")]

        self.assertEqual(crashes, [], f"unexpected exception type leaked: {crashes}")
        self.assertEqual(len(successes), 1, f"expected exactly one winner, got: {outcomes}")
        self.assertEqual(len(failures), 1, f"expected exactly one clean rejection, got: {outcomes}")

        # DB state: exactly one ModerationAction, report actioned, post deleted once
        with database.get_connection() as conn:
            count = conn.execute(
                "SELECT COUNT(*) c FROM ModerationAction WHERE report_id = ?", (self.report_id,)
            ).fetchone()["c"]
        self.assertEqual(count, 1)
        self.assertEqual(database.get_report(self.report_id)["status"], "actioned")
        self.assertIsNone(database.get_lost_post(self.lost_id))

    def test_two_racing_process_report_calls_only_one_succeeds(self):
        barrier = threading.Barrier(2)
        results = {}

        def attempt(name, admin_id):
            barrier.wait()
            try:
                database.process_report(self.report_id, admin_id, "dismissed")
                results[name] = "success"
            except ValueError as e:
                results[name] = f"value_error: {e}"
            except Exception as e:  # noqa: BLE001
                results[name] = f"unexpected: {type(e).__name__}: {e}"

        t1 = threading.Thread(target=attempt, args=("t1", self.admin1))
        t2 = threading.Thread(target=attempt, args=("t2", self.admin2))
        t1.start()
        t2.start()
        t1.join(timeout=10)
        t2.join(timeout=10)

        outcomes = list(results.values())
        self.assertEqual([o for o in outcomes if o.startswith("unexpected")], [])
        self.assertEqual(len([o for o in outcomes if o == "success"]), 1)
        self.assertEqual(database.get_report(self.report_id)["status"], "dismissed")

    def test_two_racing_nickname_claims_for_the_same_name_only_one_wins(self):
        userX = database.create_user("racex@mju.ac.kr", "실명X")
        userY = database.create_user("racey@mju.ac.kr", "실명Y")
        barrier = threading.Barrier(2)
        results = {}

        def attempt(name, user_id):
            barrier.wait()
            try:
                database.set_initial_nickname(user_id, "인기닉네임")
                results[name] = "success"
            except ValueError as e:
                results[name] = f"value_error: {e}"
            except Exception as e:  # noqa: BLE001
                results[name] = f"unexpected: {type(e).__name__}: {e}"

        t1 = threading.Thread(target=attempt, args=("t1", userX))
        t2 = threading.Thread(target=attempt, args=("t2", userY))
        t1.start()
        t2.start()
        t1.join(timeout=10)
        t2.join(timeout=10)

        outcomes = list(results.values())
        self.assertEqual([o for o in outcomes if o.startswith("unexpected")], [])
        self.assertEqual(len([o for o in outcomes if o == "success"]), 1)


if __name__ == "__main__":
    unittest.main()
