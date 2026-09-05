import { requireReadyUser } from "@/lib/auth/session";
import { PostForm } from "@/components/post/PostForm";

export default async function NewLostPostPage() {
  await requireReadyUser("write", "/lost/new"); // redirects to /login or /onboarding as needed

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">분실물 등록</h1>
      <PostForm type="lost" />
    </div>
  );
}
