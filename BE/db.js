/**
 * db/database.py 를 그대로 옮긴 데이터 계층 (better-sqlite3).
 *
 * 파이썬 원본과의 대응:
 *   PermissionDeniedError  -> PermissionDeniedError (HTTP 403)
 *   ValueError             -> ValidationError       (HTTP 400)
 *   sqlite3.Row            -> 평범한 JS 객체
 *
 * 권한/유효성 검사는 전부 여기(DB 계층)에 있다. BE/server.js 의 라우터는
 * "로그인했는가"만 보고, 실제 소유권·관리자·정지 여부는 이 파일이 매번
 * DB를 다시 읽어서 판단한다 (파이썬 원본과 동일한 정책).
 */
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

// Railway에서는 Volume을 /data 에 마운트하고 DATA_DIR=/data 로 지정한다.
// 그래야 재배포해도 DB와 업로드 이미지가 지워지지 않는다. (README 참고)
export const DATA_DIR = path.resolve(PROJECT_ROOT, process.env.DATA_DIR || './data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const DB_PATH = path.join(DATA_DIR, 'lost_found.db');

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

export const LOST_STATUSES = new Set(['찾는 중', '찾음']);
export const FOUND_STATUSES = new Set(['보관 중', '완료']);
export const CATEGORIES = ['전자기기', '필기구', '책', '지갑', '카드', '의류', '가방', '액세서리', '기타'];
export const REPORT_REASONS = ['사기/허위 정보', '부적절한 내용', '욕설/비방', '개인정보 노출', '도배/스팸', '기타'];

export const NICKNAME_MIN_LENGTH = 2;
export const NICKNAME_MAX_LENGTH = 20;
// 화이트리스트(블랙리스트가 아님): 한글/영문/숫자만 통과시키므로
// < > & " ' / 같은 HTML/스크립트 주입 문자는 애초에 저장되지 않는다.
const NICKNAME_RE = /^[가-힣a-zA-Z0-9]+$/;

export const SUSPENDED_ACCOUNT_MESSAGE = '정지된 계정은 이 기능을 사용할 수 없습니다.';
export const HIDDEN_MESSAGE_PLACEHOLDER = '[관리자에 의해 숨겨진 메시지입니다.]';
export const MESSAGE_PAGE_SIZE = 50;

export const REPORT_TARGET_TYPES = new Set(['post', 'message', 'user']);
export const REPORT_STATUSES = new Set(['pending', 'dismissed', 'actioned']);
export const MODERATION_ACTION_TYPES = new Set(['delete_post', 'hide_message', 'suspend_user']);
export const NOTIFICATION_TYPES = new Set([
  'message', 'match', 'report_processed', 'post_deleted', 'message_hidden', 'user_suspended',
]);

// Report.target_type 별로 허용되는 단 하나의 action_type.
const TARGET_TYPE_TO_ACTION_TYPES = {
  post: new Set(['delete_post']),
  message: new Set(['hide_message']),
  user: new Set(['suspend_user']),
};

// YYYY-MM-DD 또는 YYYY-MM-DD HH:MM(:SS)
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}(:\d{2})?)?$/;

export class PermissionDeniedError extends Error {
  constructor(message) { super(message); this.name = 'PermissionDeniedError'; this.status = 403; }
}
export class ValidationError extends Error {
  constructor(message) { super(message); this.name = 'ValidationError'; this.status = 400; }
}

function validateDatetime(value, fieldName) {
  if (!DATETIME_RE.test(String(value ?? ''))) {
    throw new ValidationError(`${fieldName}는 'YYYY-MM-DD' 또는 'YYYY-MM-DD HH:MM' 형식이어야 합니다.`);
  }
}

// ---------------------------------------------------------------- schema

// db/schema.sql 을 그대로 옮기되, 파이썬 쪽 _migrate_* 함수들이 나중에
// 덧붙이던 컬럼(nickname / is_admin / suspension / hidden_* / direct chat)을
// 처음부터 포함시킨 "최종형" 스키마다. 새 프로젝트라 마이그레이션이 필요 없다.
const SCHEMA = `
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

CREATE TABLE IF NOT EXISTS "Match" (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    lost_post_id INTEGER NOT NULL REFERENCES LostPost(id) ON DELETE CASCADE,
    found_post_id INTEGER NOT NULL REFERENCES FoundPost(id) ON DELETE CASCADE,
    score REAL NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (lost_post_id, found_post_id)
);

-- ChatRoom 은 두 가지 모양 중 하나다:
--   1) 매칭 기반    : match_id 가 있고 direct_* 는 전부 NULL
--   2) 다이렉트 채팅: match_id 가 NULL 이고 direct_*_post_id + initiator_user_id 가 채워짐
-- (게시글에서 작성자에게 바로 말 거는 경로. Match 를 만들지 않는다.)
CREATE TABLE IF NOT EXISTS ChatRoom (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id INTEGER UNIQUE REFERENCES "Match"(id) ON DELETE CASCADE,
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

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_nickname ON User(nickname);
CREATE INDEX IF NOT EXISTS idx_lostpost_user_id ON LostPost(user_id);
CREATE INDEX IF NOT EXISTS idx_foundpost_user_id ON FoundPost(user_id);
CREATE INDEX IF NOT EXISTS idx_match_lost_post_id ON "Match"(lost_post_id);
CREATE INDEX IF NOT EXISTS idx_match_found_post_id ON "Match"(found_post_id);
CREATE INDEX IF NOT EXISTS idx_message_chat_room_id ON Message(chat_room_id);
CREATE INDEX IF NOT EXISTS idx_message_chat_room_created_id ON Message(chat_room_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_report_reporter_user_id ON Report(reporter_user_id);
CREATE INDEX IF NOT EXISTS idx_report_status ON Report(status);
CREATE INDEX IF NOT EXISTS idx_notification_user_read_created ON Notification(user_id, is_read, created_at DESC);
-- 다이렉트 채팅방의 (게시물, 개설자) 중복 방지. 매칭 기반 방은 direct_* 가 NULL 이라 제외된다.
CREATE UNIQUE INDEX IF NOT EXISTS idx_chatroom_direct_lost_unique
    ON ChatRoom(direct_lost_post_id, initiator_user_id) WHERE direct_lost_post_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_chatroom_direct_found_unique
    ON ChatRoom(direct_found_post_id, initiator_user_id) WHERE direct_found_post_id IS NOT NULL;
`;

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.exec(SCHEMA);

export { db };

/** 개발용: 모든 테이블을 지우고 스키마를 다시 만든다 (npm run db:reset). */
export function resetDatabase() {
  const tables = ['Notification', 'ModerationAction', 'Report', 'Message', 'ChatRoom',
    '"Match"', 'FoundPost', 'LostPost', 'User'];
  db.pragma('foreign_keys = OFF');
  for (const t of tables) db.exec(`DROP TABLE IF EXISTS ${t}`);
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
}

const isUniqueViolation = (e) => String(e?.code || '').startsWith('SQLITE_CONSTRAINT');

