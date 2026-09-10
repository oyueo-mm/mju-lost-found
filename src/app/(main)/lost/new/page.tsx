import { requireReadyUser } from "@/lib/auth/session";
import { getMyOrganizationMemberships } from "@/lib/organization/service";
import { PostForm } from "@/components/post/PostForm";

export default async function NewLostPostPage() {
  const user = await requireReadyUser("write", "/lost/new"); // redirects to /login or /onboarding as needed

  // Phase 12-5 §13/§14: the org selector's option list always comes from a
  // fresh server-side membership query, never client state -- only ACTIVE
  // organizations are offered (posting as an INACTIVE one would just be
  // rejected server-side anyway, see validateOrganizationPosting()).
  const myOrganizations = (await getMyOrganizationMemberships(user.id)).filter((m) => m.organizationStatus === "active");

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">분실물 등록</h1>
      <PostForm type="lost" myOrganizations={myOrganizations} />
    </div>
  );
}
