-- Phase J-2: remove the Match domain (user-confirmed pairing, "매칭하기").
-- Direct chat (ChatRoom.directLostPostId/directFoundPostId/initiatorUserId)
-- is untouched by this migration -- it has never depended on Match. At the
-- time this migration was written, production had zero Match rows and zero
-- Match-based ChatRoom rows (matchId IS NOT NULL), so this drops no chat
-- history. MatchCandidateCache is deliberately NOT touched -- it is reused
-- as the new AI-recommendation cache (see src/lib/recommendation/service.ts).
-- NotificationType.MATCH is deliberately NOT removed from the enum -- a
-- Postgres enum value can't be dropped without rebuilding the type, which
-- is unnecessary risk for a value the app simply stops writing.

-- ChatRoom.matchId (and its FK/unique index) must be dropped before Match
-- itself, since it's the only column outside the Match table that
-- references it.
ALTER TABLE "ChatRoom" DROP CONSTRAINT "ChatRoom_match_id_fkey";
DROP INDEX "ChatRoom_match_id_key";
ALTER TABLE "ChatRoom" DROP COLUMN "match_id";

-- Drops Match_pkey, idx_match_lost_post_id, idx_match_found_post_id,
-- Match_lost_post_id_found_post_id_key, and Match's own two FKs to
-- LostPost/FoundPost along with the table itself.
DROP TABLE "Match";

-- The MatchCandidateCache *table* is kept and reused as the AI
-- recommendation cache, but its existing rows hold the old Match-candidate
-- JSON shape ({postId, type, score, title, ...}); the recommendation
-- service stores a different one ({id, score}). Every row is disposable by
-- design (recomputed on the next read), so the stale rows are cleared here
-- rather than being migrated or defensively parsed forever.
DELETE FROM "MatchCandidateCache";