// ---------------------------------------------------------------- User

export function createUser(email, name) {
  return db.prepare('INSERT INTO User (email, name) VALUES (?, ?)').run(email, name).lastInsertRowid;
}

export function getUserById(userId) {
  return db.prepare('SELECT * FROM User WHERE id = ?').get(userId) ?? null;
}

export function getUserByEmail(email) {
  return db.prepare('SELECT * FROM User WHERE email = ?').get(email) ?? null;
}

/** 인증된 이메일에 해당하는 User 행을 가져오거나 새로 만들고 id 를 돌려준다. */
export function resolveUserId(email, name) {
  const existing = getUserByEmail(email);
  if (existing) return existing.id;
  return createUser(email, name || email.split('@')[0]);
}

/**
 * 현재 "실제로 유효한" 정지 상태인지. 영구 정지(suspended_until IS NULL)이거나
 * 기한부 정지가 아직 안 끝났으면 true. 기한이 지난 정지는 행을 되돌려 쓰지 않고
 * 읽는 시점에 "정지 아님"으로 계산만 한다 (감사 기록은 그대로 남긴다).
 */
export function isUserSuspended(userId) {
  const user = getUserById(userId);
  if (!user || !user.is_suspended) return false;
  if (user.suspended_until === null) return true; // 영구 정지
  const row = db.prepare("SELECT ? > datetime('now') AS still_suspended").get(user.suspended_until);
  return Boolean(row.still_suspended);
}

/**
 * 정지된 사용자의 *새로운* 글/상호작용을 막는다. 기존 데이터 열람(목록/상세 조회)은
 * 영향이 없고, 새 행을 만드는 함수들만 이걸 호출한다.
 */
function requireNotSuspended(userId) {
  if (isUserSuspended(userId)) throw new PermissionDeniedError(SUSPENDED_ACCOUNT_MESSAGE);
}

/**
 * 공개용 고정 닉네임을 딱 한 번만 설정한다. 변경 함수는 일부러 없다.
 * "아직 미설정일 때만"이라는 보장은 UPDATE 의 WHERE nickname IS NULL 이 원자적으로 해준다.
 */
export function setInitialNickname(userId, nicknameRaw) {
  const user = getUserById(userId);
  if (!user) throw new ValidationError(`User ${userId} not found`);
  if (user.nickname !== null) throw new ValidationError('닉네임은 이미 설정되어 변경할 수 없습니다.');

  const nickname = String(nicknameRaw ?? '').trim();
  if (nickname.length < NICKNAME_MIN_LENGTH || nickname.length > NICKNAME_MAX_LENGTH) {
    throw new ValidationError(`닉네임은 ${NICKNAME_MIN_LENGTH}~${NICKNAME_MAX_LENGTH}자여야 합니다.`);
  }
  if (!NICKNAME_RE.test(nickname)) {
    throw new ValidationError('닉네임은 한글/영문/숫자만 사용할 수 있습니다.');
  }

  try {
    const info = db.prepare('UPDATE User SET nickname = ? WHERE id = ? AND nickname IS NULL')
      .run(nickname, userId);
    if (info.changes === 0) throw new ValidationError('닉네임은 이미 설정되어 변경할 수 없습니다.');
  } catch (e) {
    if (isUniqueViolation(e)) throw new ValidationError('이미 사용 중인 닉네임입니다.');
    throw e;
  }
}

// ------------------------------------------------------- LostPost / FoundPost
//
// 파이썬 원본은 lost/found 용 함수를 미러링해서 두 벌 갖고 있었다.
// 여기서는 두 테이블의 차이가 (테이블명, 시각 컬럼명, 허용 상태값) 세 개뿐이라
// 그 셋만 담은 설정 객체로 한 벌만 구현한다 -- 동작은 완전히 동일하다.
const POST_KINDS = {
  lost: { table: 'LostPost', dateField: 'lost_at', statuses: LOST_STATUSES, defaultStatus: '찾는 중' },
  found: { table: 'FoundPost', dateField: 'found_at', statuses: FOUND_STATUSES, defaultStatus: '보관 중' },
};

export function postKindConfig(kind) {
  const cfg = POST_KINDS[kind];
  if (!cfg) throw new ValidationError(`invalid post kind: ${kind}`);
  return cfg;
}

