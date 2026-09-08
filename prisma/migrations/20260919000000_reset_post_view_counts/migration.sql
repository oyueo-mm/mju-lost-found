-- Phase L: reset viewCount now that recordPostViewAction() (src/lib/posts/
-- views.ts) counts each viewer at most once per post, ever, instead of the
-- old 30-minute re-count window. Existing counts were accumulated under
-- that old, looser rule, so they're not meaningful under the new one and
-- this phase's own spec asks for them to start at 0.
--
-- PostView is cleared along with the counters, not just the counters
-- alone: PostView is the ledger recordPostViewAction() checks *before*
-- ever incrementing (see that function) -- a row surviving this reset
-- would permanently block that same viewer from ever contributing to the
-- count again, even though the visible number now reads 0. Clearing both
-- together is what makes "초기화" (reset) actually mean a clean restart of
-- the whole one-view-per-viewer mechanism, not just the number two
-- viewers already covered.
--
-- No column, index, or constraint changes -- purely a data reset.

UPDATE "LostPost" SET view_count = 0;
UPDATE "FoundPost" SET view_count = 0;
DELETE FROM "PostView";
