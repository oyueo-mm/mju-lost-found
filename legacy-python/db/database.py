import re
import sqlite3
from contextlib import contextmanager
from pathlib import Path

DB_PATH = Path(__file__).parent / "lost_found.db"
SCHEMA_PATH = Path(__file__).parent / "schema.sql"

LOST_STATUSES = {"찾는 중", "찾음"}
FOUND_STATUSES = {"보관 중", "완료"}

NICKNAME_MIN_LENGTH = 2
NICKNAME_MAX_LENGTH = 20
# Whitelist (not blacklist) on purpose: only Hangul syllables/English
# letters/digits are accepted, so HTML/script-injection characters like
# < > & " ' / are rejected outright rather than needing separate escaping.
_NICKNAME_RE = re.compile(r"^[가-힣a-zA-Z0-9]+$")

SUSPENDED_ACCOUNT_MESSAGE = "정지된 계정은 이 기능을 사용할 수 없습니다."
HIDDEN_MESSAGE_PLACEHOLDER = "[관리자에 의해 숨겨진 메시지입니다.]"
MESSAGE_PAGE_SIZE = 50


class PermissionDeniedError(Exception):
    """Raised when a user tries to modify/delete a post they don't own."""

# YYYY-MM-DD or YYYY-MM-DD HH:MM(:SS)
_DATETIME_RE = re.compile(r"^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}(:\d{2})?)?$")


def _validate_datetime(value: str, field_name: str) -> None:
    if not _DATETIME_RE.match(value):
        raise ValueError(
            f"{field_name} must be in 'YYYY-MM-DD' or 'YYYY-MM-DD HH:MM' format, got: {value!r}"
        )


# Guards the lazy auto-init below -- module-level, so it's per-process (a
# fresh Streamlit Cloud worker starts with this False, a long-running local
# dev process only ever pays the init_db() cost once).
_db_ready = False


def _ensure_db_ready() -> None:
    """Lazily creates/migrates the DB on first real use.

    Every previous entry point (app.py, pages/*.py) assumed db/lost_found.db
    already existed with its tables -- true for local dev only because
    someone had already run `python db/database.py` once, leaving a
    gitignored, never-committed .db file sitting on disk. A fresh checkout
    (e.g. Streamlit Cloud's first deploy) has no such file: sqlite3.connect()
    silently creates an empty one, and the first real query then fails with
    "no such table: User". get_connection() is the one choke point every
    single DB call in this module goes through, so guarding it here fixes
    every entry point at once without touching app.py or any page.

    The flag is set to True *before* calling init_db(), not after -- init_db()
    itself uses get_connection() (for the initial CREATE TABLE script), so
    the flag has to already read "ready" by the time that nested call
    happens, or this would recurse forever. init_db() is idempotent (CREATE
    TABLE IF NOT EXISTS + idempotent migrations, exercised extensively by
    the test suite), so this is safe even in the unlikely event of a race.
    """
    global _db_ready
    if _db_ready:
        return
    _db_ready = True
    init_db()


@contextmanager
def get_connection():
    _ensure_db_ready()
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    with get_connection() as conn:
        conn.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
    _migrate_match_table_add_cascade()
    _migrate_message_table_add_read_at()
    _migrate_user_table_add_nickname()
    _migrate_user_table_add_is_admin()
    _migrate_report_table_add_processing_fields()
    _migrate_user_table_add_suspension()
    _migrate_message_table_add_hidden_fields()
    _migrate_chatroom_table_add_direct_chat()


def _migrate_user_table_add_nickname() -> None:
    """One-time migration for a DB created before User.nickname existed.

    Just a nullable column (ALTER TABLE ADD COLUMN is safe in SQLite, no
    table rebuild needed) plus a UNIQUE index -- existing users end up with
    nickname = NULL, which is exactly the "hasn't set one yet" state the
    app already treats as "show the nickname setup screen".

    A no-op if there's no User table yet (schema.sql's CREATE TABLE IF NOT
    EXISTS already created it with nickname) or the column already exists.
    """
    conn = sqlite3.connect(DB_PATH)
    try:
        columns = [row[1] for row in conn.execute("PRAGMA table_info(User)").fetchall()]
        if not columns:
            return
        if "nickname" not in columns:
            conn.execute("ALTER TABLE User ADD COLUMN nickname TEXT")
            conn.commit()
        conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_user_nickname ON User(nickname)")
        conn.commit()
    finally:
        conn.close()


def _migrate_message_table_add_read_at() -> None:
    """One-time migration for a DB created before Message.read_at existed.

    Unlike the Match FK change, this only adds a nullable column, which
    SQLite's ALTER TABLE ADD COLUMN supports directly (no table rebuild
    needed) and preserves every existing row. Existing messages end up with
    read_at = NULL, i.e. unread -- the correct default for messages that
    predate read tracking.

    A no-op if there's no Message table yet (schema.sql's CREATE TABLE IF
    NOT EXISTS already created it with read_at) or the column already exists.
    """
    conn = sqlite3.connect(DB_PATH)
    try:
        columns = [row[1] for row in conn.execute("PRAGMA table_info(Message)").fetchall()]
        if not columns or "read_at" in columns:
            return
        conn.execute("ALTER TABLE Message ADD COLUMN read_at TEXT")
        conn.commit()
    finally:
        conn.close()


def _migrate_match_table_add_cascade() -> None:
    """One-time migration for a DB created before ON DELETE CASCADE was added
    to Match.lost_post_id/found_post_id.

    SQLite can't ALTER a foreign key constraint in place, so this rebuilds
    the Match table -- preserving every existing row -- following the table
    rebuild procedure documented for SQLite ("Making Other Kinds Of Table
    Schema Changes" in the SQLite docs): disable FK enforcement, rebuild in
    a transaction, verify with foreign_key_check, then re-enable enforcement.

    A no-op (single PRAGMA query) if there's no Match table yet (schema.sql's
    CREATE TABLE IF NOT EXISTS already created it with CASCADE) or it was
    already migrated.
    """
    conn = sqlite3.connect(DB_PATH, isolation_level=None)
    conn.row_factory = sqlite3.Row
    try:
        fk_rows = conn.execute("PRAGMA foreign_key_list(Match)").fetchall()
        if not fk_rows or all(row["on_delete"] == "CASCADE" for row in fk_rows):
            return

        conn.execute("PRAGMA foreign_keys = OFF")
        conn.execute("BEGIN")
        try:
            conn.execute(
                """
                CREATE TABLE Match_new (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    lost_post_id INTEGER NOT NULL REFERENCES LostPost(id) ON DELETE CASCADE,
                    found_post_id INTEGER NOT NULL REFERENCES FoundPost(id) ON DELETE CASCADE,
                    score REAL NOT NULL,
                    created_at TEXT NOT NULL DEFAULT (datetime('now')),
                    UNIQUE (lost_post_id, found_post_id)
                )
                """
            )
            conn.execute(
                """
                INSERT INTO Match_new (id, lost_post_id, found_post_id, score, created_at)
                SELECT id, lost_post_id, found_post_id, score, created_at FROM Match
                """
            )
            conn.execute("DROP TABLE Match")
            conn.execute("ALTER TABLE Match_new RENAME TO Match")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_match_lost_post_id ON Match(lost_post_id)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_match_found_post_id ON Match(found_post_id)")

            fk_problems = conn.execute("PRAGMA foreign_key_check(Match)").fetchall()
            if fk_problems:
                raise sqlite3.IntegrityError(
                    f"Match table migration would violate foreign keys: {fk_problems}"
                )

            conn.execute("COMMIT")
        except Exception:
            conn.execute("ROLLBACK")
            raise
        finally:
            conn.execute("PRAGMA foreign_keys = ON")
    finally:
        conn.close()


def _migrate_user_table_add_is_admin() -> None:
    """One-time migration for a DB created before User.is_admin existed.

    Just a NOT NULL column with a constant DEFAULT (ALTER TABLE ADD COLUMN
    is safe in SQLite, no table rebuild needed) -- existing users end up
    is_admin = 0, i.e. not an admin, which is the correct default for
    accounts that predate the admin system. There's no self-service
    promotion API in this step; granting admin status is a manual DB update
    (e.g. `UPDATE User SET is_admin = 1 WHERE id = ?`).

    A no-op if there's no User table yet (schema.sql's CREATE TABLE IF NOT
    EXISTS already created it with is_admin) or the column already exists.
    """
    conn = sqlite3.connect(DB_PATH)
    try:
        columns = [row[1] for row in conn.execute("PRAGMA table_info(User)").fetchall()]
        if not columns or "is_admin" in columns:
            return
        conn.execute("ALTER TABLE User ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0")
        conn.commit()
    finally:
        conn.close()


def _migrate_report_table_add_processing_fields() -> None:
    """One-time migration for a DB created before Report.status/processed_at/
    processed_by_user_id/admin_note existed.

    Unlike the nickname/read_at migrations, this needs a table rebuild --
    not a plain ALTER TABLE ADD COLUMN -- because status needs a CHECK
    constraint, and SQLite can't attach a CHECK to a column after the fact.
    Follows the same rebuild procedure as _migrate_match_table_add_cascade():
    disable FK enforcement, rebuild in a transaction, verify with
    foreign_key_check, re-enable enforcement. Every existing Report row is
    preserved and ends up status='pending' (processed_at/processed_by_user_id/
    admin_note = NULL), i.e. "not yet reviewed" -- the correct state for
    reports filed before admin review existed.

    A no-op if there's no Report table yet (schema.sql's CREATE TABLE IF NOT
    EXISTS already created it with these columns) or it was already migrated.
    """
    conn = sqlite3.connect(DB_PATH, isolation_level=None)
    conn.row_factory = sqlite3.Row
    try:
        columns = [row[1] for row in conn.execute("PRAGMA table_info(Report)").fetchall()]
        if not columns:
            return  # no Report table yet -- schema.sql's CREATE TABLE will make one with these columns

        if "status" not in columns:
            conn.execute("PRAGMA foreign_keys = OFF")
            conn.execute("BEGIN")
            try:
                conn.execute(
                    """
                    CREATE TABLE Report_new (
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
                    )
                    """
                )
                conn.execute(
                    """
                    INSERT INTO Report_new
                        (id, reporter_user_id, target_type, target_id, reason, detail, created_at)
                    SELECT id, reporter_user_id, target_type, target_id, reason, detail, created_at
                    FROM Report
                    """
                )
                conn.execute("DROP TABLE Report")
                conn.execute("ALTER TABLE Report_new RENAME TO Report")
                conn.execute(
                    "CREATE INDEX IF NOT EXISTS idx_report_reporter_user_id ON Report(reporter_user_id)"
                )

                fk_problems = conn.execute("PRAGMA foreign_key_check(Report)").fetchall()
                if fk_problems:
                    raise sqlite3.IntegrityError(
                        f"Report table migration would violate foreign keys: {fk_problems}"
                    )

                conn.execute("COMMIT")
            except Exception:
                conn.execute("ROLLBACK")
                raise
            finally:
                conn.execute("PRAGMA foreign_keys = ON")

        # Always ensured, whether the table was just rebuilt or already had
        # status (fresh DB via schema.sql never gets a chance to hit the
        # branch above) -- same "outside the if" pattern as
        # _migrate_user_table_add_nickname()'s idx_user_nickname.
        conn.execute("CREATE INDEX IF NOT EXISTS idx_report_status ON Report(status)")
    finally:
        conn.close()


