import Link from "next/link";

// Security audit A-5: where an over-limit public page request lands
// (lib/security/readGuardPage.ts). No session, no database: it must stay
// cheap exactly when the service is under load.
export const metadata = { title: "잠시 후 다시 시도해주세요", robots: { index: false } };

export default function BusyPage() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-lg font-semibold text-foreground">요청이 많아 잠시 제한하고 있어요</h1>
      <p className="text-sm text-muted-foreground">짧은 시간에 너무 많은 요청이 들어왔어요. 1분쯤 뒤에 다시 시도해주세요.</p>
      <Link href="/" className="text-sm text-primary underline">
        처음으로
      </Link>
    </main>
  );
}
