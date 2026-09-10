import { notFound } from "next/navigation";

import { requireReadyUser } from "@/lib/auth/session";
import { getFoundPost, getLostPost } from "@/lib/posts/service";
import { postTypeSchema } from "@/lib/posts/schema";
import { getMyOrganizationMemberships } from "@/lib/organization/service";
import { PostForm } from "@/components/post/PostForm";

function toDateTimeLocalValue(date: Date): string {
  // datetime-local wants "YYYY-MM-DDTHH:mm" in local time, not UTC.
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

export default async function EditPostPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ type?: string }>;
}) {
  const { id: idParam } = await params;
  const { type: typeParam } = await searchParams;
  const callbackUrl = typeParam ? `/post/${idParam}/edit?type=${typeParam}` : `/post/${idParam}/edit`;
  const user = await requireReadyUser("write", callbackUrl); // redirects to /login or /onboarding as needed

  const id = Number(idParam);
  const typeResult = postTypeSchema.safeParse(typeParam);
  if (!Number.isInteger(id) || !typeResult.success) notFound();
  const type = typeResult.data;

  const post = type === "lost" ? await getLostPost(id) : await getFoundPost(id);
  if (!post) notFound();

  // Posts are publicly readable anyway (this same post is visible at
  // /post/[id] to anyone), so there's no confidentiality reason to hide
  // "this isn't yours" behind a generic 404 -- a plain, honest message is
  // more useful here. The API route (PATCH /api/posts/[id]) re-checks
  // ownership itself regardless of what this page shows.
  if (post.author.id !== user.id) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
        본인이 작성한 게시글만 수정할 수 있습니다.
      </div>
    );
  }

  const dateValue = post.type === "lost" ? post.lostAt : post.foundAt;

  // Phase 12-7 §4: same server-fetched-membership convention as
  // lost/new, found/new page.tsx -- now also needed in edit mode, since
  // 게시 주체 is editable here too.
  const myOrganizations = (await getMyOrganizationMemberships(user.id)).filter((m) => m.organizationStatus === "active");

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
        {type === "lost" ? "분실물 수정" : "습득물 수정"}
      </h1>
      <PostForm
        type={type}
        postId={post.id}
        myOrganizations={myOrganizations}
        initialValues={{
          title: post.title,
          description: post.description,
          category: post.category,
          location: post.location,
          campus: post.campus,
          // Phase P-5: null (time marked unknown) stays null here -- only
          // a real Date is converted to the datetime-local string format.
          // PostForm's own dateUnknown toggle is what decides, from this,
          // whether to seed the date input as unknown or pre-filled.
          dateValue: dateValue ? toDateTimeLocalValue(dateValue) : null,
          // getLostPost/getFoundPost always include this (ordered by
          // displayOrder) -- defaulting to [] only satisfies the type for
          // PostDTO's other, list-producing callers, which never reach here.
          images: (post.images ?? []).map((img) => ({ id: img.id, imageUrl: img.imageUrl })),
          organizationId: post.organizationId,
          organizationName: post.organizationName,
        }}
      />
    </div>
  );
}