def _migrate_user_table_add_suspension() -> None:
    """One-time migration for a DB created before User.is_suspended/
    suspended_until existed. Both are simple nullable-safe columns (a
    constant-DEFAULT boolean-like int, and a nullable TEXT) so a plain
    ALTER TABLE ADD COLUMN is enough -- no table rebuild needed. Existing
    users end up is_suspended = 0, suspended_until = NULL, i.e. not
    suspended -- the correct default for accounts that predate this system.
    Like is_admin, there's no self-service API for setting these; a
    suspension is applied via apply_report_action() (or, for now, a manual
    DB update) -- never directly by a user.

    A no-op if there's no User table yet (schema.sql's CREATE TABLE IF NOT
    EXISTS already created it with these columns) or they already exist.
    """
    conn = sqlite3.connect(DB_PATH)
    try:
        columns = [row[1] for row in conn.execute("PRAGMA table_info(User)").fetchall()]
        if not columns:
            return
        if "is_suspended" not in columns:
            conn.execute("ALTER TABLE User ADD COLUMN is_suspended INTEGER NOT NULL DEFAULT 0")
            conn.commit()
        if "suspended_until" not in columns:
            conn.execute("ALTER TABLE User ADD COLUMN suspended_until TEXT")
            conn.commit()
    finally:
        conn.close()


def _migrate_message_table_add_hidden_fields() -> None:
    """One-time migration for a DB created before Message.hidden_at/
    hidden_by_user_id/hidden_reason existed. All three are nullable, so
    plain ALTER TABLE ADD COLUMN is enough (same shape as
    _migrate_message_table_add_read_at()). Existing messages end up with
    hidden_at = NULL, i.e. not hidden -- correct for messages that predate
    moderation.

    A no-op if there's no Message table yet (schema.sql's CREATE TABLE IF
    NOT EXISTS already created it with these columns) or they already exist.
    """
    conn = sqlite3.connect(DB_PATH)
    try:
        columns = [row[1] for row in conn.execute("PRAGMA table_info(Message)").fetchall()]
        if not columns or "hidden_at" in columns:
            return
        conn.execute("ALTER TABLE Message ADD COLUMN hidden_at TEXT")
        conn.execute("ALTER TABLE Message ADD COLUMN hidden_by_user_id INTEGER REFERENCES User(id)")
        conn.execute("ALTER TABLE Message ADD COLUMN hidden_reason TEXT")
        conn.commit()
    finally:
        conn.close()


def _migrate_chatroom_table_add_direct_chat() -> None:
    """One-time migration for a DB created before ChatRoom supported
    "direct" (author-DM, not Match-mediated) chat rooms alongside the
    existing Match-based ones.

    Two changes are needed together, so this does one rebuild: (1)
    ChatRoom.match_id must become nullable (a direct room has no Match),
    which SQLite can't do via ALTER TABLE (no DROP NOT NULL) -- this
    follows the same rebuild procedure as _migrate_match_table_add_cascade():
    disable FK enforcement, rebuild in a transaction, verify with
    foreign_key_check, re-enable enforcement; (2) three new nullable
    columns (direct_lost_post_id, direct_found_post_id, initiator_user_id)
    are added in that same rebuild. Every existing (Match-based) ChatRoom
    row is preserved with all three new columns NULL -- exactly the state
    an existing Match-based room should be in.

    A no-op if there's no ChatRoom table yet (schema.sql's CREATE TABLE IF
    NOT EXISTS already creates it correctly) or it was already migrated.
    """
    conn = sqlite3.connect(DB_PATH, isolation_level=None)
    conn.row_factory = sqlite3.Row
    try:
        columns = [row[1] for row in conn.execute("PRAGMA table_info(ChatRoom)").fetchall()]
        if not columns:
            return  # no ChatRoom table yet -- schema.sql's CREATE TABLE will make one with these columns

        if "direct_lost_post_id" not in columns:
            conn.execute("PRAGMA foreign_keys = OFF")
            conn.execute("BEGIN")
            try:
                conn.execute(
                    """
                    CREATE TABLE ChatRoom_new (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        match_id INTEGER UNIQUE REFERENCES Match(id) ON DELETE CASCADE,
                        direct_lost_post_id INTEGER REFERENCES LostPost(id) ON DELETE CASCADE,
                        direct_found_post_id INTEGER REFERENCES FoundPost(id) ON DELETE CASCADE,
                        initiator_user_id INTEGER REFERENCES User(id),
                        created_at TEXT NOT NULL DEFAULT (datetime('now'))
                    )
                    """
                )
                conn.execute(
                    """
                    INSERT INTO ChatRoom_new (id, match_id, created_at)
                    SELECT id, match_id, created_at FROM ChatRoom
                    """
                )
                conn.execute("DROP TABLE ChatRoom")
                conn.execute("ALTER TABLE ChatRoom_new RENAME TO ChatRoom")

                fk_problems = conn.execute("PRAGMA foreign_key_check(ChatRoom)").fetchall()
                if fk_problems:
                    raise sqlite3.IntegrityError(
                        f"ChatRoom table migration would violate foreign keys: {fk_problems}"
                    )

                conn.execute("COMMIT")
            except Exception:
                conn.execute("ROLLBACK")
                raise
            finally:
                conn.execute("PRAGMA foreign_keys = ON")

        # Always ensured, whether the table was just rebuilt or already had
        # the new columns (fresh DB via schema.sql never hits the branch
        # above) -- same "outside the if" pattern as
        # _migrate_user_table_add_nickname()'s idx_user_nickname. Partial
        # indexes (WHERE ... IS NOT NULL) so uniqueness is only enforced
        # among direct rooms -- Match-based rows (both direct_* columns
        # NULL) never participate in either index.
        conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_chatroom_direct_lost_unique "
            "ON ChatRoom(direct_lost_post_id, initiator_user_id) "
            "WHERE direct_lost_post_id IS NOT NULL"
        )
        conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_chatroom_direct_found_unique "
            "ON ChatRoom(direct_found_post_id, initiator_user_id) "
            "WHERE direct_found_post_id IS NOT NULL"
        )
    finally:
        conn.close()


# ---------- User ----------

def create_user(email: str, name: str) -> int:
    with get_connection() as conn:
        cursor = conn.execute(
            "INSERT INTO User (email, name) VALUES (?, ?)",
            (email, name),
        )
        return cursor.lastrowid


def get_user_by_id(user_id: int) -> sqlite3.Row | None:
    with get_connection() as conn:
        return conn.execute(
            "SELECT * FROM User WHERE id = ?", (user_id,)
        ).fetchone()


def get_user_by_email(email: str) -> sqlite3.Row | None:
    with get_connection() as conn:
        return conn.execute(
            "SELECT * FROM User WHERE email = ?", (email,)
        ).fetchone()


def list_users() -> list[sqlite3.Row]:
    with get_connection() as conn:
        return conn.execute(
            "SELECT * FROM User ORDER BY created_at DESC"
        ).fetchall()


def update_user(user_id: int, name: str) -> None:
    with get_connection() as conn:
        conn.execute(
            "UPDATE User SET name = ? WHERE id = ?",
            (name, user_id),
        )


def is_user_suspended(user_id: int) -> bool:
    """Whether user_id is currently under an *active* suspension: permanent
    (suspended_until IS NULL) or timed and not yet expired. Always re-reads
    User.is_suspended/suspended_until from the DB.

    An expired timed suspension is treated as "not suspended" without
    writing back to the row -- the suspension record itself (and any
    ModerationAction that caused it) stays intact for audit purposes; this
    is a read-time computation, not an auto-clear.
    """
    user = get_user_by_id(user_id)
    if user is None or not user["is_suspended"]:
        return False
    if user["suspended_until"] is None:
        return True  # permanent
    with get_connection() as conn:
        row = conn.execute(
            "SELECT ? > datetime('now') AS still_suspended", (user["suspended_until"],)
        ).fetchone()
    return bool(row["still_suspended"])


def _require_not_suspended(user_id: int) -> None:
    """Blocks *new* content/interactions from a suspended user -- viewing
    existing data (list_*/get_* functions) is unaffected, only functions
    that create new rows (create_lost_post, create_found_post, create_match,
    send_message) call this. Raises PermissionDeniedError, same as every
    other permission check in this module, so callers already have an
    except db.PermissionDeniedError branch to handle it."""
    if is_user_suspended(user_id):
        raise PermissionDeniedError(SUSPENDED_ACCOUNT_MESSAGE)


def set_initial_nickname(user_id: int, nickname: str) -> None:
    """Set a user's permanent, public-facing nickname -- exactly once.

    There is deliberately no update_nickname()/rename function: nicknames
    are fixed after this succeeds. Raises ValueError if the user doesn't
    exist, already has a nickname, the new nickname fails validation, or
    it's already taken by someone else.

    The actual "only if still unset" guarantee is enforced by the UPDATE's
    own WHERE clause (atomic against a concurrent call, not just a
    check-then-set race) and backed by the UNIQUE index for duplicates.
    """
    user = get_user_by_id(user_id)
    if user is None:
        raise ValueError(f"User {user_id} not found")
    if user["nickname"] is not None:
        raise ValueError("Nickname is already set and cannot be changed")

    nickname = (nickname or "").strip()
    if not (NICKNAME_MIN_LENGTH <= len(nickname) <= NICKNAME_MAX_LENGTH):
        raise ValueError(
            f"닉네임은 {NICKNAME_MIN_LENGTH}~{NICKNAME_MAX_LENGTH}자여야 합니다."
        )
    if not _NICKNAME_RE.match(nickname):
        raise ValueError("닉네임은 한글/영문/숫자만 사용할 수 있습니다.")

    try:
        with get_connection() as conn:
            cursor = conn.execute(
                "UPDATE User SET nickname = ? WHERE id = ? AND nickname IS NULL",
                (nickname, user_id),
            )
            if cursor.rowcount == 0:
                raise ValueError("Nickname is already set and cannot be changed")
    except sqlite3.IntegrityError:
        raise ValueError("이미 사용 중인 닉네임입니다.")


# ---------- LostPost ----------

