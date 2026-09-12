import "./globals.css";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import ThemeController from "@/components/ThemeController";
import KonamiEgg from "@/components/KonamiEgg";
import { getLocale } from "@/i18n/server";
import { HTML_LANG } from "@/i18n/locales";
import { LocaleProvider } from "@/i18n/client";

const SITE_URL = "https://mju-lostfound.vercel.app";
const TITLE = "명지 스마트 분실물 센터";
const DESCRIPTION =
  "명지대학교 교내에서 잃어버리거나 주운 물건을 AI 매칭으로 찾아주는 분실물 플랫폼";

// opengraph-image.png / twitter-image.png 는 같은 폴더의 파일 규칙으로 자동 연결됨.
// metadataBase 가 있어야 og:image 가 절대 URL 로 나가서 카카오톡·디스코드 미리보기가 뜬다.
export const metadata = {
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  applicationName: TITLE,
  openGraph: {
    type: "website",
    locale: "ko_KR",
    url: SITE_URL,
    siteName: TITLE,
    title: TITLE,
    description: "잃어버린 물건, AI가 대신 찾아드려요. 명지대 구성원 전용.",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: "잃어버린 물건, AI가 대신 찾아드려요. 명지대 구성원 전용.",
  },
};

export const viewport = {
  themeColor: "#0b4da2",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }) {
  const locale = await getLocale();
  return (
    <html lang={HTML_LANG[locale]} className="h-full" suppressHydrationWarning>
      <body className="min-h-full">
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <ThemeController />
        <LocaleProvider locale={locale}>{children}</LocaleProvider>
        <KonamiEgg />
      </body>
    </html>
  );
}
