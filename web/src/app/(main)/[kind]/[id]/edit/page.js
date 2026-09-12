import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getPost } from "@/lib/posts";
import { KIND_CONFIG } from "@/lib/constants";
import { updatePost } from "@/lib/post-actions";
import PostForm from "@/components/PostForm";

export default async function EditPostPage({ params }) {
  const { kind, id } = await params;
  const cfg = KIND_CONFIG[kind];
  if (!cfg || !/^\d+$/.test(id)) notFound();

  const { user } = await requireUser();
  const supabase = await createClient();
  const post = await getPost(supabase, kind, id);
  if (!post || post.user_id !== user.id) notFound();

  return (
    <div>
      <h1 className="text-lg font-extrabold">{cfg.label} 글 수정</h1>
      <div className="mt-4">
        <PostForm
          kind={kind}
          campus={post.campus}
          initial={post}
          action={updatePost.bind(null, kind, post.id)}
        />
      </div>
    </div>
  );
}
