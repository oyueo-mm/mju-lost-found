import Link from "next/link";
import { requirePermission } from "@/lib/auth/session";
import { can } from "@/lib/permissions/check";
import { UtmLinkBuilder } from "@/components/admin/UtmLinkBuilder";
import { kstDay } from "@/lib/metrics/record";

export default async function AdminUtmPage() {
  const admin = await requirePermission("promotion.manage");
  return (
    <div className="flex flex-col gap-6">
      <Link href="/admin" className="text-xs text-muted-foreground">← 관리자 센터</Link>
      <h1 className="text-xl font-semibold">UTM 링크 생성</h1>
      <p className="text-sm text-muted-foreground">홍보 링크와 인쇄용 QR 코드를 만듭니다. 링크는 실제 서비스(mju-find.vercel.app)로 연결됩니다.</p>
      <UtmLinkBuilder month={kstDay().slice(0, 7)} />
      {can(admin, "stats.operations") && <Link href="/admin/stats" className="text-sm text-primary underline">운영 통계에서 유입 비교 →</Link>}
    </div>
  );
}
