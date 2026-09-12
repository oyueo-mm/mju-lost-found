import { cookies } from "next/headers";
import { getSessionUser, isEmailPermitted } from "@/lib/auth";
import { isCampus } from "@/lib/campus";
import { KIND_CONFIG, CATEGORIES } from "@/lib/constants";
import Landing from "@/components/Landing";
import UnifiedBoard from "@/components/UnifiedBoard";

export default async function HomePage({ searchParams }) {
  const session = await getSessionUser();
  const loggedIn = Boolean(
    session &&
      (await isEmailPermitted(session.user.email)) &&
      session.profile?.nickname,
  );

  if (!loggedIn) return <Landing />;

  const sp = await searchParams;
  let campus = isCampus(sp?.campus) ? sp.campus : null;
  if (!campus) {
    const saved = (await cookies()).get("campus")?.value;
    campus = isCampus(saved) ? saved : "natural";
  }

  // 쿼리는 전부 화이트리스트로만 통과
  const tab = KIND_CONFIG[sp?.tab] ? sp.tab : "found";
  const q = (sp?.q || "").toString().trim().slice(0, 100);
  const category = CATEGORIES.includes(sp?.category) ? sp.category : "";
  const sort = sp?.sort === "oldest" ? "oldest" : "newest";
  const pageNum = Number.parseInt(sp?.page, 10);
  const page = Number.isInteger(pageNum) && pageNum >= 1 && pageNum <= 1000 ? pageNum : 1;

  return (
    <UnifiedBoard
      campus={campus}
      tab={tab}
      q={q}
      category={category}
      sort={sort}
      page={page}
    />
  );
}
