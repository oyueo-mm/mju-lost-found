import { notFound } from "next/navigation";
import { KIND_CONFIG } from "@/lib/constants";
import PostDetail from "@/components/PostDetail";

// 조회수를 매 방문마다 반영하려면 캐시 없이 항상 새로 렌더
export const dynamic = "force-dynamic";

export default async function PostPage({ params }) {
  const { kind, id } = await params;
  if (!KIND_CONFIG[kind] || !/^\d+$/.test(id)) notFound();

  return <PostDetail kind={kind} id={id} />;
}
