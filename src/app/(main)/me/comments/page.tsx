import { requireReadyUser } from "@/lib/auth/session";
import { listCommentsByUser } from "@/lib/comment/service";
import { MyCommentList } from "@/components/comment/MyCommentList";

// Phase H-8: "내가 쓴 댓글" -- same "mypost" LoginReason as /posts/mine
// (see src/lib/auth/session.ts's own comment on why that closed union
// isn't extended for every new personal-account page). userId comes only
// from the authenticated session, never a query param, so there's no way
// to list another user's comments by tweaking the URL.
export default async function MyCommentsPage() {
  const user = await requireReadyUser("mypost", "/me/comments");

  let comments;
  try {
    comments = await listCommentsByUser(user.id);
  } catch (error) {
    console.error("Failed to load my comments", error);
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-foreground">내가 쓴 댓글</h1>
      {!comments ? (
        <div className="rounded-card border border-destructive/30 bg-destructive-muted p-10 text-center text-sm text-destructive">
          댓글을 불러오지 못했어요. 잠시 후 다시 시도해주세요.
        </div>
      ) : (
        <MyCommentList comments={comments} />
      )}
    </div>
  );
}
