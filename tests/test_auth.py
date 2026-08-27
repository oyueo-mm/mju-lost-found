import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from db import database
from ui import auth


class IsAllowedDomainTestCase(unittest.TestCase):
    """Pure logic, no Streamlit/DB runtime needed."""

    def test_mju_email_allowed(self):
        self.assertTrue(auth.is_allowed_domain("student@mju.ac.kr"))

    def test_gmail_email_rejected(self):
        self.assertFalse(auth.is_allowed_domain("example@gmail.com"))

    def test_case_insensitive_domain(self):
        self.assertTrue(auth.is_allowed_domain("Student@MJU.AC.KR"))

    def test_lookalike_domain_rejected(self):
        # must not match a domain that merely contains mju.ac.kr as a substring
        self.assertFalse(auth.is_allowed_domain("student@mju.ac.kr.evil.com"))

    def test_none_or_empty_rejected(self):
        self.assertFalse(auth.is_allowed_domain(None))
        self.assertFalse(auth.is_allowed_domain(""))


class ResolveUserIdTestCase(unittest.TestCase):
    """resolve_user_id() talks to the DB, so it gets an isolated temp DB per test."""

    def setUp(self):
        self._tmp_dir = tempfile.TemporaryDirectory()
        self._orig_db_path = database.DB_PATH
        database.DB_PATH = Path(self._tmp_dir.name) / "test_auth.db"
        database.init_db()

    def tearDown(self):
        database.DB_PATH = self._orig_db_path
        self._tmp_dir.cleanup()

    def test_creates_user_on_first_login(self):
        user_id = auth.resolve_user_id("student1@mju.ac.kr", "학생1")
        user = database.get_user_by_id(user_id)
        self.assertEqual(user["email"], "student1@mju.ac.kr")
        self.assertEqual(user["name"], "학생1")

    def test_repeated_login_reuses_same_user_no_duplicate(self):
        first_id = auth.resolve_user_id("student1@mju.ac.kr", "학생1")
        second_id = auth.resolve_user_id("student1@mju.ac.kr", "학생1")
        self.assertEqual(first_id, second_id)
        self.assertEqual(len(database.list_users()), 1)

    def test_falls_back_to_email_prefix_when_name_missing(self):
        user_id = auth.resolve_user_id("student2@mju.ac.kr", "")
        user = database.get_user_by_id(user_id)
        self.assertEqual(user["name"], "student2")


class _NoAuthConfigured:
    """Mimics st.user when [auth] is absent from secrets.toml: any attribute access raises."""

    def __getattr__(self, name):
        raise AttributeError(f'st.user has no attribute "{name}".')


class StreamlitGlueTestCase(unittest.TestCase):
    """Exercises the st.user-facing wrappers with a fake st.user, since real Google OAuth
    cannot be driven in this environment (see report: no live browser / Google credentials)."""

    def setUp(self):
        self._tmp_dir = tempfile.TemporaryDirectory()
        self._orig_db_path = database.DB_PATH
        database.DB_PATH = Path(self._tmp_dir.name) / "test_auth_glue.db"
        database.init_db()

    def tearDown(self):
        database.DB_PATH = self._orig_db_path
        self._tmp_dir.cleanup()

    def test_auth_not_configured(self):
        with patch.object(auth.st, "user", _NoAuthConfigured()):
            self.assertFalse(auth.is_auth_configured())
            self.assertFalse(auth.is_logged_in())
            self.assertFalse(auth.is_authorized())
            self.assertIsNone(auth.current_user_id())

    def test_not_logged_in(self):
        fake_user = SimpleNamespace(is_logged_in=False)
        with patch.object(auth.st, "user", fake_user):
            self.assertTrue(auth.is_auth_configured())
            self.assertFalse(auth.is_logged_in())
            self.assertFalse(auth.is_authorized())
            self.assertIsNone(auth.current_user_id())

    def test_logged_in_non_mju_email_denied(self):
        fake_user = SimpleNamespace(is_logged_in=True, email="someone@gmail.com", name="Someone")
        with patch.object(auth.st, "user", fake_user):
            self.assertFalse(auth.is_authorized())
            self.assertIsNone(auth.current_user_id())
            self.assertEqual(len(database.list_users()), 0)

    def test_logged_in_mju_email_creates_user_and_reuses_on_relogin(self):
        fake_user = SimpleNamespace(is_logged_in=True, email="student3@mju.ac.kr", name="학생3")
        with patch.object(auth.st, "user", fake_user):
            self.assertTrue(auth.is_authorized())
            first_id = auth.current_user_id()
            self.assertIsNotNone(first_id)
            self.assertEqual(len(database.list_users()), 1)

            # simulate logging out and back in with the same account
            second_id = auth.current_user_id()
            self.assertEqual(first_id, second_id)
            self.assertEqual(len(database.list_users()), 1)

    def test_switching_google_account_immediately_switches_identity(self):
        """Security-relevant: current_user_id() must never cache/carry over
        the previous account's id once st.user reflects a different,
        already-authenticated account (e.g. logout of A, login as B in the
        same browser session) -- there is no session_state-based caching in
        current_user_id()/current_user()/is_suspended() to go stale."""
        user_a = SimpleNamespace(is_logged_in=True, email="switcha@mju.ac.kr", name="A실명")
        with patch.object(auth.st, "user", user_a):
            id_a = auth.current_user_id()
            self.assertEqual(auth.current_user()["email"], "switcha@mju.ac.kr")

        # "logout" -- st.user now reflects no session (as real st.logout() would)
        with patch.object(auth.st, "user", SimpleNamespace(is_logged_in=False)):
            self.assertIsNone(auth.current_user_id())
            self.assertIsNone(auth.current_user())

        # "login" as a different account -- same process, same test, no
        # explicit cache-clearing call made anywhere
        user_b = SimpleNamespace(is_logged_in=True, email="switchb@mju.ac.kr", name="B실명")
        with patch.object(auth.st, "user", user_b):
            id_b = auth.current_user_id()
            self.assertNotEqual(id_a, id_b)
            self.assertEqual(auth.current_user()["email"], "switchb@mju.ac.kr")
            self.assertEqual(auth.current_user()["id"], id_b)

        self.assertEqual(len(database.list_users()), 2)


if __name__ == "__main__":
    unittest.main()
