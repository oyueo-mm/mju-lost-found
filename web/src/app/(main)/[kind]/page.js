import { notFound, redirect } from "next/navigation";
import { KIND_CONFIG } from "@/lib/constants";

// 게시판은 "/" 한 곳. /found → 습득물 탭, /lost → 분실물 탭.
export default async function BoardPage({ params }) {
  const { kind } = await params;
  if (!KIND_CONFIG[kind]) notFound();
  redirect(kind === "lost" ? "/?tab=lost" : "/");
}
