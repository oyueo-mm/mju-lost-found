import { requireIdentityReadyUser } from "@/lib/auth/session";
import { getMyOrganizationMemberships } from "@/lib/organization/service";
import { loadNextPostDefaults } from "@/lib/posts/nextPostDefaults";
import { PostForm } from "@/components/post/PostForm";

export default async function NewLostPostPage({ searchParams }: { searchParams: Promise<{ after?: string }> }) {
  // Redirects to /login, /onboarding or (no 실명·학과 yet) /me/identity as needed.
  const user = await requireIdentityReadyUser("write", "/lost/new");

  // Phase 12-5 §13/§14: the org selector's option list always comes from a
  // fresh server-side membership query, never client state -- only ACTIVE
  // organizations are offered (posting as an INACTIVE one would just be
  // rejected server-side anyway, see validateOrganizationPosting()).
  const myOrganizations = (await getMyOrganizationMemberships(user.id)).filter((m) => m.organizationStatus === "active");
  // 연속 등록: ?after=<id> from the post page's "다음 등록" link -- see
  // posts/nextPostDefaults.ts.
  const defaults = await loadNextPostDefaults("lost", (await searchParams).after, user.id, myOrganizations);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">분실물 등록</h1>
      <PostForm type="lost" myOrganizations={myOrganizations} defaults={defaults} draftOwnerId={user.id} />
    </div>
  );
}
