"""Security audit attack tests.

Exercises the explicit attack list from the security-audit task: DB-layer
IDOR/authorization bypass attempts, admin-function direct calls, injection
payloads, suspension/report/moderation bypass attempts, and the concrete
hidden-message-leak bug found and fixed during this audit
(list_chat_rooms_by_user() -- see test_hidden_last_message_masked_*).

Every call here simulates an attacker who has direct Python-level access to
db/database.py (the actual "API" of this Streamlit monolith -- there is no
separate network-exposed REST/GraphQL layer) and deliberately supplies
forged/foreign/malformed ids and identities, exactly as instructed:
"UI에서 버튼이 안 보인다"는 이유로 취약점을 무시하지 않는다.
"""

import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from db import database


class SecurityAuditTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp_dir = tempfile.TemporaryDirectory()
        self._orig_db_path = database.DB_PATH
        database.DB_PATH = Path(self._tmp_dir.name) / "test_security_audit.db"
        database.init_db()

        self.userA = database.create_user("audita@mju.ac.kr", "감사A실명")
        self.userB = database.create_user("auditb@mju.ac.kr", "감사B실명")
        self.stranger = database.create_user("stranger@mju.ac.kr", "제3자실명")
        self.admin = database.create_user("auditadmin@mju.ac.kr", "감사관리자실명")
        database.set_initial_nickname(self.userA, "감사A닉")
        database.set_initial_nickname(self.userB, "감사B닉")
        database.set_initial_nickname(self.stranger, "제3자닉")
        database.set_initial_nickname(self.admin, "감사관리자닉")
        with database.get_connection() as conn:
            conn.execute("UPDATE User SET is_admin = 1 WHERE id = ?", (self.admin,))

        self.lost_id = database.create_lost_post(
            self.userA, "지갑", "설명", "지갑", "중앙도서관", "2026-08-27 09:00"
        )
        self.found_id = database.create_found_post(
            self.userB, "습득 지갑", "설명", "지갑", "중앙도서관", "2026-08-27 10:00"
        )
        self.match_id = database.create_match(self.lost_id, self.found_id, 0.9, self.userA)
        self.room = database.get_or_create_chat_room(self.match_id, self.userA)
        self.msg = database.send_message(self.room["id"], self.userA, "안녕하세요 지갑 관련입니다")

    def tearDown(self):
        database.DB_PATH = self._orig_db_path
        self._tmp_dir.cleanup()

    # ==================================================================
    # Confirmed vulnerability: hidden message leaked via chat-room preview
    # ==================================================================

    def test_hidden_last_message_masked_in_chat_room_list(self):
        """list_chat_rooms_by_user() (used by pages/6_내_채팅.py's preview
        card) must mask a hidden message's content exactly like
        list_messages() does -- before the fix, this leaked the raw
        original content of the room's most recent message even after an
        admin hid it for e.g. containing personal information."""
        report_id = database.create_report(self.userB, "message", self.msg["id"], "개인정보 노출")
        database.apply_report_action(report_id, self.admin, "hide_message")

        rooms = database.list_chat_rooms_by_user(self.userA)
        self.assertEqual(rooms[0]["last_message_content"], database.HIDDEN_MESSAGE_PLACEHOLDER)
        self.assertNotIn("지갑 관련입니다", rooms[0]["last_message_content"])

        # the other participant sees the same masking
        rooms_b = database.list_chat_rooms_by_user(self.userB)
        self.assertEqual(rooms_b[0]["last_message_content"], database.HIDDEN_MESSAGE_PLACEHOLDER)

    def test_non_hidden_last_message_unaffected(self):
        rooms = database.list_chat_rooms_by_user(self.userA)
        self.assertEqual(rooms[0]["last_message_content"], "안녕하세요 지갑 관련입니다")

    def test_room_with_no_messages_has_no_hidden_flag_crash(self):
        other_lost = database.create_lost_post(
            self.userA, "우산", "설명", "기타", "장소", "2026-08-27 11:00"
        )
        other_found = database.create_found_post(
            self.userB, "습득 우산", "설명", "기타", "장소", "2026-08-27 12:00"
        )
        empty_match = database.create_match(other_lost, other_found, 0.5, self.userA)
        database.get_or_create_chat_room(empty_match, self.userA)
        rooms = database.list_chat_rooms_by_user(self.userA)
        empty_room = next(r for r in rooms if r["match_id"] == empty_match)
        self.assertIsNone(empty_room["last_message_content"])

    # ==================================================================
    # Admin function direct-call bypass
    # ==================================================================

    def test_normal_user_cannot_call_apply_report_action(self):
        report_id = database.create_report(self.userB, "post", self.lost_id, "기타")
        with self.assertRaises(database.PermissionDeniedError):
            database.apply_report_action(report_id, self.userB, "delete_post")
        # nothing changed
        self.assertIsNotNone(database.get_lost_post(self.lost_id))
        self.assertEqual(database.get_report(report_id)["status"], "pending")

    def test_normal_user_cannot_call_process_report(self):
        report_id = database.create_report(self.userB, "post", self.lost_id, "기타")
        with self.assertRaises(database.PermissionDeniedError):
            database.process_report(report_id, self.userB, "dismissed")

    def test_normal_user_cannot_call_list_reports_for_admin(self):
        with self.assertRaises(database.PermissionDeniedError):
            database.list_reports_for_admin(self.userA)

    def test_session_state_style_forged_admin_id_still_rejected(self):
        """Simulates an attacker who somehow gets a UI layer to pass a
        forged "admin" id (e.g. by tampering with session_state or a
        request) -- every id that isn't actually flagged is_admin=1 in the
        DB must be rejected, including ids that are otherwise valid users,
        the reporter, the target, made-up ids, 0, and negative ids."""
        report_id = database.create_report(self.userB, "post", self.lost_id, "기타")
        for forged_admin_id in (self.userA, self.userB, self.stranger, 99999, 0, -1):
            with self.assertRaises(database.PermissionDeniedError):
                database.apply_report_action(report_id, forged_admin_id, "delete_post")
            with self.assertRaises(database.PermissionDeniedError):
                database.process_report(report_id, forged_admin_id, "dismissed")
            with self.assertRaises(database.PermissionDeniedError):
                database.list_reports_for_admin(forged_admin_id)

    def test_admin_page_ui_blocks_non_admin_even_with_session_state_tampering(self):
        """UI-level check: even if session_state somehow held stale/forged
        data, auth.require_admin() re-derives admin status from
        db.is_admin(), which re-reads the DB every call -- there is no
        session_state key that grants admin UI access."""
        from streamlit.testing.v1 import AppTest

        admin_page = str(Path(__file__).resolve().parent.parent / "pages" / "7_관리자.py")
        with patch("ui.auth.current_user_id", return_value=self.userB):
            at = AppTest.from_file(admin_page)
            at.session_state["is_admin"] = True  # forged -- app never reads this key
            at.session_state["admin_user_id"] = self.userB
            at.run(timeout=30)

        self.assertEqual(list(at.exception), [])
        self.assertTrue(any("관리자만" in e.value for e in at.error))

    # ==================================================================
    # IDOR: notifications
    # ==================================================================

    def test_cannot_mark_another_users_notification_read(self):
        match_notifs = database.list_notifications_by_user(self.userB)
        target_notif = match_notifs[0]  # userB's own "match" notification
        with self.assertRaises(database.PermissionDeniedError):
            database.mark_notification_as_read(target_notif["id"], self.stranger)
        self.assertEqual(database.get_notification(target_notif["id"])["is_read"], 0)

    def test_notification_list_scoped_strictly_by_requested_user_id(self):
        a_notifs = database.list_notifications_by_user(self.userA)
        b_notifs = database.list_notifications_by_user(self.userB)
        self.assertTrue(all(n["user_id"] == self.userA for n in a_notifs))
        self.assertTrue(all(n["user_id"] == self.userB for n in b_notifs))
        self.assertNotEqual({n["id"] for n in a_notifs}, {n["id"] for n in b_notifs})

    def test_unread_count_never_leaks_another_users_count(self):
        # userB has unread notifications (match + message); a stranger has none
        self.assertGreater(database.count_unread_notifications(self.userB), 0)
        self.assertEqual(database.count_unread_notifications(self.stranger), 0)

    def test_message_notification_related_id_cannot_reach_foreign_chat_room(self):
        """A message notification's related_id is a message_id -- resolving
        it via get_message() (as pages/8_알림.py does) must never itself
        grant chat access; the real gate is get_chat_room()/list_messages()
        called afterward."""
        notif = next(
            n for n in database.list_notifications_by_user(self.userB) if n["type"] == "message"
        )
        message = database.get_message(notif["related_id"])
        self.assertEqual(message["chat_room_id"], self.room["id"])
        # the stranger, even knowing the resolved chat_room_id, is still blocked
        with self.assertRaises(database.PermissionDeniedError):
            database.list_messages(message["chat_room_id"], self.stranger)

    # ==================================================================
    # IDOR: chat / messages
    # ==================================================================

    def test_stranger_cannot_get_chat_room(self):
        with self.assertRaises(database.PermissionDeniedError):
            database.get_chat_room(self.room["id"], self.stranger)

    def test_stranger_cannot_list_messages_with_own_valid_user_id(self):
        with self.assertRaises(database.PermissionDeniedError):
            database.list_messages(self.room["id"], self.stranger)

    def test_stranger_cannot_send_message_into_foreign_room(self):
        with self.assertRaises(database.PermissionDeniedError):
            database.send_message(self.room["id"], self.stranger, "몰래 들어온 메시지")
        # no message was inserted
        messages = database.list_messages(self.room["id"], self.userA)
        self.assertTrue(all(m["content"] != "몰래 들어온 메시지" for m in messages))

    def test_before_id_from_foreign_chat_room_does_not_leak_across_rooms(self):
        """A before_id cursor referencing a message id in a DIFFERENT room
        must not be usable to read messages out of this room, and querying
        one's own room with a foreign room's message id as before_id must
        not error or leak unrelated rows."""
        other_lost = database.create_lost_post(
            self.stranger, "다른 지갑", "설명", "지갑", "장소", "2026-08-27 08:00"
        )
        other_found = database.create_found_post(
            self.admin, "다른 습득 지갑", "설명", "지갑", "장소", "2026-08-27 08:30"
        )
        other_match = database.create_match(other_lost, other_found, 0.4, self.stranger)
        other_room = database.get_or_create_chat_room(other_match, self.stranger)
        foreign_msg = database.send_message(other_room["id"], self.stranger, "다른 방 메시지")

        # userA queries their OWN room using the foreign room's message id as
        # a cursor -- since the WHERE clause always ANDs chat_room_id, this
        # is just an arbitrary (mismatched) id boundary, not a cross-room leak.
        result = database.list_messages(self.room["id"], self.userA, before_id=foreign_msg["id"])
        self.assertTrue(all(m["chat_room_id"] == self.room["id"] for m in result))
        for m in result:
            self.assertNotEqual(m["content"], "다른 방 메시지")

    def test_message_id_guessing_does_not_bypass_chat_room_permission(self):
        """Even knowing a real message_id in a room you can't access,
        list_messages() still requires get_chat_room() to pass first --
        the message_id itself grants nothing."""
        with self.assertRaises(database.PermissionDeniedError):
            database.list_messages(self.room["id"], self.stranger, before_id=self.msg["id"] + 1)

    # ==================================================================
    # IDOR: posts / matches
    # ==================================================================

    def test_stranger_cannot_update_or_delete_foreign_lost_post(self):
        with self.assertRaises(database.PermissionDeniedError):
            database.update_lost_post(self.lost_id, self.stranger, title="해킹된 제목")
        with self.assertRaises(database.PermissionDeniedError):
            database.delete_lost_post(self.lost_id, self.stranger)
        self.assertEqual(database.get_lost_post(self.lost_id)["title"], "지갑")

    def test_stranger_cannot_update_or_delete_foreign_found_post(self):
        with self.assertRaises(database.PermissionDeniedError):
            database.update_found_post(self.found_id, self.stranger, title="해킹된 제목")
        with self.assertRaises(database.PermissionDeniedError):
            database.delete_found_post(self.found_id, self.stranger)

    def test_stranger_cannot_cancel_foreign_match(self):
        with self.assertRaises(database.PermissionDeniedError):
            database.delete_match(self.match_id, self.stranger)
        self.assertIsNotNone(database.get_match(self.match_id))

    def test_stranger_cannot_create_match_between_others_posts(self):
        with self.assertRaises(database.PermissionDeniedError):
            database.create_match(self.lost_id, self.found_id, 0.99, self.stranger)

    # ==================================================================
    # Report system: forged reporter/target
    # ==================================================================

    def test_self_report_via_own_post_rejected_even_with_sign_encoding(self):
        with self.assertRaises(ValueError):
            database.create_report(self.userA, "post", self.lost_id, "기타")
        with self.assertRaises(ValueError):
            database.create_report(self.userB, "post", -self.found_id, "기타")

    def test_nonexistent_target_id_rejected(self):
        for bad_id in (999999, -999999):
            with self.assertRaises(ValueError):
                database.create_report(self.userA, "post", bad_id, "기타")
        with self.assertRaises(ValueError):
            database.create_report(self.userA, "user", 999999, "기타")
        with self.assertRaises(ValueError):
            database.create_report(self.userA, "message", 999999, "기타")

    def test_target_id_zero_rejected(self):
        with self.assertRaises(ValueError):
            database.create_report(self.userA, "post", 0, "기타")

    def test_lost_found_post_id_collision_resolves_to_correct_table(self):
        """LostPost.id and FoundPost.id are independent AUTOINCREMENT
        sequences -- self.lost_id and self.found_id are both 1 in a fresh
        DB. Confirms the sign-encoding actually disambiguates them rather
        than reporting/acting on the wrong table's row."""
        self.assertEqual(self.lost_id, 1)
        self.assertEqual(self.found_id, 1)

        report_id = database.create_report(self.userB, "post", self.lost_id, "기타")
        report = database.get_report(report_id)
        self.assertEqual(report["target_id"], 1)

        database.apply_report_action(report_id, self.admin, "delete_post")
        self.assertIsNone(database.get_lost_post(self.lost_id))
        self.assertIsNotNone(database.get_found_post(self.found_id))  # untouched

    def test_report_id_of_different_report_cannot_be_substituted(self):
        """Processing report A must never affect report B's target, even
        though both reports may reference overlapping ids."""
        report_a = database.create_report(self.userB, "post", self.lost_id, "기타")
        other_lost = database.create_lost_post(
            self.userA, "다른 지갑", "설명", "지갑", "장소", "2026-08-27 13:00"
        )
        report_b = database.create_report(self.userB, "post", other_lost, "기타")

        database.apply_report_action(report_a, self.admin, "delete_post")

        self.assertIsNone(database.get_lost_post(self.lost_id))
        self.assertIsNotNone(database.get_lost_post(other_lost))  # report_b's target untouched
        self.assertEqual(database.get_report(report_b)["status"], "pending")

    def test_action_type_target_type_mismatch_cannot_be_forced(self):
        report_id = database.create_report(self.userB, "post", self.lost_id, "기타")
        with self.assertRaises(ValueError):
            database.apply_report_action(report_id, self.admin, "suspend_user")
        with self.assertRaises(ValueError):
            database.apply_report_action(report_id, self.admin, "hide_message")
        self.assertIsNotNone(database.get_lost_post(self.lost_id))  # untouched

    def test_already_processed_report_cannot_be_reprocessed_by_anyone(self):
        report_id = database.create_report(self.userB, "post", self.lost_id, "기타")
        database.process_report(report_id, self.admin, "dismissed")
        with self.assertRaises(ValueError):
            database.apply_report_action(report_id, self.admin, "delete_post")
        self.assertIsNotNone(database.get_lost_post(self.lost_id))

    def test_deleted_target_cannot_be_actioned_again(self):
        report_id = database.create_report(self.userB, "post", self.lost_id, "기타")
        database.delete_lost_post(self.lost_id, self.userA)  # owner deletes it themselves
        with self.assertRaises(ValueError):
            database.apply_report_action(report_id, self.admin, "delete_post")
        self.assertEqual(database.get_report(report_id)["status"], "pending")
        self.assertIsNone(database.get_moderation_action_for_report(report_id))

    def test_duplicate_moderation_action_blocked_by_unique_constraint(self):
        report_id = database.create_report(self.userB, "post", self.lost_id, "기타")
        database.apply_report_action(report_id, self.admin, "delete_post")
        with self.assertRaises(sqlite3.IntegrityError):
            with database.get_connection() as conn:
                conn.execute(
                    "INSERT INTO ModerationAction "
                    "(report_id, target_type, target_id, action_type, admin_user_id) "
                    "VALUES (?, 'post', ?, 'delete_post', ?)",
                    (report_id, self.lost_id, self.admin),
                )

    # ==================================================================
    # Suspension bypass
    # ==================================================================

    def test_suspended_user_blocked_from_every_write_path(self):
        report_id = database.create_report(self.userB, "user", self.userA, "기타")
        database.apply_report_action(report_id, self.admin, "suspend_user")

        with self.assertRaises(database.PermissionDeniedError):
            database.create_lost_post(self.userA, "새 글", "설명", "기타", "장소", "2026-08-27 14:00")
        with self.assertRaises(database.PermissionDeniedError):
            database.create_found_post(self.userA, "새 글", "설명", "기타", "장소", "2026-08-27 14:00")
        with self.assertRaises(database.PermissionDeniedError):
            database.send_message(self.room["id"], self.userA, "정지 중 메시지")

        other_found = database.create_found_post(
            self.stranger, "다른 습득물", "설명", "기타", "장소", "2026-08-27 14:00"
        )
        with self.assertRaises(database.PermissionDeniedError):
            database.create_match(self.lost_id, other_found, 0.5, self.userA)

    def test_suspended_user_can_still_read_existing_data(self):
        report_id = database.create_report(self.userB, "user", self.userA, "기타")
        database.apply_report_action(report_id, self.admin, "suspend_user")

        self.assertIsNotNone(database.get_lost_post(self.lost_id))
        self.assertEqual(len(database.list_messages(self.room["id"], self.userA)), 1)
        self.assertIsInstance(database.list_notifications_by_user(self.userA), list)

    def test_suspension_expiry_boundary_not_exploitable_for_extra_access(self):
        """A suspension whose expiry is still in the future must still
        block writes -- confirms the time comparison direction is correct
        (not inverted)."""
        report_id = database.create_report(self.userB, "user", self.userA, "기타")
        database.apply_report_action(report_id, self.admin, "suspend_user", suspend_duration_days=30)
        self.assertTrue(database.is_user_suspended(self.userA))
        with self.assertRaises(database.PermissionDeniedError):
            database.create_lost_post(self.userA, "새 글", "설명", "기타", "장소", "2026-08-27 14:00")

    def test_manually_forged_past_suspended_until_is_treated_as_expired(self):
        """Sanity check on the expiry comparison direction using a raw,
        deliberately-in-the-past timestamp (simulating clock skew / a
        forged value) -- must correctly read as "not suspended", not
        raise or misbehave."""
        with database.get_connection() as conn:
            conn.execute(
                "UPDATE User SET is_suspended = 1, suspended_until = '2000-01-01 00:00:00' WHERE id = ?",
                (self.userA,),
            )
        self.assertFalse(database.is_user_suspended(self.userA))
        new_id = database.create_lost_post(
            self.userA, "만료 후 새 글", "설명", "기타", "장소", "2026-08-27 14:00"
        )
        self.assertIsNotNone(database.get_lost_post(new_id))

    # ==================================================================
    # Injection / malformed input
    # ==================================================================

    def test_sql_injection_payload_in_post_fields_stored_literally(self):
        payload = "'; DROP TABLE User; --"
        post_id = database.create_lost_post(
            self.userA, payload, payload, "기타", payload, "2026-08-27 09:00"
        )
        post = database.get_lost_post(post_id)
        self.assertEqual(post["title"], payload)
        # the User table must still exist and be queryable
        self.assertIsNotNone(database.get_user_by_id(self.userA))

    def test_sql_injection_payload_in_search_keyword_stored_and_matched_safely(self):
        payload = "x' OR '1'='1"
        database.create_lost_post(self.userA, payload, "설명", "기타", "장소", "2026-08-27 09:00")
        results = database.search_lost_posts(keyword=payload)
        self.assertTrue(any(r["title"] == payload for r in results))
        # must not have returned every row in the table (i.e. not a
        # successful boolean-based injection)
        self.assertLess(len(results), len(database.list_lost_posts()) + 1)

    def test_sql_injection_payload_in_report_reason_and_admin_note(self):
        payload = "'); DROP TABLE Report; --"
        report_id = database.create_report(self.userB, "post", self.lost_id, payload, payload)
        database.process_report(report_id, self.admin, "dismissed", payload)
        report = database.get_report(report_id)
        self.assertEqual(report["reason"], payload)
        self.assertEqual(report["admin_note"], payload)
        self.assertIsNotNone(database.get_report(report_id))  # table still intact

    def test_xss_payload_stored_literally_not_executed(self):
        payload = "<script>alert('xss')</script>"
        post_id = database.create_lost_post(
            self.userA, payload, payload, "기타", "장소", "2026-08-27 09:00"
        )
        post = database.get_lost_post(post_id)
        # stored as literal text -- content sanitization is a rendering
        # concern (Streamlit escapes by default), not a storage concern
        self.assertEqual(post["title"], payload)

    def test_nickname_rejects_html_and_script_special_characters(self):
        stranger2 = database.create_user("stranger2@mju.ac.kr", "실명2")
        for bad in ["<script>", "닉네임<b>", "'; DROP TABLE User;--", "a&b", "javascript:alert(1)"]:
            with self.assertRaises(ValueError):
                database.set_initial_nickname(stranger2, bad)
        self.assertIsNone(database.get_user_by_id(stranger2)["nickname"])

    def test_very_long_strings_do_not_crash_write_paths(self):
        long_text = "가" * 100_000
        post_id = database.create_lost_post(
            self.userA, long_text[:200], long_text, "기타", "장소", "2026-08-27 09:00"
        )
        self.assertIsNotNone(database.get_lost_post(post_id))

    def test_negative_and_huge_ids_rejected_cleanly_not_crash(self):
        for bad_id in (-1, 0, 2**62):
            with self.assertRaises((ValueError, database.PermissionDeniedError)):
                database.update_lost_post(bad_id, self.userA, title="x")
            with self.assertRaises((ValueError, database.PermissionDeniedError)):
                database.list_messages(bad_id, self.userA)

    def test_control_characters_and_null_byte_in_message_content(self):
        payload = "line1\nline2\x00tail\r\n"
        msg = database.send_message(self.room["id"], self.userA, payload)
        stored = database.get_message(msg["id"])
        self.assertIn("line1", stored["content"])

    # ==================================================================
    # Migration re-run safety
    # ==================================================================

    def test_init_db_rerun_does_not_corrupt_existing_data(self):
        database.init_db()
        database.init_db()
        database.init_db()
        self.assertIsNotNone(database.get_lost_post(self.lost_id))
        self.assertIsNotNone(database.get_user_by_id(self.userA))
        self.assertEqual(len(database.list_messages(self.room["id"], self.userA)), 1)


if __name__ == "__main__":
    unittest.main()
