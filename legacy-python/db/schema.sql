PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS User (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    nickname TEXT,
    is_admin INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0, 1)),
    is_suspended INTEGER NOT NULL DEFAULT 0 CHECK (is_suspended IN (0, 1)),
    suspended_until TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS LostPost (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES User(id),
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL,
    location TEXT NOT NULL,
    lost_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT '찾는 중' CHECK (status IN ('찾는 중', '찾음')),
    image_url TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS FoundPost (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES User(id),
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL,
    location TEXT NOT NULL,
    found_at TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT '보관 중' CHECK (status IN ('보관 중', '완료')),
    image_url TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS Match (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lost_post_id INTEGER NOT NULL REFERENCES LostPost(id) ON DELETE CASCADE,
    found_post_id INTEGER NOT NULL REFERENCES FoundPost(id) ON DELETE CASCADE,
    score REAL NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (lost_post_id, found_post_id)
);

CREATE TABLE IF NOT EXISTS ChatRoom (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    -- A ChatRoom is either Match-based (match_id set, the existing AI-match
    -- -> confirm -> chat flow) OR "direct" (match_id NULL, the two
    -- direct_*_post_id/initiator_user_id columns set instead) -- a viewer
    -- messaging a post's author straight from the board, with no Match
    -- required. Exactly one of the two shapes applies per row; enforced by
    -- application code (get_or_create_chat_room vs
    -- get_or_create_direct_chat_room), not a CHECK, to match this
    -- project's existing convention of not CHECK-constraining every
    -- invariant (e.g. LostPost.category isn't either).
    match_id INTEGER UNIQUE REFERENCES Match(id) ON DELETE CASCADE,
    direct_lost_post_id INTEGER REFERENCES LostPost(id) ON DELETE CASCADE,
    direct_found_post_id INTEGER REFERENCES FoundPost(id) ON DELETE CASCADE,
    initiator_user_id INTEGER REFERENCES User(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS Message (
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

CREATE TABLE IF NOT EXISTS Report (
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

CREATE TABLE IF NOT EXISTS ModerationAction (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id INTEGER NOT NULL UNIQUE REFERENCES Report(id),
    target_type TEXT NOT NULL CHECK (target_type IN ('post', 'message', 'user')),
    target_id INTEGER NOT NULL,
    action_type TEXT NOT NULL CHECK (action_type IN ('delete_post', 'hide_message', 'suspend_user')),
    reason TEXT,
    admin_user_id INTEGER NOT NULL REFERENCES User(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at TEXT
);

CREATE TABLE IF NOT EXISTS Notification (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES User(id),
    type TEXT NOT NULL CHECK (
        type IN ('message', 'match', 'report_processed', 'post_deleted', 'message_hidden', 'user_suspended')
    ),
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    related_type TEXT,
    related_id INTEGER,
    is_read INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (user_id, type, related_type, related_id)
);

CREATE INDEX IF NOT EXISTS idx_lostpost_user_id ON LostPost(user_id);
CREATE INDEX IF NOT EXISTS idx_foundpost_user_id ON FoundPost(user_id);
CREATE INDEX IF NOT EXISTS idx_match_lost_post_id ON Match(lost_post_id);
CREATE INDEX IF NOT EXISTS idx_match_found_post_id ON Match(found_post_id);
CREATE INDEX IF NOT EXISTS idx_message_chat_room_id ON Message(chat_room_id);
-- Supports list_messages()'s cursor-paginated query (WHERE chat_room_id = ?
-- [AND id < ?] ORDER BY created_at DESC, id DESC LIMIT ?) directly from the
-- index instead of a separate sort step -- matters once a room's history
-- grows past a handful of pages, which is the whole point of paginating.
-- Purely additive (CREATE INDEX is safe on an existing DB with no rebuild),
-- so it needs no migration function of its own.
CREATE INDEX IF NOT EXISTS idx_message_chat_room_created_id ON Message(chat_room_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_report_reporter_user_id ON Report(reporter_user_id);
CREATE INDEX IF NOT EXISTS idx_notification_user_read_created ON Notification(user_id, is_read, created_at DESC);
-- idx_user_nickname (User.nickname), idx_report_status (Report.status), and
-- the two ChatRoom idx_chatroom_direct_*_unique partial indexes are created
-- by _migrate_user_table_add_nickname() / _migrate_report_table_add_processing_fields() /
-- _migrate_chatroom_table_add_direct_chat() in database.py instead of here:
-- on a pre-existing DB, the CREATE TABLE IF NOT EXISTS above is a no-op
-- (the table already exists without that column), so an unconditional
-- CREATE INDEX here would fail until the migration has actually added the
-- column.
