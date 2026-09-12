import Link from "next/link";
import { requireUser } from "@/lib/auth";
import MyMatches from "@/components/MyMatches";
import Icon from "@/components/Icon";

export const metadata = { title: "내 매칭 · 명지 분실물 센터" };

export default async function MyMatchesPage() {
  const { user } = await requireUser();
  return (
    <div>
      <div className="flex items-center gap-2">
        <Link
          href="/my"
          className="grid h-8 w-8 place-items-center rounded-full text-ink-soft transition hover:bg-sunken"
        >
          <Icon name="back" size={17} />
        </Link>
        <h1 className="text-xl font-extrabold">내 매칭</h1>
      </div>
      <div className="mt-4">
        <MyMatches userId={user.id} />
      </div>
    </div>
  );
}
