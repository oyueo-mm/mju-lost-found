import { redirect } from "next/navigation";
import Header from "@/components/Header";
import BottomNav from "@/components/BottomNav";
import Footer from "@/components/Footer";
import RealtimeRefresher from "@/components/RealtimeRefresher";
import {
  getSessionUser,
  isEmailPermitted,
  isStaff,
  isSuspended,
} from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { unreadMessageCount, pendingReportCount } from "@/lib/alerts";

export default async function MainLayout({ children }) {
  const session = await getSessionUser();
  const permitted = session
    ? await isEmailPermitted(session.user.email)
    : false;

  // 정지 계정은 서비스 전체 이용 차단 → 안내 페이지로
  if (permitted && isSuspended(session.profile)) {
    redirect("/suspended");
  }

  const loggedIn = Boolean(permitted && session.profile?.nickname);

  // 약관 미동의 → /consent 는 각 페이지의 requireUser() 가 처리한다.
  // (여기서 막으면 동의 중 /terms·/privacy 전문 보기가 안 됨)

  let chatUnread = 0;
  let pendingReports = 0;
  const staff = loggedIn && isStaff(session.profile);
  if (loggedIn) {
    try {
      [chatUnread, pendingReports] = await Promise.all([
        unreadMessageCount(session.supabase, session.user.id),
        staff ? pendingReportCount(createAdminClient()) : Promise.resolve(0),
      ]);
    } catch {
      /* noop */
    }
  }

  return (
    <>
      <Header />
      {loggedIn && (
        <RealtimeRefresher userId={session.user.id} staff={staff} />
      )}
      <main className="mx-auto max-w-3xl px-4 py-6 pb-24 sm:pb-8">
        {children}
        <Footer />
      </main>
      <BottomNav
        show={loggedIn}
        staff={staff}
        chatUnread={chatUnread}
        pendingReports={pendingReports}
      />
    </>
  );
}