def create_lost_post(
    user_id: int,
    title: str,
    description: str,
    category: str,
    location: str,
    lost_at: str,
    image_url: str | None = None,
    status: str = "찾는 중",
) -> int:
    _require_not_suspended(user_id)
    if status not in LOST_STATUSES:
        raise ValueError(f"invalid LostPost status: {status!r}")
    _validate_datetime(lost_at, "lost_at")
    with get_connection() as conn:
        cursor = conn.execute(
            """
            INSERT INTO LostPost
                (user_id, title, description, category, location, lost_at, image_url, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (user_id, title, description, category, location, lost_at, image_url, status),
        )
        return cursor.lastrowid


def get_lost_post(post_id: int) -> sqlite3.Row | None:
    with get_connection() as conn:
        return conn.execute(
            """
            SELECT lp.*, u.nickname AS author_nickname
            FROM LostPost lp
            JOIN User u ON u.id = lp.user_id
            WHERE lp.id = ?
            """,
            (post_id,),
        ).fetchone()


def list_lost_posts(status: str | None = None) -> list[sqlite3.Row]:
    with get_connection() as conn:
        if status:
            return conn.execute(
                """
                SELECT lp.*, u.nickname AS author_nickname
                FROM LostPost lp
                JOIN User u ON u.id = lp.user_id
                WHERE lp.status = ?
                ORDER BY lp.created_at DESC
                """,
                (status,),
            ).fetchall()
        return conn.execute(
            """
            SELECT lp.*, u.nickname AS author_nickname
            FROM LostPost lp
            JOIN User u ON u.id = lp.user_id
            ORDER BY lp.created_at DESC
            """
        ).fetchall()


def list_lost_posts_by_user(user_id: int) -> list[sqlite3.Row]:
    with get_connection() as conn:
        return conn.execute(
            "SELECT * FROM LostPost WHERE user_id = ? ORDER BY created_at DESC",
            (user_id,),
        ).fetchall()


def _check_lost_post_owner(post_id: int, requesting_user_id: int) -> None:
    post = get_lost_post(post_id)
    if post is None:
        raise ValueError(f"LostPost {post_id} not found")
    if post["user_id"] != requesting_user_id:
        raise PermissionDeniedError("You can only modify your own LostPost")


def update_lost_post(post_id: int, requesting_user_id: int, **fields) -> None:
    _check_lost_post_owner(post_id, requesting_user_id)

    allowed = {"title", "description", "category", "location", "lost_at", "image_url", "status"}
    unknown = set(fields) - allowed
    if unknown:
        raise ValueError(f"unknown LostPost field(s): {unknown}")
    if "status" in fields and fields["status"] not in LOST_STATUSES:
        raise ValueError(f"invalid LostPost status: {fields['status']!r}")
    if "lost_at" in fields:
        _validate_datetime(fields["lost_at"], "lost_at")
    if not fields:
        return
    set_clause = ", ".join(f"{col} = ?" for col in fields)
    values = list(fields.values()) + [post_id]
    with get_connection() as conn:
        conn.execute(
            f"UPDATE LostPost SET {set_clause}, updated_at = datetime('now') WHERE id = ?",
            values,
        )


def update_lost_post_status(post_id: int, requesting_user_id: int, status: str) -> None:
    update_lost_post(post_id, requesting_user_id, status=status)


def delete_lost_post(post_id: int, requesting_user_id: int) -> None:
    _check_lost_post_owner(post_id, requesting_user_id)
    with get_connection() as conn:
        conn.execute("DELETE FROM LostPost WHERE id = ?", (post_id,))


def search_lost_posts(
    keyword: str = "", category: str | None = None, status: str | None = None
) -> list[sqlite3.Row]:
    conditions = []
    params: list = []
    if keyword:
        conditions.append("(lp.title LIKE ? OR lp.description LIKE ?)")
        like = f"%{keyword}%"
        params.extend([like, like])
    if category:
        conditions.append("lp.category = ?")
        params.append(category)
    if status:
        conditions.append("lp.status = ?")
        params.append(status)
    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    with get_connection() as conn:
        return conn.execute(
            f"""
            SELECT lp.*, u.nickname AS author_nickname
            FROM LostPost lp
            JOIN User u ON u.id = lp.user_id
            {where}
            ORDER BY lp.created_at DESC
            """,
            params,
        ).fetchall()


# ---------- FoundPost ----------

def create_found_post(
    user_id: int,
    title: str,
    description: str,
    category: str,
    location: str,
    found_at: str,
    image_url: str | None = None,
    status: str = "보관 중",
) -> int:
    _require_not_suspended(user_id)
    if status not in FOUND_STATUSES:
        raise ValueError(f"invalid FoundPost status: {status!r}")
    _validate_datetime(found_at, "found_at")
    with get_connection() as conn:
        cursor = conn.execute(
            """
            INSERT INTO FoundPost
                (user_id, title, description, category, location, found_at, image_url, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (user_id, title, description, category, location, found_at, image_url, status),
        )
        return cursor.lastrowid


def get_found_post(post_id: int) -> sqlite3.Row | None:
    with get_connection() as conn:
        return conn.execute(
            """
            SELECT fp.*, u.nickname AS author_nickname
            FROM FoundPost fp
            JOIN User u ON u.id = fp.user_id
            WHERE fp.id = ?
            """,
            (post_id,),
        ).fetchone()


def list_found_posts(status: str | None = None) -> list[sqlite3.Row]:
    with get_connection() as conn:
        if status:
            return conn.execute(
                """
                SELECT fp.*, u.nickname AS author_nickname
                FROM FoundPost fp
                JOIN User u ON u.id = fp.user_id
                WHERE fp.status = ?
                ORDER BY fp.created_at DESC
                """,
                (status,),
            ).fetchall()
        return conn.execute(
            """
            SELECT fp.*, u.nickname AS author_nickname
            FROM FoundPost fp
            JOIN User u ON u.id = fp.user_id
            ORDER BY fp.created_at DESC
            """
        ).fetchall()


def list_found_posts_by_user(user_id: int) -> list[sqlite3.Row]:
    with get_connection() as conn:
        return conn.execute(
            "SELECT * FROM FoundPost WHERE user_id = ? ORDER BY created_at DESC",
            (user_id,),
        ).fetchall()


def _check_found_post_owner(post_id: int, requesting_user_id: int) -> None:
    post = get_found_post(post_id)
    if post is None:
        raise ValueError(f"FoundPost {post_id} not found")
    if post["user_id"] != requesting_user_id:
        raise PermissionDeniedError("You can only modify your own FoundPost")


def update_found_post(post_id: int, requesting_user_id: int, **fields) -> None:
    _check_found_post_owner(post_id, requesting_user_id)

    allowed = {"title", "description", "category", "location", "found_at", "image_url", "status"}
    unknown = set(fields) - allowed
    if unknown:
        raise ValueError(f"unknown FoundPost field(s): {unknown}")
    if "status" in fields and fields["status"] not in FOUND_STATUSES:
        raise ValueError(f"invalid FoundPost status: {fields['status']!r}")
    if "found_at" in fields:
        _validate_datetime(fields["found_at"], "found_at")
    if not fields:
        return
    set_clause = ", ".join(f"{col} = ?" for col in fields)
    values = list(fields.values()) + [post_id]
    with get_connection() as conn:
        conn.execute(
            f"UPDATE FoundPost SET {set_clause}, updated_at = datetime('now') WHERE id = ?",
            values,
        )


def update_found_post_status(post_id: int, requesting_user_id: int, status: str) -> None:
    update_found_post(post_id, requesting_user_id, status=status)


def delete_found_post(post_id: int, requesting_user_id: int) -> None:
    _check_found_post_owner(post_id, requesting_user_id)
    with get_connection() as conn:
        conn.execute("DELETE FROM FoundPost WHERE id = ?", (post_id,))


def search_found_posts(
    keyword: str = "", category: str | None = None, status: str | None = None
) -> list[sqlite3.Row]:
    conditions = []
    params: list = []
    if keyword:
        conditions.append("(fp.title LIKE ? OR fp.description LIKE ?)")
        like = f"%{keyword}%"
        params.extend([like, like])
    if category:
        conditions.append("fp.category = ?")
        params.append(category)
    if status:
        conditions.append("fp.status = ?")
        params.append(status)
    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
    with get_connection() as conn:
        return conn.execute(
            f"""
            SELECT fp.*, u.nickname AS author_nickname
            FROM FoundPost fp
            JOIN User u ON u.id = fp.user_id
            {where}
            ORDER BY fp.created_at DESC
            """,
            params,
        ).fetchall()


# ---------- Match ----------

def get_match_by_posts(lost_post_id: int, found_post_id: int) -> sqlite3.Row | None:
    with get_connection() as conn:
        return conn.execute(
            "SELECT * FROM Match WHERE lost_post_id = ? AND found_post_id = ?",
            (lost_post_id, found_post_id),
        ).fetchone()


def create_match(
    lost_post_id: int, found_post_id: int, score: float, requesting_user_id: int
) -> int:
    """Get-or-create a Match between a LostPost and a FoundPost.

    requesting_user_id must own the LostPost or the FoundPost (either side
    can confirm a match from their own post) -- raises PermissionDeniedError
    otherwise. Raises ValueError if either post doesn't exist.

    Idempotent: if this lost_post_id/found_post_id pair is already matched,
    returns the existing Match's id instead of creating a duplicate (the
    UNIQUE(lost_post_id, found_post_id) constraint backs this even under a
    concurrent/bypassed call). Notifications are only ever created in the
    "genuinely new match" branch below -- the idempotent early-return never
    re-notifies for a match that already existed.

    On success, every distinct user_id among {LostPost owner, FoundPost
    owner} gets a "match" Notification (one each; if the same user owns
    both posts, that's just one notification) in the same transaction as
    the Match INSERT.
    """
    _require_not_suspended(requesting_user_id)
    lost_post = get_lost_post(lost_post_id)
    if lost_post is None:
        raise ValueError(f"LostPost {lost_post_id} not found")
    found_post = get_found_post(found_post_id)
    if found_post is None:
        raise ValueError(f"FoundPost {found_post_id} not found")
    if requesting_user_id not in (lost_post["user_id"], found_post["user_id"]):
        raise PermissionDeniedError(
            "You can only confirm a match for a LostPost or FoundPost you own"
        )

    existing = get_match_by_posts(lost_post_id, found_post_id)
    if existing is not None:
        return existing["id"]

    try:
        with get_connection() as conn:
            cursor = conn.execute(
                "INSERT INTO Match (lost_post_id, found_post_id, score) VALUES (?, ?, ?)",
                (lost_post_id, found_post_id, score),
            )
            match_id = cursor.lastrowid
            for participant_id in {lost_post["user_id"], found_post["user_id"]}:
                _insert_notification(
                    conn,
                    participant_id,
                    "match",
                    "새로운 매칭이 성립되었습니다",
                    "AI 매칭이 확정되어 채팅을 시작할 수 있습니다.",
                    related_type="match",
                    related_id=match_id,
                )
            return match_id
    except sqlite3.IntegrityError:
        existing = get_match_by_posts(lost_post_id, found_post_id)
        if existing is not None:
            return existing["id"]
        raise


def get_match(match_id: int) -> sqlite3.Row | None:
    with get_connection() as conn:
        return conn.execute(
            "SELECT * FROM Match WHERE id = ?", (match_id,)
        ).fetchone()


def list_matches_for_lost_post(lost_post_id: int) -> list[sqlite3.Row]:
    with get_connection() as conn:
        return conn.execute(
            """
            SELECT * FROM Match
            WHERE lost_post_id = ?
            ORDER BY score DESC
            """,
            (lost_post_id,),
        ).fetchall()


def list_matches_for_found_post(found_post_id: int) -> list[sqlite3.Row]:
    with get_connection() as conn:
        return conn.execute(
            """
            SELECT * FROM Match
            WHERE found_post_id = ?
            ORDER BY score DESC
            """,
            (found_post_id,),
        ).fetchall()


def list_matches_by_user(user_id: int) -> list[sqlite3.Row]:
    """Matches where user_id owns the LostPost and/or the FoundPost side.

    Joins in the related LostPost/FoundPost fields (prefixed lost_*/found_*)
    in a single query, instead of looking each post up separately per match
    (avoids N+1 queries for a match list). Also includes unread_count: how
    many messages the *other* participant sent in this match's chat room
    that user_id hasn't read yet (0 if no chat room exists yet) -- computed
    in the same query rather than one extra query per match.
    """
    with get_connection() as conn:
        return conn.execute(
            """
            SELECT
                m.id AS match_id,
                m.score AS score,
                m.created_at AS match_created_at,
                lp.id AS lost_post_id,
                lp.user_id AS lost_post_user_id,
                lp.title AS lost_title,
                lp.description AS lost_description,
                lp.category AS lost_category,
                lp.location AS lost_location,
                lp.lost_at AS lost_at,
                lp.status AS lost_status,
                lp.image_url AS lost_image_url,
                lu.nickname AS lost_user_nickname,
                fp.id AS found_post_id,
                fp.user_id AS found_post_user_id,
                fp.title AS found_title,
                fp.description AS found_description,
                fp.category AS found_category,
                fp.location AS found_location,
                fp.found_at AS found_at,
                fp.status AS found_status,
                fp.image_url AS found_image_url,
                fu.nickname AS found_user_nickname,
                (
                    SELECT COUNT(*)
                    FROM Message msg
                    JOIN ChatRoom cr ON cr.id = msg.chat_room_id
                    WHERE cr.match_id = m.id
                      AND msg.sender_user_id != ?
                      AND msg.read_at IS NULL
                ) AS unread_count
            FROM Match m
            JOIN LostPost lp ON lp.id = m.lost_post_id
            JOIN FoundPost fp ON fp.id = m.found_post_id
            JOIN User lu ON lu.id = lp.user_id
            JOIN User fu ON fu.id = fp.user_id
            WHERE lp.user_id = ? OR fp.user_id = ?
            ORDER BY m.created_at DESC
            """,
            (user_id, user_id, user_id),
        ).fetchall()


def delete_match(match_id: int, requesting_user_id: int) -> None:
    """Cancel a confirmed match. requesting_user_id must own the LostPost or
    the FoundPost side of it. Only removes the Match row -- never touches
    the LostPost/FoundPost themselves (status included)."""
    match = get_match(match_id)
    if match is None:
        raise ValueError(f"Match {match_id} not found")

    lost_post = get_lost_post(match["lost_post_id"])
    found_post = get_found_post(match["found_post_id"])
    owner_ids = {p["user_id"] for p in (lost_post, found_post) if p is not None}
    if requesting_user_id not in owner_ids:
        raise PermissionDeniedError(
            "You can only cancel a match for a LostPost or FoundPost you own"
        )

    with get_connection() as conn:
        conn.execute("DELETE FROM Match WHERE id = ?", (match_id,))


# ---------- Chat ----------

def _match_participant_ids(match_id: int) -> set[int]:
    """User ids allowed to access match_id's chat: the LostPost owner and
    the FoundPost owner. Raises ValueError if the Match doesn't exist."""
    match = get_match(match_id)
    if match is None:
        raise ValueError(f"Match {match_id} not found")
    lost_post = get_lost_post(match["lost_post_id"])
    found_post = get_found_post(match["found_post_id"])
    return {p["user_id"] for p in (lost_post, found_post) if p is not None}


def _direct_chat_participant_ids(room: sqlite3.Row) -> set[int]:
    """User ids allowed to access a *direct* (non-Match) ChatRoom: the
    initiator (whoever clicked "채팅하기" on the post) plus the post's
    current author, resolved fresh from the post each call -- same
    "derive live, never cache" approach _match_participant_ids() uses for
    Match-based rooms. If the post has since been deleted, only the
    initiator remains (the room itself would normally have cascaded away
    via the FK by that point, but this stays defensive either way)."""
    if room["direct_lost_post_id"] is not None:
        post = get_lost_post(room["direct_lost_post_id"])
    else:
        post = get_found_post(room["direct_found_post_id"])
    ids = {room["initiator_user_id"]}
    if post is not None:
        ids.add(post["user_id"])
    return ids


def _chat_room_participant_ids(room: sqlite3.Row) -> set[int]:
    """Dispatches to the right participant-resolution for either ChatRoom
    shape (Match-based or direct/author-DM) -- the one place every chat
    permission check (get_chat_room, send_message) funnels through, so
    list_messages()/mark_messages_as_read()/etc. -- which all call
    get_chat_room() first -- work unchanged for both kinds of room."""
    if room["match_id"] is not None:
        return _match_participant_ids(room["match_id"])
    return _direct_chat_participant_ids(room)


def _get_chat_room_by_match(match_id: int) -> sqlite3.Row | None:
    with get_connection() as conn:
        return conn.execute(
            "SELECT * FROM ChatRoom WHERE match_id = ?", (match_id,)
        ).fetchone()


def get_or_create_chat_room(match_id: int, requesting_user_id: int) -> sqlite3.Row:
    """Get-or-create the single ChatRoom for a Match.

    requesting_user_id must be a participant of the Match (owner of its
    LostPost or FoundPost) -- raises PermissionDeniedError otherwise.
    Raises ValueError if the Match doesn't exist.

    Idempotent, following the same get-or-create pattern as create_match():
    if the room already exists, return it; otherwise create it, falling
    back to a re-fetch if a concurrent call already won the race (backed by
    ChatRoom.match_id UNIQUE).
    """
    if requesting_user_id not in _match_participant_ids(match_id):
        raise PermissionDeniedError(
            "You can only open a chat room for a Match you're a participant of"
        )

    existing = _get_chat_room_by_match(match_id)
    if existing is not None:
        return existing

    try:
        with get_connection() as conn:
            conn.execute("INSERT INTO ChatRoom (match_id) VALUES (?)", (match_id,))
    except sqlite3.IntegrityError:
        pass  # lost a race to create it -- the re-fetch below picks it up

    room = _get_chat_room_by_match(match_id)
    if room is None:
        raise RuntimeError(f"Failed to create ChatRoom for Match {match_id}")
    return room


def get_or_create_direct_chat_room(
    post_kind: str, post_id: int, requesting_user_id: int
) -> sqlite3.Row:
    """Get-or-create a *direct* ChatRoom between requesting_user_id (the
    initiator/viewer) and a LostPost's or FoundPost's current author --
    NOT mediated by a Match, unlike get_or_create_chat_room(). Lets a
    board viewer message a post's author straight away (e.g. "이거 제
    물건 같아요") without first needing a matching post of their own.

    post_kind must be "lost" or "found" (mirrors Report's target_type
    naming, though unlike Report.target_id this uses a real, unsigned
    post_id plus a real FK column per kind -- no id-collision ambiguity to
    work around here, since direct_lost_post_id/direct_found_post_id are
    separate columns).

    Validation, in order:
    - requesting_user_id must be a real User (ValueError otherwise --
      mirrors create_report()'s "reporter must exist" check)
    - requesting_user_id must not be currently suspended
      (PermissionDeniedError via _require_not_suspended -- same "new
      interaction" gate create_match()/send_message() use)
    - post_kind must be "lost"/"found" and the post must exist (ValueError)
    - requesting_user_id must not be the post's own author -- no
      self-chat (PermissionDeniedError)

    Idempotent: a second call for the same (post, initiator) pair returns
    the existing room instead of creating a duplicate -- backed by a
    partial UNIQUE index (idx_chatroom_direct_lost_unique /
    idx_chatroom_direct_found_unique), the same get-or-create-with-
    IntegrityError-fallback shape get_or_create_chat_room() uses.
    """
    if get_user_by_id(requesting_user_id) is None:
        raise ValueError(f"User {requesting_user_id} not found")

    _require_not_suspended(requesting_user_id)

    if post_kind == "lost":
        post = get_lost_post(post_id)
        column = "direct_lost_post_id"
    elif post_kind == "found":
        post = get_found_post(post_id)
        column = "direct_found_post_id"
    else:
        raise ValueError(f"invalid post_kind: {post_kind!r}")

    if post is None:
        raise ValueError(f"{post_kind} post {post_id} not found")
    if post["user_id"] == requesting_user_id:
        raise PermissionDeniedError("자기 자신의 게시물에는 채팅을 시작할 수 없습니다.")

    with get_connection() as conn:
        existing = conn.execute(
            f"SELECT * FROM ChatRoom WHERE {column} = ? AND initiator_user_id = ?",
            (post_id, requesting_user_id),
        ).fetchone()
    if existing is not None:
        return existing

    try:
        with get_connection() as conn:
            conn.execute(
                f"INSERT INTO ChatRoom ({column}, initiator_user_id) VALUES (?, ?)",
                (post_id, requesting_user_id),
            )
    except sqlite3.IntegrityError:
        pass  # lost a race to create it -- the re-fetch below picks it up

    with get_connection() as conn:
        room = conn.execute(
            f"SELECT * FROM ChatRoom WHERE {column} = ? AND initiator_user_id = ?",
            (post_id, requesting_user_id),
        ).fetchone()
    if room is None:
        raise RuntimeError(f"Failed to create direct ChatRoom for {post_kind} post {post_id}")
    return room


def get_chat_room(chat_room_id: int, requesting_user_id: int) -> sqlite3.Row:
    """Fetch a ChatRoom, but only for a requesting_user_id who is a
    participant -- of its Match (owner of the LostPost or FoundPost side)
    if Match-based, or the initiator/post-author pair if direct.

    Raises ValueError if the ChatRoom doesn't exist, PermissionDeniedError
    if the user isn't a participant.
    """
    with get_connection() as conn:
        room = conn.execute(
            "SELECT * FROM ChatRoom WHERE id = ?", (chat_room_id,)
        ).fetchone()
    if room is None:
        raise ValueError(f"ChatRoom {chat_room_id} not found")

    if requesting_user_id not in _chat_room_participant_ids(room):
        raise PermissionDeniedError(
            "You can only access a chat room you're a participant of"
        )
    return room


def list_messages(
    chat_room_id: int,
    requesting_user_id: int,
    limit: int = MESSAGE_PAGE_SIZE,
    before_id: int | None = None,
) -> list[dict]:
    """Up to `limit` messages in a ChatRoom, oldest-first in the returned
    list (so the caller can render top-to-bottom without re-sorting) --
    with the sender's public nickname joined in (avoids an N+1 User lookup
    per message). Only the nickname is exposed here -- never the sender's
    real name or email.

    Cursor-based pagination, not OFFSET: without before_id, this returns
    the most recent `limit` messages in the room. With before_id, it
    returns the most recent `limit` messages strictly older than that
    message's id (`m.id < before_id`, always combined with the
    chat_room_id filter so a caller can't cross rooms via a raw id). The
    caller re-requests with before_id = the smallest id it has already
    loaded ("the currently oldest-loaded message") to page further back --
    unlike LIMIT/OFFSET, this boundary doesn't shift if new messages arrive
    concurrently. Calling list_messages(chat_room_id, requesting_user_id)
    with no other arguments -- the shape every caller used before
    pagination existed -- still returns the same thing for a room with
    <= MESSAGE_PAGE_SIZE messages, i.e. every existing caller/test.

    Ordering ties: created_at has only second resolution (SQLite
    datetime('now')), so `id DESC` is always the secondary sort key, never
    created_at alone -- messages created in the same second still sort in
    true insertion order via their (AUTOINCREMENT) id.

    To find out whether *older* messages exist beyond this page, callers
    use the same limit+1 lookahead pattern list_reports_for_admin() uses:
    request limit=MESSAGE_PAGE_SIZE + 1 and check whether that many came
    back (see pages/5_채팅.py) -- avoids a separate COUNT(*) query.

    A message an admin has hidden (Message.hidden_at set, via
    apply_report_action()'s "hide_message" action) has its content replaced
    with HIDDEN_MESSAGE_PLACEHOLDER here -- the real content is never
    physically deleted (admins still see it via list_reports_for_admin()'s
    target_info, which reads Message.content directly), but regular chat
    participants never see it again once hidden.

    Raises the same errors as get_chat_room() -- access is checked first --
    plus ValueError for a non-positive limit or before_id.
    """
    get_chat_room(chat_room_id, requesting_user_id)

    if isinstance(limit, bool) or not isinstance(limit, int) or limit <= 0:
        raise ValueError(f"invalid limit: {limit!r}")
    if before_id is not None and (
        isinstance(before_id, bool) or not isinstance(before_id, int) or before_id <= 0
    ):
        raise ValueError(f"invalid before_id: {before_id!r}")

    conditions = ["m.chat_room_id = ?"]
    params: list = [chat_room_id]
    if before_id is not None:
        conditions.append("m.id < ?")
        params.append(before_id)
    params.append(limit)

    with get_connection() as conn:
        rows = conn.execute(
            f"""
            SELECT
                m.id AS id,
                m.chat_room_id AS chat_room_id,
                m.sender_user_id AS sender_user_id,
                m.content AS content,
                m.created_at AS created_at,
                m.read_at AS read_at,
                m.hidden_at AS hidden_at,
                u.nickname AS sender_nickname
            FROM Message m
            JOIN User u ON u.id = m.sender_user_id
            WHERE {' AND '.join(conditions)}
            ORDER BY m.created_at DESC, m.id DESC
            LIMIT ?
            """,
            params,
        ).fetchall()

    results = []
    for row in reversed(rows):  # DB order is newest-first; flip to oldest-first for display
        item = dict(row)
        if item["hidden_at"]:
            item["content"] = HIDDEN_MESSAGE_PLACEHOLDER
        results.append(item)
    return results


def get_message(message_id: int) -> sqlite3.Row | None:
    """Fetch a raw Message row (real content, no hidden-message masking --
    that masking is a list_messages()-only concern for the normal chat UI).
    No permission check here -- this is used to resolve a message id to its
    chat_room_id (e.g. for notification click-routing), and the caller is
    always expected to re-verify actual access via get_chat_room()/
    list_messages() before showing anything derived from the result."""
    with get_connection() as conn:
        return conn.execute("SELECT * FROM Message WHERE id = ?", (message_id,)).fetchone()


def send_message(chat_room_id: int, requesting_user_id: int, content: str) -> sqlite3.Row:
    """Send a message as requesting_user_id -- the sender is always the
    verified requester, never a caller-supplied id.

    Raises PermissionDeniedError if the user isn't a participant of the
    chat room's Match (or is suspended), ValueError for a blank/whitespace-
    only message.

    On success, the *other* participant (never the sender) gets a "message"
    Notification in the same transaction as the INSERT -- related_type is
    "message"/related_id is the new message's id (not "chat_room"/
    chat_room_id) so distinct messages in the same room each get their own
    notification instead of colliding on the UNIQUE(user_id, type,
    related_type, related_id) constraint. The notification's routing (pages/
    8_알림.py) resolves message_id -> chat_room_id itself via get_chat_room(),
    re-verifying access rather than trusting related_id directly.
    """
    room = get_chat_room(chat_room_id, requesting_user_id)
    _require_not_suspended(requesting_user_id)

    content = (content or "").strip()
    if not content:
        raise ValueError("message content must not be blank")

    other_user_id = next(
        iter(_chat_room_participant_ids(room) - {requesting_user_id}), None
    )

    with get_connection() as conn:
        cursor = conn.execute(
            "INSERT INTO Message (chat_room_id, sender_user_id, content) VALUES (?, ?, ?)",
            (chat_room_id, requesting_user_id, content),
        )
        message_id = cursor.lastrowid
        message = conn.execute("SELECT * FROM Message WHERE id = ?", (message_id,)).fetchone()

        if other_user_id is not None:
            sender = conn.execute(
                "SELECT nickname FROM User WHERE id = ?", (requesting_user_id,)
            ).fetchone()
            _insert_notification(
                conn,
                other_user_id,
                "message",
                "새 메시지가 도착했습니다",
                f"{sender['nickname']}님이 메시지를 보냈습니다.",
                related_type="message",
                related_id=message_id,
            )

        return message


def mark_messages_as_read(chat_room_id: int, requesting_user_id: int) -> int:
    """Mark the *other* participant's unread messages in chat_room_id as
    read by requesting_user_id. Never touches requesting_user_id's own
    messages, and already-read messages are left alone (read_at stays at
    whenever they were first read).

    Raises the same errors as get_chat_room(): ValueError if the ChatRoom
    doesn't exist, PermissionDeniedError if requesting_user_id isn't a
    participant. Returns the number of messages updated.
    """
    get_chat_room(chat_room_id, requesting_user_id)

    with get_connection() as conn:
        cursor = conn.execute(
            """
            UPDATE Message
            SET read_at = datetime('now')
            WHERE chat_room_id = ?
              AND sender_user_id != ?
              AND read_at IS NULL
            """,
            (chat_room_id, requesting_user_id),
        )
        return cursor.rowcount


def mark_message_notifications_as_read_for_chat_room(chat_room_id: int, requesting_user_id: int) -> int:
    """Mark requesting_user_id's own "message" Notifications for this chat
    room as read -- called right after mark_messages_as_read() when a user
    actually enters a chat room, so a "new message" notification doesn't
    linger as unread once they've already seen the message in context.

    Notification.is_read and Message.read_at remain two separate concepts
    (see list_messages()/mark_messages_as_read()) -- this only keeps them in
    sync at this one entry point, it doesn't merge the two columns.

    Raises the same errors as get_chat_room(). Returns the number of
    notifications updated.
    """
    get_chat_room(chat_room_id, requesting_user_id)

    with get_connection() as conn:
        cursor = conn.execute(
            """
            UPDATE Notification
            SET is_read = 1
            WHERE user_id = ?
              AND type = 'message'
              AND related_type = 'message'
              AND is_read = 0
              AND related_id IN (SELECT id FROM Message WHERE chat_room_id = ?)
            """,
            (requesting_user_id, chat_room_id),
        )
        return cursor.rowcount


def count_unread_messages_by_user(user_id: int) -> int:
    """Total unread messages across every ChatRoom user_id participates in
    -- both Match-based and direct rooms -- i.e. messages the *other*
    participant sent that user_id hasn't read. A single JOIN query, scoped
    to user_id's own chat rooms only.

    Match.lost_post_id/found_post_id and ChatRoom.direct_lost_post_id/
    direct_found_post_id are coalesced per row: a Match-based room always
    has ma non-NULL (and the two direct_* columns NULL), a direct room the
    reverse, so exactly one side of each COALESCE ever contributes. Direct
    rooms have only one post, so their "other side" may instead be
    cr.initiator_user_id (never set on Match-based rooms).
    """
    with get_connection() as conn:
        row = conn.execute(
            """
            SELECT COUNT(*) AS unread_count
            FROM Message m
            JOIN ChatRoom cr ON cr.id = m.chat_room_id
            LEFT JOIN Match ma ON ma.id = cr.match_id
            LEFT JOIN LostPost lp ON lp.id = COALESCE(ma.lost_post_id, cr.direct_lost_post_id)
            LEFT JOIN FoundPost fp ON fp.id = COALESCE(ma.found_post_id, cr.direct_found_post_id)
            WHERE (lp.user_id = ? OR fp.user_id = ? OR cr.initiator_user_id = ?)
              AND m.sender_user_id != ?
              AND m.read_at IS NULL
            """,
            (user_id, user_id, user_id, user_id),
        ).fetchone()
        return row["unread_count"]


_CHAT_ROOM_LAST_MESSAGE_SUBQUERY = """
            SELECT
                id, chat_room_id, content, created_at, hidden_at,
                ROW_NUMBER() OVER (
                    PARTITION BY chat_room_id ORDER BY created_at DESC, id DESC
                ) AS rn
            FROM Message
"""


def list_chat_rooms_by_user(user_id: int) -> list[dict]:
    """ChatRooms user_id participates in -- both Match-based rooms (owner of
    the Match's LostPost and/or FoundPost) and "direct" rooms (started via
    the board's "채팅하기" button, no Match involved) -- with the related
    post/nickname and last-message fields joined in.

    Two queries (Match rooms, direct rooms) rather than one UNION-ed query:
    the two shapes don't share a column layout (a direct room only has one
    side's post), so forcing them into one SQL statement would need the same
    branching this function already needs in Python. Every row gets a
    "room_type" ("match" or "direct") plus a uniform other_nickname/
    other_user_id/post_title so callers don't have to branch on room_type
    just to render a card -- see pages/6_내_채팅.py.

    Rooms are ordered by their last message time descending; rooms with no
    messages yet sort after all of those, most recently created first --
    Match and direct rooms are interleaved by that same rule, not grouped by
    type.

    Like list_matches_by_user(), Match rows keep the lost_*/found_* prefixed
    fields so existing callers can determine "the other side" by comparing
    *_post_user_id to the current user_id, unchanged from before. Only
    nicknames are exposed -- never real names or emails.

    If the last message in a room has been hidden by an admin
    (Message.hidden_at set, via apply_report_action()'s "hide_message"
    action), last_message_content is replaced with
    HIDDEN_MESSAGE_PLACEHOLDER here too -- same masking list_messages()
    applies. Without this, the "내 채팅" preview card would leak the exact
    content an admin hid, defeating hide_message entirely whenever the
    hidden message happens to be the room's most recent one.
    """
    with get_connection() as conn:
        match_rows = conn.execute(
            """
            SELECT
                cr.id AS chat_room_id,
                cr.match_id AS match_id,
                cr.created_at AS chat_room_created_at,
                m.score AS score,
                lp.id AS lost_post_id,
                lp.user_id AS lost_post_user_id,
                lp.title AS lost_title,
                lu.nickname AS lost_user_nickname,
                fp.id AS found_post_id,
                fp.user_id AS found_post_user_id,
                fp.title AS found_title,
                fu.nickname AS found_user_nickname,
                lm.content AS last_message_content,
                lm.created_at AS last_message_created_at,
                lm.id AS last_message_id,
                lm.hidden_at AS last_message_hidden_at,
                (
                    SELECT COUNT(*)
                    FROM Message msg
                    WHERE msg.chat_room_id = cr.id
                      AND msg.sender_user_id != ?
                      AND msg.read_at IS NULL
                ) AS unread_count
            FROM ChatRoom cr
            JOIN Match m ON m.id = cr.match_id
            JOIN LostPost lp ON lp.id = m.lost_post_id
            JOIN FoundPost fp ON fp.id = m.found_post_id
            JOIN User lu ON lu.id = lp.user_id
            JOIN User fu ON fu.id = fp.user_id
            LEFT JOIN (""" + _CHAT_ROOM_LAST_MESSAGE_SUBQUERY + """) lm
                ON lm.chat_room_id = cr.id AND lm.rn = 1
            WHERE lp.user_id = ? OR fp.user_id = ?
            """,
            (user_id, user_id, user_id),
        ).fetchall()

        direct_rows = conn.execute(
            """
            SELECT
                cr.id AS chat_room_id,
                cr.created_at AS chat_room_created_at,
                cr.initiator_user_id AS initiator_user_id,
                iu.nickname AS initiator_nickname,
                COALESCE(dlp.title, dfp.title) AS direct_post_title,
                COALESCE(dlp.user_id, dfp.user_id) AS direct_post_owner_id,
                ou.nickname AS direct_post_owner_nickname,
                lm.content AS last_message_content,
                lm.created_at AS last_message_created_at,
                lm.id AS last_message_id,
                lm.hidden_at AS last_message_hidden_at,
                (
                    SELECT COUNT(*)
                    FROM Message msg
                    WHERE msg.chat_room_id = cr.id
                      AND msg.sender_user_id != ?
                      AND msg.read_at IS NULL
                ) AS unread_count
            FROM ChatRoom cr
            LEFT JOIN LostPost dlp ON dlp.id = cr.direct_lost_post_id
            LEFT JOIN FoundPost dfp ON dfp.id = cr.direct_found_post_id
            JOIN User iu ON iu.id = cr.initiator_user_id
            LEFT JOIN User ou ON ou.id = COALESCE(dlp.user_id, dfp.user_id)
            LEFT JOIN (""" + _CHAT_ROOM_LAST_MESSAGE_SUBQUERY + """) lm
                ON lm.chat_room_id = cr.id AND lm.rn = 1
            WHERE cr.match_id IS NULL
              AND (cr.initiator_user_id = ? OR dlp.user_id = ? OR dfp.user_id = ?)
            """,
            (user_id, user_id, user_id, user_id),
        ).fetchall()

    results = []
    for row in match_rows:
        item = dict(row)
        item["room_type"] = "match"
        if item["lost_post_user_id"] == user_id:
            item["other_user_id"] = item["found_post_user_id"]
            item["other_nickname"] = item["found_user_nickname"]
        else:
            item["other_user_id"] = item["lost_post_user_id"]
            item["other_nickname"] = item["lost_user_nickname"]
        results.append(item)

    for row in direct_rows:
        item = dict(row)
        item["room_type"] = "direct"
        # 게시물이 삭제됐는데 아직 CASCADE되지 않은 극히 짧은 경합 구간이면
        # direct_post_owner_id가 None일 수 있다 -- pages/5_채팅.py의 동일한
        # 처리(post_label = "삭제된 게시물")를 따른다.
        item["post_title"] = item["direct_post_title"] or "삭제된 게시물"
        if item["initiator_user_id"] == user_id:
            item["other_user_id"] = item["direct_post_owner_id"]
            item["other_nickname"] = item["direct_post_owner_nickname"] or "상대방"
        else:
            item["other_user_id"] = item["initiator_user_id"]
            item["other_nickname"] = item["initiator_nickname"]
        results.append(item)

    for item in results:
        if item["last_message_hidden_at"]:
            item["last_message_content"] = HIDDEN_MESSAGE_PLACEHOLDER

    # Match/direct 두 그룹을 따로 조회했으므로, 기존 SQL의 ORDER BY(마지막
    # 메시지 최신순, 메시지 없는 방은 방 생성일 최신순)와 동일한 규칙으로
    # 두 그룹을 병합 정렬한다.
    with_message = [item for item in results if item["last_message_created_at"] is not None]
    without_message = [item for item in results if item["last_message_created_at"] is None]
    with_message.sort(key=lambda item: (item["last_message_created_at"], item["last_message_id"] or 0), reverse=True)
    without_message.sort(key=lambda item: item["chat_room_created_at"], reverse=True)
    return with_message + without_message


# ---------- Report ----------

REPORT_TARGET_TYPES = {"post", "message", "user"}


def _validate_report_target(target_type: str, target_id: int, reporter_user_id: int) -> None:
    """Raises ValueError if the target doesn't exist or the reporter is
    reporting their own post/message/self.

    target_type="post" doesn't distinguish LostPost from FoundPost (that's
    the schema this feature was asked to use), and LostPost.id/FoundPost.id
    are independent AUTOINCREMENT sequences that both start at 1 -- so the
    *same* target_id commonly refers to a completely different post in each
    table (id collision is the common case for early posts, not a rare
    edge case). To keep target_id unambiguous without changing the Report
    schema, the caller encodes which table with the sign: a positive
    target_id is a LostPost id, a negative target_id is -(FoundPost id).
    """
    if target_type == "post":
        if target_id > 0:
            post = get_lost_post(target_id)
        elif target_id < 0:
            post = get_found_post(-target_id)
        else:
            post = None
        if post is None:
            raise ValueError(f"Post {target_id} not found")
        if post["user_id"] == reporter_user_id:
            raise ValueError("자신이 작성한 게시물은 신고할 수 없습니다.")

    elif target_type == "message":
        with get_connection() as conn:
            message = conn.execute(
                "SELECT * FROM Message WHERE id = ?", (target_id,)
            ).fetchone()
        if message is None:
            raise ValueError(f"Message {target_id} not found")
        if message["sender_user_id"] == reporter_user_id:
            raise ValueError("자신이 보낸 메시지는 신고할 수 없습니다.")

    else:  # "user"
        target_user = get_user_by_id(target_id)
        if target_user is None:
            raise ValueError(f"User {target_id} not found")
        if target_id == reporter_user_id:
            raise ValueError("자기 자신을 신고할 수 없습니다.")


def create_report(
    reporter_user_id: int,
    target_type: str,
    target_id: int,
    reason: str,
    detail: str | None = None,
) -> int:
    """File a report. All validation happens here, not in the UI:

    - reporter_user_id must be a real User
    - target_type must be one of REPORT_TARGET_TYPES
    - the target (post/message/user) must actually exist
    - self-reports are rejected (own post, own message, or yourself)
    - reason must not be blank
    - duplicate reports (same reporter + same target) are rejected --
      checked here *and* backed by the UNIQUE index for any bypass

    For target_type="post", target_id is signed: positive = LostPost id,
    negative = -(FoundPost id) -- see _validate_report_target() for why.

    Raises ValueError for every case above (never a raw sqlite3.IntegrityError).
    """
    if get_user_by_id(reporter_user_id) is None:
        raise ValueError(f"User {reporter_user_id} not found")

    if target_type not in REPORT_TARGET_TYPES:
        raise ValueError(f"invalid target_type: {target_type!r}")

    reason = (reason or "").strip()
    if not reason:
        raise ValueError("신고 사유를 입력해주세요.")

    detail = (detail or "").strip() or None

    _validate_report_target(target_type, target_id, reporter_user_id)

    with get_connection() as conn:
        existing = conn.execute(
            """
            SELECT id FROM Report
            WHERE reporter_user_id = ? AND target_type = ? AND target_id = ?
            """,
            (reporter_user_id, target_type, target_id),
        ).fetchone()
    if existing is not None:
        raise ValueError("이미 신고한 대상입니다.")

    try:
        with get_connection() as conn:
            cursor = conn.execute(
                """
                INSERT INTO Report
                    (reporter_user_id, target_type, target_id, reason, detail)
                VALUES (?, ?, ?, ?, ?)
                """,
                (reporter_user_id, target_type, target_id, reason, detail),
            )
            return cursor.lastrowid
    except sqlite3.IntegrityError:
        raise ValueError("이미 신고한 대상입니다.")


def get_report(report_id: int) -> sqlite3.Row | None:
    with get_connection() as conn:
        return conn.execute(
            "SELECT * FROM Report WHERE id = ?", (report_id,)
        ).fetchone()


def list_reports_by_reporter(reporter_user_id: int) -> list[sqlite3.Row]:
    with get_connection() as conn:
        return conn.execute(
            "SELECT * FROM Report WHERE reporter_user_id = ? ORDER BY created_at DESC",
            (reporter_user_id,),
        ).fetchall()


# ---------- Admin ----------

REPORT_STATUSES = {"pending", "dismissed", "actioned"}


def is_admin(user_id: int) -> bool:
    """DB-sourced admin check. Always re-reads User.is_admin -- never trust
    a caller-supplied claim (UI state, query params, etc.)."""
    user = get_user_by_id(user_id)
    return bool(user and user["is_admin"])


def _require_admin(requesting_user_id: int) -> None:
    """Raises PermissionDeniedError unless requesting_user_id is a real,
    DB-flagged admin. Every admin-only function below calls this first --
    same "never trust the caller, re-check the DB row" pattern as
    _check_lost_post_owner()/_match_participant_ids() elsewhere in this
    module, so hiding a button in the UI is never the only thing standing
    between a non-admin and admin-only data."""
    user = get_user_by_id(requesting_user_id)
    if user is None:
        raise PermissionDeniedError("Admin check failed: user not found")
    if not user["is_admin"]:
        raise PermissionDeniedError("관리자 권한이 필요합니다.")


def _batch_fetch_report_targets(reports: list[sqlite3.Row]) -> dict:
    """Look up every report's target in a handful of grouped IN queries
    (one per target table actually referenced on this page) instead of one
    query per report -- avoids N+1 queries when rendering a report list.
    """
    lost_ids, found_ids, message_ids, user_ids = set(), set(), set(), set()
    for r in reports:
        if r["target_type"] == "post":
            if r["target_id"] > 0:
                lost_ids.add(r["target_id"])
            else:
                found_ids.add(-r["target_id"])
        elif r["target_type"] == "message":
            message_ids.add(r["target_id"])
        else:
            user_ids.add(r["target_id"])

    lost_map, found_map, message_map, user_map = {}, {}, {}, {}
    with get_connection() as conn:
        if lost_ids:
            qmarks = ",".join("?" * len(lost_ids))
            rows = conn.execute(
                f"""
                SELECT lp.*, u.nickname AS author_nickname
                FROM LostPost lp JOIN User u ON u.id = lp.user_id
                WHERE lp.id IN ({qmarks})
                """,
                tuple(lost_ids),
            ).fetchall()
            lost_map = {row["id"]: row for row in rows}
        if found_ids:
            qmarks = ",".join("?" * len(found_ids))
            rows = conn.execute(
                f"""
                SELECT fp.*, u.nickname AS author_nickname
                FROM FoundPost fp JOIN User u ON u.id = fp.user_id
                WHERE fp.id IN ({qmarks})
                """,
                tuple(found_ids),
            ).fetchall()
            found_map = {row["id"]: row for row in rows}
        if message_ids:
            qmarks = ",".join("?" * len(message_ids))
            rows = conn.execute(
                f"""
                SELECT m.*, u.nickname AS sender_nickname
                FROM Message m JOIN User u ON u.id = m.sender_user_id
                WHERE m.id IN ({qmarks})
                """,
                tuple(message_ids),
            ).fetchall()
            message_map = {row["id"]: row for row in rows}
        if user_ids:
            qmarks = ",".join("?" * len(user_ids))
            rows = conn.execute(
                f"SELECT * FROM User WHERE id IN ({qmarks})",
                tuple(user_ids),
            ).fetchall()
            user_map = {row["id"]: row for row in rows}

    return {"lost": lost_map, "found": found_map, "message": message_map, "user": user_map}


def _report_target_info(report: sqlite3.Row, maps: dict) -> dict | None:
    """Build the admin-facing target summary for one report, or None if the
    target no longer exists (deleted post/message, since Report.target_id
    deliberately has no FK so the report itself survives that deletion).
    Only nicknames are ever included -- never email or real name."""
    if report["target_type"] == "post":
        if report["target_id"] > 0:
            post = maps["lost"].get(report["target_id"])
            post_kind = "lost"
        else:
            post = maps["found"].get(-report["target_id"])
            post_kind = "found"
        if post is None:
            return None
        return {
            "post_kind": post_kind,
            "title": post["title"],
            "description": post["description"],
            "category": post["category"],
            "location": post["location"],
            "status": post["status"],
            "author_nickname": post["author_nickname"],
            "created_at": post["created_at"],
        }

    if report["target_type"] == "message":
        msg = maps["message"].get(report["target_id"])
        if msg is None:
            return None
        return {
            "content": msg["content"],
            "sender_nickname": msg["sender_nickname"],
            "created_at": msg["created_at"],
            "chat_room_id": msg["chat_room_id"],
        }

    user = maps["user"].get(report["target_id"])
    if user is None:
        return None
    return {"nickname": user["nickname"]}


def list_reports_for_admin(
    requesting_admin_user_id: int,
    status: str | None = None,
    target_type: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> list[dict]:
    """Admin-only report list. Raises PermissionDeniedError unless
    requesting_admin_user_id is a DB-flagged admin (re-checked here, not
    trusted from the caller).

    status/target_type filter the list when given (None = all). Ordering
    always puts pending reports first, newest first within each group --
    satisfies "list can be viewed pending-first" without a separate code
    path for the unfiltered case. limit/offset provide simple pagination.

    Each returned dict is the Report row's fields plus reporter_nickname,
    processed_by_nickname, target_deleted (bool), and target_info (a
    type-specific summary dict, or None when target_deleted is True) --
    batched via _batch_fetch_report_targets() so this never does one target
    lookup per report.
    """
    _require_admin(requesting_admin_user_id)

    if status is not None and status not in REPORT_STATUSES:
        raise ValueError(f"invalid status: {status!r}")
    if target_type is not None and target_type not in REPORT_TARGET_TYPES:
        raise ValueError(f"invalid target_type: {target_type!r}")

    conditions = []
    params: list = []
    if status is not None:
        conditions.append("r.status = ?")
        params.append(status)
    if target_type is not None:
        conditions.append("r.target_type = ?")
        params.append(target_type)
    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""

    with get_connection() as conn:
        rows = conn.execute(
            f"""
            SELECT
                r.*,
                ru.nickname AS reporter_nickname,
                pu.nickname AS processed_by_nickname
            FROM Report r
            JOIN User ru ON ru.id = r.reporter_user_id
            LEFT JOIN User pu ON pu.id = r.processed_by_user_id
            {where}
            ORDER BY
                CASE WHEN r.status = 'pending' THEN 0 ELSE 1 END,
                r.created_at DESC
            LIMIT ? OFFSET ?
            """,
            params + [limit, offset],
        ).fetchall()

    maps = _batch_fetch_report_targets(rows)
    moderation_actions = _batch_fetch_moderation_actions({row["id"] for row in rows})

    results = []
    for row in rows:
        item = dict(row)
        target_info = _report_target_info(row, maps)
        item["target_deleted"] = target_info is None
        item["target_info"] = target_info
        item["moderation_action"] = moderation_actions.get(row["id"])
        results.append(item)
    return results


def process_report(
    report_id: int,
    requesting_admin_user_id: int,
    status: str,
    admin_note: str | None = None,
) -> None:
    """Record an admin's review decision on a report.

    Validation, in order:
    1. requesting_admin_user_id must be a real, DB-flagged admin
       (_require_admin -- never trusts the caller)
    2. report_id must exist
    3. status must be 'dismissed' or 'actioned' ('pending' is not a valid
       target of processing -- that's the state before review, not a
       decision an admin makes)
    4. the report must still be 'pending' -- once processed it's locked;
       re-processing raises ValueError rather than silently overwriting who
       decided what and when. There's no separate ReportHistory table this
       step, so an overwrite would destroy the only record of the earlier
       decision. The check-and-update is done in one atomic UPDATE (WHERE
       status = 'pending'), the same race-safe pattern set_initial_nickname()
       uses for "only if still unset".

    processed_by_user_id is always requesting_admin_user_id -- there is no
    parameter or code path that lets any other id (e.g. the reporter's) be
    recorded as the processor. processed_at is the DB's own clock. admin_note
    is trimmed and stored as NULL when blank.

    On success, the reporter (Report.reporter_user_id) gets a
    "report_processed" Notification in the same transaction as the UPDATE.
    """
    _require_admin(requesting_admin_user_id)

    report = get_report(report_id)
    if report is None:
        raise ValueError(f"Report {report_id} not found")

    if status not in (REPORT_STATUSES - {"pending"}):
        raise ValueError(f"invalid status: {status!r}")

    admin_note = (admin_note or "").strip() or None

    with get_connection() as conn:
        cursor = conn.execute(
            """
            UPDATE Report
            SET status = ?, processed_at = datetime('now'),
                processed_by_user_id = ?, admin_note = ?
            WHERE id = ? AND status = 'pending'
            """,
            (status, requesting_admin_user_id, admin_note, report_id),
        )
        if cursor.rowcount == 0:
            raise ValueError("이미 처리된 신고입니다.")

        content = (
            "신고하신 내용이 관리자에 의해 반려되었습니다."
            if status == "dismissed"
            else "신고하신 내용이 관리자 조치로 처리되었습니다."
        )
        _insert_notification(
            conn,
            report["reporter_user_id"],
            "report_processed",
            "신고 처리 결과가 등록되었습니다",
            content,
            related_type="report",
            related_id=report_id,
        )


# ---------- Moderation ----------

MODERATION_ACTION_TYPES = {"delete_post", "hide_message", "suspend_user"}

# The only action_type valid for each Report.target_type -- enforced in
# apply_report_action() so e.g. a message report can't be "actioned" with
# suspend_user.
_TARGET_TYPE_TO_ACTION_TYPES = {
    "post": {"delete_post"},
    "message": {"hide_message"},
    "user": {"suspend_user"},
}


def _batch_fetch_moderation_actions(report_ids: set[int]) -> dict:
    """One grouped IN query for every report on a page instead of one query
    per report -- same N+1-avoidance pattern as _batch_fetch_report_targets().
    Only the admin's nickname is joined in, never email/real name."""
    if not report_ids:
        return {}
    qmarks = ",".join("?" * len(report_ids))
    with get_connection() as conn:
        rows = conn.execute(
            f"""
            SELECT ma.*, u.nickname AS admin_nickname
            FROM ModerationAction ma
            JOIN User u ON u.id = ma.admin_user_id
            WHERE ma.report_id IN ({qmarks})
            """,
            tuple(report_ids),
        ).fetchall()
    return {row["report_id"]: dict(row) for row in rows}


def get_moderation_action_for_report(report_id: int) -> sqlite3.Row | None:
    with get_connection() as conn:
        return conn.execute(
            "SELECT * FROM ModerationAction WHERE report_id = ?", (report_id,)
        ).fetchone()


def apply_report_action(
    report_id: int,
    requesting_admin_user_id: int,
    action_type: str,
    action_reason: str | None = None,
    admin_note: str | None = None,
    suspend_duration_days: int | None = None,
) -> int:
    """Process a report as 'actioned' *and* apply the real sanction (delete
    the post / hide the message / suspend the user) atomically -- both
    happen, or neither does.

    Validation, in order (mirrors process_report()'s order, plus the extra
    target/action checks this needs):
    1. requesting_admin_user_id must be a real, DB-flagged admin
       (_require_admin -- never trusts the caller)
    2. report_id must exist
    3. action_type must be one of MODERATION_ACTION_TYPES *and* match the
       report's target_type (post->delete_post, message->hide_message,
       user->suspend_user) -- a mismatched combination is rejected
    4. the report must still be 'pending' (same "locked after processing"
       policy process_report() enforces)
    5. no ModerationAction may already exist for this report_id yet (the
       UNIQUE(report_id) constraint backs this too -- see below)
    6. suspend_duration_days, if given, must be a positive int

    Then, inside a single connection/transaction: the target's existence is
    re-checked (it may have been deleted since the admin's list loaded),
    the real mutation is applied, a ModerationAction row is inserted, and
    Report flips to 'actioned'/processed_by/processed_at/admin_note via the
    same `WHERE status = 'pending'` atomic guard process_report() uses. If
    any step fails, get_connection()'s except/rollback discards the whole
    transaction -- the mutation, the ModerationAction insert, and the
    Report update all-or-nothing.

    Concurrency: if two admins race on the same report, SQLite's own
    single-writer locking serializes their transactions. Whichever commits
    first wins; the second's final `WHERE status = 'pending'` (or, just as
    likely, its own ModerationAction insert, blocked by the UNIQUE(report_id)
    constraint since the winner's row is now committed) fails, and its
    entire transaction -- including whatever mutation it had already
    attempted -- rolls back. Either way, exactly one ModerationAction per
    report_id, never two, and sqlite3.IntegrityError from the UNIQUE
    constraint is converted to ValueError rather than leaking raw.

    suspend_duration_days: for action_type="suspend_user" only -- a number
    of days for a timed suspension, or None for a permanent one (see
    User.is_suspended/suspended_until's documented semantics). Ignored for
    other action types.
    """
    _require_admin(requesting_admin_user_id)

    report = get_report(report_id)
    if report is None:
        raise ValueError(f"Report {report_id} not found")

    if action_type not in MODERATION_ACTION_TYPES:
        raise ValueError(f"invalid action_type: {action_type!r}")
    if action_type not in _TARGET_TYPE_TO_ACTION_TYPES.get(report["target_type"], set()):
        raise ValueError(
            f"action_type {action_type!r} is not valid for target_type {report['target_type']!r}"
        )

    if report["status"] != "pending":
        raise ValueError("이미 처리된 신고입니다.")

    if get_moderation_action_for_report(report_id) is not None:
        raise ValueError("이미 이 신고에 대한 조치가 존재합니다.")

    if suspend_duration_days is not None and (
        isinstance(suspend_duration_days, bool)
        or not isinstance(suspend_duration_days, int)
        or suspend_duration_days <= 0
    ):
        raise ValueError(f"invalid suspend_duration_days: {suspend_duration_days!r}")

    action_reason = (action_reason or "").strip() or None
    admin_note = (admin_note or "").strip() or None

    target_type = report["target_type"]
    target_id = report["target_id"]
    expires_at = None

    try:
        with get_connection() as conn:
            if target_type == "post":
                if target_id > 0:
                    table, real_id = "LostPost", target_id
                else:
                    table, real_id = "FoundPost", -target_id
                row = conn.execute(
                    f"SELECT id, user_id FROM {table} WHERE id = ?", (real_id,)
                ).fetchone()
                if row is None:
                    raise ValueError("대상 게시물이 이미 삭제되었습니다.")
                target_owner_id = row["user_id"]
                conn.execute(f"DELETE FROM {table} WHERE id = ?", (real_id,))
                _insert_notification(
                    conn,
                    target_owner_id,
                    "post_deleted",
                    "게시물이 삭제되었습니다",
                    "신고 접수된 게시물이 관리자 조치로 삭제되었습니다.",
                    related_type="report",
                    related_id=report_id,
                )

            elif target_type == "message":
                row = conn.execute(
                    "SELECT id, sender_user_id FROM Message WHERE id = ?", (target_id,)
                ).fetchone()
                if row is None:
                    raise ValueError("대상 메시지가 이미 삭제되었습니다.")
                target_owner_id = row["sender_user_id"]
                conn.execute(
                    """
                    UPDATE Message
                    SET hidden_at = datetime('now'), hidden_by_user_id = ?, hidden_reason = ?
                    WHERE id = ?
                    """,
                    (requesting_admin_user_id, action_reason, target_id),
                )
                _insert_notification(
                    conn,
                    target_owner_id,
                    "message_hidden",
                    "메시지가 숨김 처리되었습니다",
                    "작성하신 메시지가 관리자 조치로 숨김 처리되었습니다.",
                    related_type="report",
                    related_id=report_id,
                )

            else:  # "user"
                row = conn.execute("SELECT id FROM User WHERE id = ?", (target_id,)).fetchone()
                if row is None:
                    raise ValueError("대상 사용자를 찾을 수 없습니다.")
                target_owner_id = target_id
                if suspend_duration_days is not None:
                    until_row = conn.execute(
                        "SELECT datetime('now', ?) AS until", (f"+{suspend_duration_days} days",)
                    ).fetchone()
                    expires_at = until_row["until"]
                    suspend_desc = f"{suspend_duration_days}일 정지되었습니다."
                else:
                    suspend_desc = "영구 정지되었습니다."
                conn.execute(
                    "UPDATE User SET is_suspended = 1, suspended_until = ? WHERE id = ?",
                    (expires_at, target_id),
                )
                _insert_notification(
                    conn,
                    target_owner_id,
                    "user_suspended",
                    "계정 정지 안내",
                    f"계정이 {suspend_desc}",
                    related_type="report",
                    related_id=report_id,
                )

            cursor = conn.execute(
                """
                INSERT INTO ModerationAction
                    (report_id, target_type, target_id, action_type, reason, admin_user_id, expires_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (report_id, target_type, target_id, action_type, action_reason,
                 requesting_admin_user_id, expires_at),
            )
            moderation_action_id = cursor.lastrowid

            update_cursor = conn.execute(
                """
                UPDATE Report
                SET status = 'actioned', processed_at = datetime('now'),
                    processed_by_user_id = ?, admin_note = ?
                WHERE id = ? AND status = 'pending'
                """,
                (requesting_admin_user_id, admin_note, report_id),
            )
            if update_cursor.rowcount == 0:
                raise ValueError("이미 처리된 신고입니다.")

            _insert_notification(
                conn,
                report["reporter_user_id"],
                "report_processed",
                "신고 처리 결과가 등록되었습니다",
                "신고하신 내용이 관리자 조치로 처리되었습니다.",
                related_type="report",
                related_id=report_id,
            )
    except sqlite3.IntegrityError:
        raise ValueError("이미 이 신고에 대한 조치가 존재합니다.")

    return moderation_action_id


# ---------- Notification ----------

NOTIFICATION_TYPES = {
    "message", "match", "report_processed", "post_deleted", "message_hidden", "user_suspended",
}


def _insert_notification(
    conn: sqlite3.Connection,
    user_id: int,
    notification_type: str,
    title: str,
    content: str,
    related_type: str | None = None,
    related_id: int | None = None,
) -> int | None:
    """Insert one Notification row using the *caller's own* already-open
    connection/transaction -- so the notification commits or rolls back
    together with whatever "real" event caused it (a sent message, a new
    match, a processed report), never separately. This is why
    send_message()/create_match()/apply_report_action()/process_report()
    call this instead of the public create_notification() (which opens its
    own connection): those four are the only places a notification is
    created, and each does so as part of the same transaction as the event
    itself -- never from a page just being rendered/rerun.

    Raises ValueError for an invalid notification_type, a blank title/
    content, or an inconsistent related_type/related_id pair (exactly one
    of the two given). Does *not* re-check that user_id exists -- the
    caller has always already resolved/verified it as part of its own event
    (e.g. the chat room's other participant, a report's reporter_user_id).

    A duplicate (same user_id/type/related_type/related_id, blocked by the
    UNIQUE constraint) is treated as a no-op -- returns the existing row's
    id instead of raising -- since a re-fired notification for an event
    that's naturally idempotent elsewhere (e.g. create_match()'s
    get-or-create) shouldn't itself fail the whole transaction.
    """
    if notification_type not in NOTIFICATION_TYPES:
        raise ValueError(f"invalid notification_type: {notification_type!r}")
    title = (title or "").strip()
    if not title:
        raise ValueError("notification title must not be blank")
    content = (content or "").strip()
    if not content:
        raise ValueError("notification content must not be blank")
    if (related_type is None) != (related_id is None):
        raise ValueError("related_type and related_id must both be set or both be None")

    try:
        cursor = conn.execute(
            """
            INSERT INTO Notification (user_id, type, title, content, related_type, related_id)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (user_id, notification_type, title, content, related_type, related_id),
        )
        return cursor.lastrowid
    except sqlite3.IntegrityError:
        existing = conn.execute(
            """
            SELECT id FROM Notification
            WHERE user_id = ? AND type = ? AND related_type = ? AND related_id = ?
            """,
            (user_id, notification_type, related_type, related_id),
        ).fetchone()
        return existing["id"] if existing else None


def create_notification(
    user_id: int,
    notification_type: str,
    title: str,
    content: str,
    related_type: str | None = None,
    related_id: int | None = None,
) -> int:
    """Create one Notification in its own transaction.

    This is a standalone entry point (tests, any future one-off/admin
    caller) -- it is NOT how the four real event sources create
    notifications; see _insert_notification()'s docstring. Raises
    ValueError if user_id doesn't exist, on top of every check
    _insert_notification() already does.
    """
    if get_user_by_id(user_id) is None:
        raise ValueError(f"User {user_id} not found")

    with get_connection() as conn:
        return _insert_notification(
            conn, user_id, notification_type, title, content, related_type, related_id
        )


def get_notification(notification_id: int) -> sqlite3.Row | None:
    with get_connection() as conn:
        return conn.execute(
            "SELECT * FROM Notification WHERE id = ?", (notification_id,)
        ).fetchone()


def list_notifications_by_user(user_id: int, limit: int = 50, offset: int = 0) -> list[sqlite3.Row]:
    with get_connection() as conn:
        return conn.execute(
            """
            SELECT id, user_id, type, title, content, related_type, related_id, is_read, created_at
            FROM Notification
            WHERE user_id = ?
            ORDER BY created_at DESC, id DESC
            LIMIT ? OFFSET ?
            """,
            (user_id, limit, offset),
        ).fetchall()


def count_unread_notifications(user_id: int) -> int:
    """COUNT(*) scoped to user_id's own unread notifications -- a single
    query, never a full row fetch."""
    with get_connection() as conn:
        row = conn.execute(
            "SELECT COUNT(*) AS unread_count FROM Notification WHERE user_id = ? AND is_read = 0",
            (user_id,),
        ).fetchone()
        return row["unread_count"]


def mark_notification_as_read(notification_id: int, requesting_user_id: int) -> None:
    """Marks one notification read -- but only requesting_user_id's own.

    Raises ValueError if it doesn't exist, PermissionDeniedError if it
    belongs to someone else (checked explicitly for a clean, specific
    exception -- then re-enforced by the UPDATE's own `WHERE id = ? AND
    user_id = ?`, the same belt-and-suspenders pattern every other
    ownership check in this module uses, so a bypassed/direct call still
    can't touch another user's notification).
    """
    notification = get_notification(notification_id)
    if notification is None:
        raise ValueError(f"Notification {notification_id} not found")
    if notification["user_id"] != requesting_user_id:
        raise PermissionDeniedError("You can only mark your own notifications as read")

    with get_connection() as conn:
        conn.execute(
            "UPDATE Notification SET is_read = 1 WHERE id = ? AND user_id = ?",
            (notification_id, requesting_user_id),
        )


def mark_all_notifications_as_read(requesting_user_id: int) -> int:
    """Marks every unread notification belonging to requesting_user_id as
    read. Scoped entirely by the WHERE clause -- no other user's
    notifications are touched. Returns the number of rows updated."""
    with get_connection() as conn:
        cursor = conn.execute(
            "UPDATE Notification SET is_read = 1 WHERE user_id = ? AND is_read = 0",
            (requesting_user_id,),
        )
        return cursor.rowcount


if __name__ == "__main__":
    init_db()
    print(f"DB initialized at {DB_PATH}")