export function createPost(kind, {
  userId, title, description, category, location, at, imageUrl = null, status = null,
}) {
  const cfg = postKindConfig(kind);
  requireNotSuspended(userId);
  const finalStatus = status ?? cfg.defaultStatus;
  if (!cfg.statuses.has(finalStatus)) throw new ValidationError(`invalid status: ${finalStatus}`);
  validateDatetime(at, cfg.dateField);
  return db.prepare(
    `INSERT INTO ${cfg.table} (user_id, title, description, category, location, ${cfg.dateField}, image_url, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(userId, title, description, category, location, at, imageUrl, finalStatus).lastInsertRowid;
}

export function getPost(kind, postId) {
  const cfg = postKindConfig(kind);
  const row = db.prepare(
    `SELECT p.*, u.nickname AS author_nickname
     FROM ${cfg.table} p JOIN User u ON u.id = p.user_id
     WHERE p.id = ?`
  ).get(postId) ?? null;
  return row ? { ...row, kind } : null;
}

/** 키워드/카테고리/상태 필터. 셋 다 비우면 전체 목록이 된다. */
export function searchPosts(kind, { keyword = '', category = null, status = null } = {}) {
  const cfg = postKindConfig(kind);
  const conditions = [];
  const params = [];
  if (keyword) {
    conditions.push('(p.title LIKE ? OR p.description LIKE ?)');
    params.push(`%${keyword}%`, `%${keyword}%`);
  }
  if (category) { conditions.push('p.category = ?'); params.push(category); }
  if (status) { conditions.push('p.status = ?'); params.push(status); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = db.prepare(
    `SELECT p.*, u.nickname AS author_nickname
     FROM ${cfg.table} p JOIN User u ON u.id = p.user_id
     ${where}
     ORDER BY p.created_at DESC`
  ).all(...params);
  return rows.map((r) => ({ ...r, kind }));
}

export function listPostsByUser(kind, userId) {
  const cfg = postKindConfig(kind);
  return db.prepare(`SELECT * FROM ${cfg.table} WHERE user_id = ? ORDER BY created_at DESC`)
    .all(userId).map((r) => ({ ...r, kind }));
}

function checkPostOwner(kind, postId, requestingUserId) {
  const post = getPost(kind, postId);
  if (!post) throw new ValidationError(`게시물을 찾을 수 없습니다. (${kind} #${postId})`);
  if (post.user_id !== requestingUserId) {
    throw new PermissionDeniedError('본인 게시물만 수정/삭제할 수 있습니다.');
  }
  return post;
}

// 분실/습득 시각은 원본 UI와 동일하게 수정 대상에서 제외한다(삭제 후 재등록 안내).
const UPDATABLE_POST_FIELDS = new Set(['title', 'description', 'category', 'location', 'image_url', 'status']);

export function updatePost(kind, postId, requestingUserId, fields) {
  const cfg = postKindConfig(kind);
  checkPostOwner(kind, postId, requestingUserId);

  const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
  for (const [col] of entries) {
    if (!UPDATABLE_POST_FIELDS.has(col)) throw new ValidationError(`수정할 수 없는 항목입니다: ${col}`);
  }
  const statusEntry = entries.find(([c]) => c === 'status');
  if (statusEntry && !cfg.statuses.has(statusEntry[1])) {
    throw new ValidationError(`invalid status: ${statusEntry[1]}`);
  }
  if (!entries.length) return;

  const setClause = entries.map(([col]) => `${col} = ?`).join(', ');
  db.prepare(`UPDATE ${cfg.table} SET ${setClause}, updated_at = datetime('now') WHERE id = ?`)
    .run(...entries.map(([, v]) => v), postId);
}

export function deletePost(kind, postId, requestingUserId) {
  const cfg = postKindConfig(kind);
  checkPostOwner(kind, postId, requestingUserId);
  db.prepare(`DELETE FROM ${cfg.table} WHERE id = ?`).run(postId);
}

// ---------------------------------------------------------------- Match

export function getMatchByPosts(lostPostId, foundPostId) {
  return db.prepare('SELECT * FROM "Match" WHERE lost_post_id = ? AND found_post_id = ?')
    .get(lostPostId, foundPostId) ?? null;
}

export function getMatch(matchId) {
  return db.prepare('SELECT * FROM "Match" WHERE id = ?').get(matchId) ?? null;
}

/**
 * LostPost <-> FoundPost 매칭을 get-or-create.
 * requestingUserId 는 둘 중 한쪽 게시물의 작성자여야 한다(양쪽 다 확정 가능).
 * 멱등: 이미 있으면 기존 id 를 그대로 돌려주고 알림도 다시 만들지 않는다.
 * 성공 시 두 게시물 소유자 각각에게 'match' 알림이 같은 트랜잭션 안에서 생성된다.
 */
export function createMatch(lostPostId, foundPostId, score, requestingUserId) {
  requireNotSuspended(requestingUserId);
  const lostPost = getPost('lost', lostPostId);
  if (!lostPost) throw new ValidationError(`찾아요 게시물 #${lostPostId} 을(를) 찾을 수 없습니다.`);
  const foundPost = getPost('found', foundPostId);
  if (!foundPost) throw new ValidationError(`찾았어요 게시물 #${foundPostId} 을(를) 찾을 수 없습니다.`);
  if (![lostPost.user_id, foundPost.user_id].includes(requestingUserId)) {
    throw new PermissionDeniedError('본인 게시물에 대해서만 매칭을 확정할 수 있습니다.');
  }

  const existing = getMatchByPosts(lostPostId, foundPostId);
  if (existing) return existing.id;

  try {
    return db.transaction(() => {
      const matchId = db.prepare('INSERT INTO "Match" (lost_post_id, found_post_id, score) VALUES (?, ?, ?)')
        .run(lostPostId, foundPostId, score).lastInsertRowid;
      for (const participantId of new Set([lostPost.user_id, foundPost.user_id])) {
        insertNotification(participantId, 'match', '새로운 매칭이 성립되었습니다',
          'AI 매칭이 확정되어 채팅을 시작할 수 있습니다.', 'match', matchId);
      }
      return matchId;
    })();
  } catch (e) {
    if (isUniqueViolation(e)) {
      const again = getMatchByPosts(lostPostId, foundPostId);
      if (again) return again.id;
    }
    throw e;
  }
}

/**
 * user_id 가 분실물 쪽 또는 습득물 쪽 소유자인 매칭 목록.
 * 관련 게시물 필드를 한 쿼리에 조인해서 매칭당 추가 조회(N+1)를 없앴고,
 * 안 읽은 메시지 수도 같은 쿼리에서 센다.
 */
export function listMatchesByUser(userId) {
  return db.prepare(`
    SELECT
      m.id AS match_id, m.score AS score, m.created_at AS match_created_at,
      lp.id AS lost_post_id, lp.user_id AS lost_post_user_id, lp.title AS lost_title,
      lp.category AS lost_category, lp.location AS lost_location, lp.lost_at AS lost_at,
      lp.status AS lost_status, lp.image_url AS lost_image_url, lu.nickname AS lost_user_nickname,
      fp.id AS found_post_id, fp.user_id AS found_post_user_id, fp.title AS found_title,
      fp.category AS found_category, fp.location AS found_location, fp.found_at AS found_at,
      fp.status AS found_status, fp.image_url AS found_image_url, fu.nickname AS found_user_nickname,
      (
        SELECT COUNT(*) FROM Message msg
        JOIN ChatRoom cr ON cr.id = msg.chat_room_id
        WHERE cr.match_id = m.id AND msg.sender_user_id != ? AND msg.read_at IS NULL
      ) AS unread_count
    FROM "Match" m
    JOIN LostPost lp ON lp.id = m.lost_post_id
    JOIN FoundPost fp ON fp.id = m.found_post_id
    JOIN User lu ON lu.id = lp.user_id
    JOIN User fu ON fu.id = fp.user_id
    WHERE lp.user_id = ? OR fp.user_id = ?
    ORDER BY m.created_at DESC
  `).all(userId, userId, userId);
}

/** 확정된 매칭 취소. Match 행만 지우고 게시물(상태 포함)은 건드리지 않는다. */
export function deleteMatch(matchId, requestingUserId) {
  const match = getMatch(matchId);
  if (!match) throw new ValidationError('이미 취소된 매칭입니다.');
  if (!matchParticipantIds(matchId).has(requestingUserId)) {
    throw new PermissionDeniedError('본인과 관련된 매칭만 취소할 수 있습니다.');
  }
  db.prepare('DELETE FROM "Match" WHERE id = ?').run(matchId);
}

// ---------------------------------------------------------------- Chat

/** 매칭 채팅방 참여자: 분실물 작성자 + 습득물 작성자. 매번 게시물에서 새로 계산한다. */
function matchParticipantIds(matchId) {
  const match = getMatch(matchId);
  if (!match) throw new ValidationError(`매칭 #${matchId} 을(를) 찾을 수 없습니다.`);
  const lostPost = getPost('lost', match.lost_post_id);
  const foundPost = getPost('found', match.found_post_id);
  return new Set([lostPost, foundPost].filter(Boolean).map((p) => p.user_id));
}

/**
 * 다이렉트(Match 없는) 채팅방 참여자: 개설자 + 게시물의 현재 작성자.
 * 게시물이 이미 삭제됐다면 개설자만 남는다(방어적 처리).
 */
function directChatParticipantIds(room) {
  const post = room.direct_lost_post_id !== null
    ? getPost('lost', room.direct_lost_post_id)
    : getPost('found', room.direct_found_post_id);
  const ids = new Set([room.initiator_user_id]);
  if (post) ids.add(post.user_id);
  return ids;
}

/** 두 종류의 방을 하나로 처리하는 진입점 -- 모든 채팅 권한 검사가 여기를 지난다. */
function chatRoomParticipantIds(room) {
  return room.match_id !== null ? matchParticipantIds(room.match_id) : directChatParticipantIds(room);
}

/** Match 하나당 ChatRoom 하나를 get-or-create. 참여자만 열 수 있다. */
export function getOrCreateChatRoom(matchId, requestingUserId) {
  if (!matchParticipantIds(matchId).has(requestingUserId)) {
    throw new PermissionDeniedError('본인과 관련된 매칭만 채팅할 수 있습니다.');
  }
  const find = () => db.prepare('SELECT * FROM ChatRoom WHERE match_id = ?').get(matchId) ?? null;
  const existing = find();
  if (existing) return existing;
  try {
    db.prepare('INSERT INTO ChatRoom (match_id) VALUES (?)').run(matchId);
  } catch (e) {
    if (!isUniqueViolation(e)) throw e; // 경합에서 졌을 뿐 -- 아래 재조회가 주워온다
  }
  const room = find();
  if (!room) throw new Error(`Failed to create ChatRoom for Match ${matchId}`);
  return room;
}

/**
 * 게시판 뷰어가 게시물 작성자에게 바로 말을 거는 다이렉트 채팅방 get-or-create.
 * Match 를 거치지 않는다. 검사 순서: 실존 유저 -> 정지 아님 -> 게시물 존재 -> 자기 글 아님.
 * 멱등: 같은 (게시물, 개설자) 조합이면 기존 방을 돌려준다(부분 UNIQUE 인덱스가 뒷받침).
 */
export function getOrCreateDirectChatRoom(postKind, postId, requestingUserId) {
  if (!getUserById(requestingUserId)) throw new ValidationError(`User ${requestingUserId} not found`);
  requireNotSuspended(requestingUserId);

  postKindConfig(postKind); // 잘못된 kind 면 여기서 ValidationError
  const column = postKind === 'lost' ? 'direct_lost_post_id' : 'direct_found_post_id';
  const post = getPost(postKind, postId);
  if (!post) throw new ValidationError('게시물을 찾을 수 없습니다.');
  if (post.user_id === requestingUserId) {
    throw new PermissionDeniedError('자기 자신의 게시물에는 채팅을 시작할 수 없습니다.');
  }

  const find = () => db.prepare(`SELECT * FROM ChatRoom WHERE ${column} = ? AND initiator_user_id = ?`)
    .get(postId, requestingUserId) ?? null;
  const existing = find();
  if (existing) return existing;
  try {
    db.prepare(`INSERT INTO ChatRoom (${column}, initiator_user_id) VALUES (?, ?)`)
      .run(postId, requestingUserId);
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
  }
  const room = find();
  if (!room) throw new Error(`Failed to create direct ChatRoom for ${postKind} post ${postId}`);
  return room;
}

/** 참여자에게만 ChatRoom 행을 돌려준다. 클라이언트가 보낸 room id 를 절대 그대로 믿지 않는다. */
export function getChatRoom(chatRoomId, requestingUserId) {
  const room = db.prepare('SELECT * FROM ChatRoom WHERE id = ?').get(chatRoomId) ?? null;
  if (!room) throw new ValidationError('존재하지 않거나 삭제된 채팅방입니다.');
  if (!chatRoomParticipantIds(room).has(requestingUserId)) {
    throw new PermissionDeniedError('이 채팅방에 접근할 권한이 없습니다.');
  }
  return room;
}

/**
 * 채팅방 헤더에 필요한 정보 (pages/5_채팅.py 상단 로직의 포팅).
 * 매칭 방이면 내/상대 게시물 라벨 + AI 점수를, 다이렉트 방이면 게시물 제목을 만든다.
 */
export function getChatRoomView(chatRoomId, requestingUserId) {
  const room = getChatRoom(chatRoomId, requestingUserId);
  let myPostLabel;
  let otherPostLabel;
  let otherUserId = null;
  let score = null;

  if (room.match_id !== null) {
    const match = listMatchesByUser(requestingUserId).find((m) => m.match_id === room.match_id);
    if (!match) throw new ValidationError('연결된 매칭 정보를 찾을 수 없습니다.');
    if (match.lost_post_user_id === requestingUserId) {
      myPostLabel = `내 분실물: ${match.lost_title}`;
      otherPostLabel = `상대 습득물: ${match.found_title}`;
      otherUserId = match.found_post_user_id;
    } else {
      myPostLabel = `내 습득물: ${match.found_title}`;
      otherPostLabel = `상대 분실물: ${match.lost_title}`;
      otherUserId = match.lost_post_user_id;
    }
    score = match.score;
  } else {
    const isLost = room.direct_lost_post_id !== null;
    const post = isLost
      ? getPost('lost', room.direct_lost_post_id)
      : getPost('found', room.direct_found_post_id);
    otherPostLabel = post ? `${isLost ? '찾아요' : '찾았어요'} 게시물: ${post.title}` : '삭제된 게시물';
    if (room.initiator_user_id === requestingUserId) {
      myPostLabel = '직접 문의한 채팅';
      otherUserId = post ? post.user_id : null;
    } else {
      myPostLabel = '내 게시물에 대한 문의';
      otherUserId = room.initiator_user_id;
    }
  }

  const otherUser = otherUserId ? getUserById(otherUserId) : null;
  return {
    id: room.id,
    roomType: room.match_id !== null ? 'match' : 'direct',
    myPostLabel,
    otherPostLabel,
    otherUserId,
    otherNickname: otherUser ? otherUser.nickname : '상대방',
    score,
  };
}

/**
 * 커서 기반 페이지네이션(OFFSET 아님)으로 메시지를 오래된순으로 돌려준다.
 * beforeId 를 주면 그보다 id 가 작은(= 더 오래된) 메시지 중 최신 limit 개.
 * created_at 은 초 단위라 정렬의 2차 키는 항상 id DESC 다.
 * 관리자가 숨긴 메시지는 내용이 HIDDEN_MESSAGE_PLACEHOLDER 로 바뀌어 나간다
 * (실제 내용은 지우지 않는다 -- 관리자 화면에서는 원문이 보인다).
 */
export function listMessages(chatRoomId, requestingUserId, limit = MESSAGE_PAGE_SIZE, beforeId = null) {
  getChatRoom(chatRoomId, requestingUserId);
  if (!Number.isInteger(limit) || limit <= 0) throw new ValidationError(`invalid limit: ${limit}`);
  if (beforeId !== null && (!Number.isInteger(beforeId) || beforeId <= 0)) {
    throw new ValidationError(`invalid before_id: ${beforeId}`);
  }

  const conditions = ['m.chat_room_id = ?'];
  const params = [chatRoomId];
  if (beforeId !== null) { conditions.push('m.id < ?'); params.push(beforeId); }
  params.push(limit);

  const rows = db.prepare(`
    SELECT m.id, m.chat_room_id, m.sender_user_id, m.content, m.created_at, m.read_at, m.hidden_at,
           u.nickname AS sender_nickname
    FROM Message m JOIN User u ON u.id = m.sender_user_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY m.created_at DESC, m.id DESC
    LIMIT ?
  `).all(...params);

  // DB는 최신순 -> 화면에 위에서 아래로 뿌리기 좋게 오래된순으로 뒤집는다.
  return rows.reverse().map((row) => ({
    ...row,
    content: row.hidden_at ? HIDDEN_MESSAGE_PLACEHOLDER : row.content,
  }));
}

export function getMessage(messageId) {
  return db.prepare('SELECT * FROM Message WHERE id = ?').get(messageId) ?? null;
}

/**
 * 보낸 사람은 언제나 검증된 요청자다 -- 클라이언트가 넘긴 id 를 쓰지 않는다.
 * 성공 시 *상대방에게만* 'message' 알림이 같은 트랜잭션으로 생성된다.
 * related_id 가 chat_room_id 가 아니라 새 message id 라서, 같은 방의 서로 다른
 * 메시지가 UNIQUE 제약에 걸려 뭉개지지 않는다.
 */
export function sendMessage(chatRoomId, requestingUserId, contentRaw) {
  const room = getChatRoom(chatRoomId, requestingUserId);
  requireNotSuspended(requestingUserId);

  const content = String(contentRaw ?? '').trim();
  if (!content) throw new ValidationError('빈 메시지는 보낼 수 없습니다.');

  const others = [...chatRoomParticipantIds(room)].filter((id) => id !== requestingUserId);
  const otherUserId = others.length ? others[0] : null;

  return db.transaction(() => {
    const messageId = db.prepare(
      'INSERT INTO Message (chat_room_id, sender_user_id, content) VALUES (?, ?, ?)'
    ).run(chatRoomId, requestingUserId, content).lastInsertRowid;
    if (otherUserId !== null) {
      const sender = getUserById(requestingUserId);
      insertNotification(otherUserId, 'message', '새 메시지가 도착했습니다',
        `${sender.nickname}님이 메시지를 보냈습니다.`, 'message', messageId);
    }
    return getMessage(messageId);
  })();
}

/** 상대방이 보낸 안 읽은 메시지만 읽음 처리한다. 내 메시지는 건드리지 않는다. */
export function markMessagesAsRead(chatRoomId, requestingUserId) {
  getChatRoom(chatRoomId, requestingUserId);
  return db.prepare(`
    UPDATE Message SET read_at = datetime('now')
    WHERE chat_room_id = ? AND sender_user_id != ? AND read_at IS NULL
  `).run(chatRoomId, requestingUserId).changes;
}

/** 채팅방에 실제로 들어왔을 때, 그 방의 'message' 알림도 같이 읽음 처리한다. */
export function markMessageNotificationsAsReadForChatRoom(chatRoomId, requestingUserId) {
  getChatRoom(chatRoomId, requestingUserId);
  return db.prepare(`
    UPDATE Notification SET is_read = 1
    WHERE user_id = ? AND type = 'message' AND related_type = 'message' AND is_read = 0
      AND related_id IN (SELECT id FROM Message WHERE chat_room_id = ?)
  `).run(requestingUserId, chatRoomId).changes;
}

/**
 * 내가 참여 중인 모든 방(매칭/다이렉트)의 안 읽은 메시지 총합.
 * 매칭 방은 ma.* 가, 다이렉트 방은 cr.direct_* 가 채워지므로 COALESCE 한쪽만 기여한다.
 */
export function countUnreadMessagesByUser(userId) {
  return db.prepare(`
    SELECT COUNT(*) AS unread_count
    FROM Message m
    JOIN ChatRoom cr ON cr.id = m.chat_room_id
    LEFT JOIN "Match" ma ON ma.id = cr.match_id
    LEFT JOIN LostPost lp ON lp.id = COALESCE(ma.lost_post_id, cr.direct_lost_post_id)
    LEFT JOIN FoundPost fp ON fp.id = COALESCE(ma.found_post_id, cr.direct_found_post_id)
    WHERE (lp.user_id = ? OR fp.user_id = ? OR cr.initiator_user_id = ?)
      AND m.sender_user_id != ? AND m.read_at IS NULL
  `).get(userId, userId, userId, userId).unread_count;
}

const CHAT_ROOM_LAST_MESSAGE_SUBQUERY = `
  SELECT id, chat_room_id, content, created_at, hidden_at,
         ROW_NUMBER() OVER (PARTITION BY chat_room_id ORDER BY created_at DESC, id DESC) AS rn
  FROM Message
`;

/**
 * 내가 참여 중인 채팅방 목록. 매칭 방과 다이렉트 방은 컬럼 모양이 달라서
 * 하나의 UNION 대신 두 쿼리로 조회한 뒤 JS 에서 합친다(원본과 동일한 판단).
 * 모든 행에 room_type / other_nickname / post_title 을 통일해 채워주므로
 * 화면 쪽은 종류별 분기 없이 카드 하나로 그릴 수 있다.
 * 마지막 메시지가 관리자에 의해 숨겨졌다면 미리보기도 같이 가려진다.
 */
export function listChatRoomsByUser(userId) {
  const matchRows = db.prepare(`
    SELECT cr.id AS chat_room_id, cr.match_id, cr.created_at AS chat_room_created_at,
           m.score AS score,
           lp.id AS lost_post_id, lp.user_id AS lost_post_user_id, lp.title AS lost_title,
           lu.nickname AS lost_user_nickname,
           fp.id AS found_post_id, fp.user_id AS found_post_user_id, fp.title AS found_title,
           fu.nickname AS found_user_nickname,
           lm.content AS last_message_content, lm.created_at AS last_message_created_at,
           lm.id AS last_message_id, lm.hidden_at AS last_message_hidden_at,
           (SELECT COUNT(*) FROM Message msg
             WHERE msg.chat_room_id = cr.id AND msg.sender_user_id != ? AND msg.read_at IS NULL) AS unread_count
    FROM ChatRoom cr
    JOIN "Match" m ON m.id = cr.match_id
    JOIN LostPost lp ON lp.id = m.lost_post_id
    JOIN FoundPost fp ON fp.id = m.found_post_id
    JOIN User lu ON lu.id = lp.user_id
    JOIN User fu ON fu.id = fp.user_id
    LEFT JOIN (${CHAT_ROOM_LAST_MESSAGE_SUBQUERY}) lm ON lm.chat_room_id = cr.id AND lm.rn = 1
    WHERE lp.user_id = ? OR fp.user_id = ?
  `).all(userId, userId, userId);

  const directRows = db.prepare(`
    SELECT cr.id AS chat_room_id, cr.created_at AS chat_room_created_at,
           cr.initiator_user_id, iu.nickname AS initiator_nickname,
           COALESCE(dlp.title, dfp.title) AS direct_post_title,
           COALESCE(dlp.user_id, dfp.user_id) AS direct_post_owner_id,
           ou.nickname AS direct_post_owner_nickname,
           lm.content AS last_message_content, lm.created_at AS last_message_created_at,
           lm.id AS last_message_id, lm.hidden_at AS last_message_hidden_at,
           (SELECT COUNT(*) FROM Message msg
             WHERE msg.chat_room_id = cr.id AND msg.sender_user_id != ? AND msg.read_at IS NULL) AS unread_count
    FROM ChatRoom cr
    LEFT JOIN LostPost dlp ON dlp.id = cr.direct_lost_post_id
    LEFT JOIN FoundPost dfp ON dfp.id = cr.direct_found_post_id
    JOIN User iu ON iu.id = cr.initiator_user_id
    LEFT JOIN User ou ON ou.id = COALESCE(dlp.user_id, dfp.user_id)
    LEFT JOIN (${CHAT_ROOM_LAST_MESSAGE_SUBQUERY}) lm ON lm.chat_room_id = cr.id AND lm.rn = 1
    WHERE cr.match_id IS NULL AND (cr.initiator_user_id = ? OR dlp.user_id = ? OR dfp.user_id = ?)
  `).all(userId, userId, userId, userId);

  const results = [];
  for (const row of matchRows) {
    const item = { ...row, room_type: 'match' };
    if (item.lost_post_user_id === userId) {
      item.other_user_id = item.found_post_user_id;
      item.other_nickname = item.found_user_nickname;
    } else {
      item.other_user_id = item.lost_post_user_id;
      item.other_nickname = item.lost_user_nickname;
    }
    results.push(item);
  }
  for (const row of directRows) {
    const item = { ...row, room_type: 'direct' };
    // 게시물이 삭제됐는데 아직 CASCADE 되지 않은 아주 짧은 경합 구간 방어.
    item.post_title = item.direct_post_title || '삭제된 게시물';
    if (item.initiator_user_id === userId) {
      item.other_user_id = item.direct_post_owner_id;
      item.other_nickname = item.direct_post_owner_nickname || '상대방';
    } else {
      item.other_user_id = item.initiator_user_id;
      item.other_nickname = item.initiator_nickname;
    }
    results.push(item);
  }
  for (const item of results) {
    if (item.last_message_hidden_at) item.last_message_content = HIDDEN_MESSAGE_PLACEHOLDER;
  }

  // 마지막 메시지 최신순, 메시지가 없는 방은 그 뒤에 방 생성일 최신순.
  const withMsg = results.filter((i) => i.last_message_created_at !== null);
  const withoutMsg = results.filter((i) => i.last_message_created_at === null);
  withMsg.sort((a, b) => (
    b.last_message_created_at.localeCompare(a.last_message_created_at)
    || (b.last_message_id || 0) - (a.last_message_id || 0)
  ));
  withoutMsg.sort((a, b) => b.chat_room_created_at.localeCompare(a.chat_room_created_at));
  return [...withMsg, ...withoutMsg];
}

// ---------------------------------------------------------------- Report

/**
 * target_type="post" 은 LostPost/FoundPost 를 구분하지 않는 스키마다.
 * 두 테이블의 id 는 각각 1부터 시작하는 별개 시퀀스라 같은 숫자가 서로 다른
 * 게시물을 가리키는 게 흔한 일이므로, 부호로 어느 테이블인지 인코딩한다:
 *   양수 target_id = LostPost id,  음수 target_id = -(FoundPost id)
 */
function validateReportTarget(targetType, targetId, reporterUserId) {
  if (targetType === 'post') {
    let post = null;
    if (targetId > 0) post = getPost('lost', targetId);
    else if (targetId < 0) post = getPost('found', -targetId);
    if (!post) throw new ValidationError('신고 대상 게시물을 찾을 수 없습니다.');
    if (post.user_id === reporterUserId) throw new ValidationError('자신이 작성한 게시물은 신고할 수 없습니다.');
  } else if (targetType === 'message') {
    const message = getMessage(targetId);
    if (!message) throw new ValidationError('신고 대상 메시지를 찾을 수 없습니다.');
    if (message.sender_user_id === reporterUserId) throw new ValidationError('자신이 보낸 메시지는 신고할 수 없습니다.');
  } else {
    const targetUser = getUserById(targetId);
    if (!targetUser) throw new ValidationError('신고 대상 사용자를 찾을 수 없습니다.');
    if (targetId === reporterUserId) throw new ValidationError('자기 자신을 신고할 수 없습니다.');
  }
}

/** 신고 접수. 검증은 전부 여기서 한다(화면 쪽에 중복 로직을 두지 않는다). */
export function createReport(reporterUserId, targetType, targetId, reasonRaw, detailRaw = null) {
  if (!getUserById(reporterUserId)) throw new ValidationError(`User ${reporterUserId} not found`);
  if (!REPORT_TARGET_TYPES.has(targetType)) throw new ValidationError(`invalid target_type: ${targetType}`);

  const reason = String(reasonRaw ?? '').trim();
  if (!reason) throw new ValidationError('신고 사유를 입력해주세요.');
  const detail = String(detailRaw ?? '').trim() || null;

  validateReportTarget(targetType, targetId, reporterUserId);

  const existing = db.prepare(
    'SELECT id FROM Report WHERE reporter_user_id = ? AND target_type = ? AND target_id = ?'
  ).get(reporterUserId, targetType, targetId);
  if (existing) throw new ValidationError('이미 신고한 대상입니다.');

  try {
    return db.prepare(
      'INSERT INTO Report (reporter_user_id, target_type, target_id, reason, detail) VALUES (?, ?, ?, ?, ?)'
    ).run(reporterUserId, targetType, targetId, reason, detail).lastInsertRowid;
  } catch (e) {
    if (isUniqueViolation(e)) throw new ValidationError('이미 신고한 대상입니다.');
    throw e;
  }
}

export function getReport(reportId) {
  return db.prepare('SELECT * FROM Report WHERE id = ?').get(reportId) ?? null;
}

// ---------------------------------------------------------------- Admin

/** DB에서 매번 다시 읽는 관리자 확인. 화면/세션이 주장하는 값은 절대 믿지 않는다. */
export function isAdmin(userId) {
  const user = getUserById(userId);
  return Boolean(user && user.is_admin);
}

function requireAdmin(requestingUserId) {
  const user = getUserById(requestingUserId);
  if (!user) throw new PermissionDeniedError('Admin check failed: user not found');
  if (!user.is_admin) throw new PermissionDeniedError('관리자 권한이 필요합니다.');
}

/** 신고 목록 한 페이지의 대상들을 테이블별 IN 쿼리 한 번씩으로 모아 온다(N+1 방지). */
function batchFetchReportTargets(reports) {
  const lostIds = new Set();
  const foundIds = new Set();
  const messageIds = new Set();
  const userIds = new Set();
  for (const r of reports) {
    if (r.target_type === 'post') {
      if (r.target_id > 0) lostIds.add(r.target_id); else foundIds.add(-r.target_id);
    } else if (r.target_type === 'message') messageIds.add(r.target_id);
    else userIds.add(r.target_id);
  }
  const toMap = (rows) => new Map(rows.map((row) => [row.id, row]));
  const qm = (s) => Array(s.size).fill('?').join(',');

  return {
    lost: lostIds.size ? toMap(db.prepare(
      `SELECT lp.*, u.nickname AS author_nickname FROM LostPost lp JOIN User u ON u.id = lp.user_id
       WHERE lp.id IN (${qm(lostIds)})`).all(...lostIds)) : new Map(),
    found: foundIds.size ? toMap(db.prepare(
      `SELECT fp.*, u.nickname AS author_nickname FROM FoundPost fp JOIN User u ON u.id = fp.user_id
       WHERE fp.id IN (${qm(foundIds)})`).all(...foundIds)) : new Map(),
    message: messageIds.size ? toMap(db.prepare(
      `SELECT m.*, u.nickname AS sender_nickname FROM Message m JOIN User u ON u.id = m.sender_user_id
       WHERE m.id IN (${qm(messageIds)})`).all(...messageIds)) : new Map(),
    user: userIds.size ? toMap(db.prepare(
      `SELECT * FROM User WHERE id IN (${qm(userIds)})`).all(...userIds)) : new Map(),
  };
}

/** 신고 1건의 관리자용 대상 요약. 대상이 이미 삭제됐으면 null. 닉네임만 노출한다. */
function reportTargetInfo(report, maps) {
  if (report.target_type === 'post') {
    const isLost = report.target_id > 0;
    const post = isLost ? maps.lost.get(report.target_id) : maps.found.get(-report.target_id);
    if (!post) return null;
    return {
      post_kind: isLost ? 'lost' : 'found',
      title: post.title,
      description: post.description,
      category: post.category,
      location: post.location,
      status: post.status,
      author_nickname: post.author_nickname,
      created_at: post.created_at,
    };
  }
  if (report.target_type === 'message') {
    const msg = maps.message.get(report.target_id);
    if (!msg) return null;
    return {
      content: msg.content,
      sender_nickname: msg.sender_nickname,
      created_at: msg.created_at,
      chat_room_id: msg.chat_room_id,
    };
  }
  const user = maps.user.get(report.target_id);
  return user ? { nickname: user.nickname } : null;
}

function batchFetchModerationActions(reportIds) {
  if (!reportIds.length) return new Map();
  const qm = Array(reportIds.length).fill('?').join(',');
  const rows = db.prepare(
    `SELECT ma.*, u.nickname AS admin_nickname FROM ModerationAction ma
     JOIN User u ON u.id = ma.admin_user_id WHERE ma.report_id IN (${qm})`
  ).all(...reportIds);
  return new Map(rows.map((r) => [r.report_id, r]));
}

export function getModerationActionForReport(reportId) {
  return db.prepare('SELECT * FROM ModerationAction WHERE report_id = ?').get(reportId) ?? null;
}

/**
 * 관리자 전용 신고 목록. 정렬은 항상 처리 대기 먼저, 그 안에서 최신순.
 * 대상 요약(target_info)/조치 내역은 배치 조회라 신고당 추가 쿼리가 없다.
 */
export function listReportsForAdmin(requestingAdminUserId, {
  status = null, targetType = null, limit = 50, offset = 0,
} = {}) {
  requireAdmin(requestingAdminUserId);
  if (status !== null && !REPORT_STATUSES.has(status)) throw new ValidationError(`invalid status: ${status}`);
  if (targetType !== null && !REPORT_TARGET_TYPES.has(targetType)) {
    throw new ValidationError(`invalid target_type: ${targetType}`);
  }

  const conditions = [];
  const params = [];
  if (status !== null) { conditions.push('r.status = ?'); params.push(status); }
  if (targetType !== null) { conditions.push('r.target_type = ?'); params.push(targetType); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const rows = db.prepare(`
    SELECT r.*, ru.nickname AS reporter_nickname, pu.nickname AS processed_by_nickname
    FROM Report r
    JOIN User ru ON ru.id = r.reporter_user_id
    LEFT JOIN User pu ON pu.id = r.processed_by_user_id
    ${where}
    ORDER BY CASE WHEN r.status = 'pending' THEN 0 ELSE 1 END, r.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  const maps = batchFetchReportTargets(rows);
  const actions = batchFetchModerationActions(rows.map((r) => r.id));

  return rows.map((row) => {
    const targetInfo = reportTargetInfo(row, maps);
    return {
      ...row,
      target_deleted: targetInfo === null,
      target_info: targetInfo,
      moderation_action: actions.get(row.id) ?? null,
    };
  });
}

/**
 * 관리자의 검토 결정을 기록한다(제재 없이 반려/처리만).
 * 'pending' 상태에서만 가능하고, 검사+갱신을 하나의 원자적 UPDATE 로 처리해 경합에 안전하다.
 * processed_by_user_id 는 언제나 요청한 관리자 본인이다.
 */
export function processReport(reportId, requestingAdminUserId, status, adminNoteRaw = null) {
  requireAdmin(requestingAdminUserId);
  const report = getReport(reportId);
  if (!report) throw new ValidationError(`Report ${reportId} not found`);
  if (status !== 'dismissed' && status !== 'actioned') throw new ValidationError(`invalid status: ${status}`);
  const adminNote = String(adminNoteRaw ?? '').trim() || null;

  db.transaction(() => {
    const info = db.prepare(`
      UPDATE Report SET status = ?, processed_at = datetime('now'),
                        processed_by_user_id = ?, admin_note = ?
      WHERE id = ? AND status = 'pending'
    `).run(status, requestingAdminUserId, adminNote, reportId);
    if (info.changes === 0) throw new ValidationError('이미 처리된 신고입니다.');

    const content = status === 'dismissed'
      ? '신고하신 내용이 관리자에 의해 반려되었습니다.'
      : '신고하신 내용이 관리자 조치로 처리되었습니다.';
    insertNotification(report.reporter_user_id, 'report_processed',
      '신고 처리 결과가 등록되었습니다', content, 'report', reportId);
  })();
}

/**
 * 신고를 'actioned' 로 처리하면서 실제 제재(게시물 삭제 / 메시지 숨김 / 사용자 정지)까지
 * 하나의 트랜잭션으로 적용한다 -- 둘 다 되거나, 둘 다 안 된다.
 * actionType 은 report.target_type 과 짝이 맞아야 한다(post -> delete_post 등).
 * suspendDurationDays: suspend_user 전용. null 이면 영구 정지.
 */
export function applyReportAction(reportId, requestingAdminUserId, {
  actionType, actionReason = null, adminNote = null, suspendDurationDays = null,
} = {}) {
  requireAdmin(requestingAdminUserId);
  const report = getReport(reportId);
  if (!report) throw new ValidationError(`Report ${reportId} not found`);
  if (!MODERATION_ACTION_TYPES.has(actionType)) throw new ValidationError(`invalid action_type: ${actionType}`);
  if (!TARGET_TYPE_TO_ACTION_TYPES[report.target_type]?.has(actionType)) {
    throw new ValidationError(`${actionType} 은(는) ${report.target_type} 신고에 적용할 수 없습니다.`);
  }
  if (report.status !== 'pending') throw new ValidationError('이미 처리된 신고입니다.');
  if (getModerationActionForReport(reportId)) throw new ValidationError('이미 이 신고에 대한 조치가 존재합니다.');
  if (suspendDurationDays !== null
      && (!Number.isInteger(suspendDurationDays) || suspendDurationDays <= 0)) {
    throw new ValidationError(`invalid suspend_duration_days: ${suspendDurationDays}`);
  }

  const reason = String(actionReason ?? '').trim() || null;
  const note = String(adminNote ?? '').trim() || null;
  const { target_type: targetType, target_id: targetId } = report;

  try {
    return db.transaction(() => {
      let expiresAt = null;

      if (targetType === 'post') {
        const table = targetId > 0 ? 'LostPost' : 'FoundPost';
        const realId = targetId > 0 ? targetId : -targetId;
        const row = db.prepare(`SELECT id, user_id FROM ${table} WHERE id = ?`).get(realId);
        if (!row) throw new ValidationError('대상 게시물이 이미 삭제되었습니다.');
        db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(realId);
        insertNotification(row.user_id, 'post_deleted', '게시물이 삭제되었습니다',
          '신고 접수된 게시물이 관리자 조치로 삭제되었습니다.', 'report', reportId);
      } else if (targetType === 'message') {
        const row = db.prepare('SELECT id, sender_user_id FROM Message WHERE id = ?').get(targetId);
        if (!row) throw new ValidationError('대상 메시지가 이미 삭제되었습니다.');
        db.prepare(`
          UPDATE Message SET hidden_at = datetime('now'), hidden_by_user_id = ?, hidden_reason = ?
          WHERE id = ?
        `).run(requestingAdminUserId, reason, targetId);
        insertNotification(row.sender_user_id, 'message_hidden', '메시지가 숨김 처리되었습니다',
          '작성하신 메시지가 관리자 조치로 숨김 처리되었습니다.', 'report', reportId);
      } else { // user
        const row = db.prepare('SELECT id FROM User WHERE id = ?').get(targetId);
        if (!row) throw new ValidationError('대상 사용자를 찾을 수 없습니다.');
        let suspendDesc = '영구 정지되었습니다.';
        if (suspendDurationDays !== null) {
          expiresAt = db.prepare("SELECT datetime('now', ?) AS until")
            .get(`+${suspendDurationDays} days`).until;
          suspendDesc = `${suspendDurationDays}일 정지되었습니다.`;
        }
        db.prepare('UPDATE User SET is_suspended = 1, suspended_until = ? WHERE id = ?')
          .run(expiresAt, targetId);
        insertNotification(targetId, 'user_suspended', '계정 정지 안내',
          `계정이 ${suspendDesc}`, 'report', reportId);
      }

      const moderationActionId = db.prepare(`
        INSERT INTO ModerationAction
          (report_id, target_type, target_id, action_type, reason, admin_user_id, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(reportId, targetType, targetId, actionType, reason, requestingAdminUserId, expiresAt)
        .lastInsertRowid;

      const info = db.prepare(`
        UPDATE Report SET status = 'actioned', processed_at = datetime('now'),
                          processed_by_user_id = ?, admin_note = ?
        WHERE id = ? AND status = 'pending'
      `).run(requestingAdminUserId, note, reportId);
      if (info.changes === 0) throw new ValidationError('이미 처리된 신고입니다.');

      insertNotification(report.reporter_user_id, 'report_processed',
        '신고 처리 결과가 등록되었습니다', '신고하신 내용이 관리자 조치로 처리되었습니다.', 'report', reportId);

      return moderationActionId;
    })();
  } catch (e) {
    if (isUniqueViolation(e)) throw new ValidationError('이미 이 신고에 대한 조치가 존재합니다.');
    throw e;
  }
}

// ---------------------------------------------------------------- Notification

/**
 * 알림 한 줄 삽입. 호출자가 이미 열어 둔 트랜잭션 안에서 실행되도록 설계됐다
 * -- 알림은 그것을 만든 "진짜 사건"(메시지 발송 / 매칭 / 신고 처리)과 함께
 * 커밋되거나 함께 롤백된다. 그래서 sendMessage / createMatch / processReport /
 * applyReportAction 네 곳만 이 함수를 쓴다.
 * 중복(UNIQUE 충돌)은 예외가 아니라 no-op 으로 처리하고 기존 id 를 돌려준다.
 */
function insertNotification(userId, notificationType, titleRaw, contentRaw, relatedType = null, relatedId = null) {
  if (!NOTIFICATION_TYPES.has(notificationType)) {
    throw new ValidationError(`invalid notification_type: ${notificationType}`);
  }
  const title = String(titleRaw ?? '').trim();
  if (!title) throw new ValidationError('notification title must not be blank');
  const content = String(contentRaw ?? '').trim();
  if (!content) throw new ValidationError('notification content must not be blank');
  if ((relatedType === null) !== (relatedId === null)) {
    throw new ValidationError('related_type 과 related_id 는 둘 다 있거나 둘 다 없어야 합니다.');
  }
  try {
    return db.prepare(`
      INSERT INTO Notification (user_id, type, title, content, related_type, related_id)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(userId, notificationType, title, content, relatedType, relatedId).lastInsertRowid;
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    const existing = db.prepare(`
      SELECT id FROM Notification WHERE user_id = ? AND type = ? AND related_type = ? AND related_id = ?
    `).get(userId, notificationType, relatedType, relatedId);
    return existing ? existing.id : null;
  }
}

export function getNotification(notificationId) {
  return db.prepare('SELECT * FROM Notification WHERE id = ?').get(notificationId) ?? null;
}

export function listNotificationsByUser(userId, limit = 50, offset = 0) {
  return db.prepare(`
    SELECT id, user_id, type, title, content, related_type, related_id, is_read, created_at
    FROM Notification WHERE user_id = ?
    ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?
  `).all(userId, limit, offset);
}

export function countUnreadNotifications(userId) {
  return db.prepare('SELECT COUNT(*) AS unread_count FROM Notification WHERE user_id = ? AND is_read = 0')
    .get(userId).unread_count;
}

/** 내 알림만 읽음 처리. 명시적 소유권 확인 + UPDATE 의 WHERE 로 이중 방어. */
export function markNotificationAsRead(notificationId, requestingUserId) {
  const notification = getNotification(notificationId);
  if (!notification) throw new ValidationError('알림을 찾을 수 없습니다.');
  if (notification.user_id !== requestingUserId) {
    throw new PermissionDeniedError('본인의 알림만 확인할 수 있습니다.');
  }
  db.prepare('UPDATE Notification SET is_read = 1 WHERE id = ? AND user_id = ?')
    .run(notificationId, requestingUserId);
}

export function markAllNotificationsAsRead(requestingUserId) {
  return db.prepare('UPDATE Notification SET is_read = 1 WHERE user_id = ? AND is_read = 0')
    .run(requestingUserId).changes;
}
