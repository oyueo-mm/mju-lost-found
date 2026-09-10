import { requireReadyUser } from "@/lib/auth/session";
import { getMyOrganizationMemberships } from "@/lib/organization/service";
import { PostForm } from "@/components/post/PostForm";

export default async function NewFoundPostPage() {
  const user = await requireReadyUser("write", "/found/new"); // redirects to /login or /onboarding as needed

  // See lost/new/page.tsx's own comment -- identical shape/reasoning.
  const myOrganizations = (await getMyOrganizationMemberships(user.id)).filter((m) => m.organizationStatus === "active");

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">습득물 등록</h1>
      <PostForm type="found" myOrganizations={myOrganizations} />
    </div>
  );
}
