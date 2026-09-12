import { createClient } from "@/lib/supabase/server";
import { timeAgo } from "@/lib/format";
import CommentForm from "./CommentForm";
import CommentDeleteButton from "./CommentDeleteButton";

export default async function Comments({ postType, postId, viewerId }) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("comments")
    .select("id, content, created_at, user_id, author:profiles!user_id(nickname)")
    .eq("post_type", postType)
    .eq("post_id", postId)
    .order("created_at", { ascending: true })
    .limit(200);

  const comments = data || [];

  return (
    <section className="card p-5">
      <h2 className="font-bold">
        댓글 {comments.length > 0 && <span className="text-brand">{comments.length}</span>}
      </h2>

      <ul className="mt-3 space-y-3">
        {comments.length === 0 ? (
          <li className="text-sm text-ink-faint">
            아직 댓글이 없어요. 본 적 있는 물건이면 알려주세요.
          </li>
        ) : (
          comments.map((c) => (
            <li key={c.id} className="flex gap-2.5">
              <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-tint text-xs font-bold text-brand-deep">
                {c.author?.nickname?.[0] || "?"}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm">
                  <b>{c.author?.nickname || "알 수 없음"}</b>{" "}
                  <span className="text-xs text-ink-faint">
                    {timeAgo(c.created_at)}
                  </span>
                </p>
                <p className="mt-0.5 whitespace-pre-wrap break-words text-sm text-ink-soft">
                  {c.content}
                </p>
              </div>
              {c.user_id === viewerId && (
                <CommentDeleteButton
                  commentId={c.id}
                  postType={postType}
                  postId={postId}
                />
              )}
            </li>
          ))
        )}
      </ul>

      <CommentForm postType={postType} postId={postId} />
    </section>
  );
}
