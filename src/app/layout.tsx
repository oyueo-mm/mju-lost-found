import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { themeInitScript } from "@/lib/theme/constants";
import { LOCALE_HTML_LANG } from "@/lib/i18n/config";
import { getLocale, getTranslator } from "@/lib/i18n/server";
import { getDictionary } from "@/lib/i18n/messages";
import { I18nProvider } from "@/lib/i18n/client";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// 브랜드명 통일 Phase: 브라우저 제목/설명이 "MYONGJI L&F | [현재 locale의
// 서비스 설명]" 형식이 되어야 하므로, 정적 `metadata` 객체 대신 요청마다
// locale을 읽어 조립하는 generateMetadata()로 바꿨다 -- 이 레이아웃이
// 이미 getLocale()로 동적 렌더링임을 감수하고 있으므로 새로 정적 렌더링을
// 포기하는 페이지는 없다(RootLayout 자체 주석 참고).
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslator();
  const brandName = t("brand.name");
  const description = t("brand.description");
  const title = `${brandName} | ${description}`;

  return {
    // Phase 31: resolves opengraph-image.png's relative path to an absolute
    // URL for link previews. Pinned to the official production URL rather
    // than VERCEL_PROJECT_PRODUCTION_URL: the project has several vercel.app
    // production domains (the old ones 308-redirect here), and Vercel kept
    // picking the old one. Any Vercel deployment (Preview included, as
    // before) points link previews at production; local dev uses localhost.
    metadataBase: new URL(process.env.VERCEL ? "https://mju-find.vercel.app" : "http://localhost:3000"),
    title,
    description,
    openGraph: {
      title,
      description,
    },
    // Phase 11-5: app/manifest.ts is what actually makes /manifest.webmanifest
    // exist and auto-links it -- appleWebApp here only fills in the two
    // iOS-specific bits that manifest.json/PWA spec doesn't cover (iOS
    // Safari has never read the Web App Manifest's `display`/`name` for its
    // own "홈 화면에 추가" flow, only these Apple-specific meta tags).
    // apple-touch-icon itself is unaffected (src/app/apple-icon.png already
    // covers that via Next's own metadata-file convention).
    appleWebApp: {
      capable: true,
      statusBarStyle: "default",
      title: brandName,
    },
  };
}

// Phase 11-5: themeColor moved out of `metadata` into its own export --
// Next.js deprecated (and, since a recent version, silently drops)
// metadata.themeColor in favor of this. Reuses this app's own --primary
// token value (globals.css), not a new color. width/initialScale repeat
// Next's own default (this export replaces it entirely once present, so
// they can't be left implicit).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#2f6fed",
};

// 다국어(i18n) Phase: 이 레이아웃이 요청당 한 번 언어를 결정하고
// (쿠키 -> Accept-Language -> 한국어, i18n/config.ts의 resolveLocale),
// 그 언어와 해당 언어 사전 하나만 I18nProvider로 내려보낸다 -- 아래
// 모든 서버 컴포넌트는 각자 getTranslator()를 부르고(같은 요청 안에서는
// cache()로 한 번만 계산된다), 클라이언트 컴포넌트는 useI18n()으로 같은
// 값을 읽는다. URL에 로케일 세그먼트를 추가하지 않으므로 기존 URL
// 구조는 전혀 바뀌지 않는다.
export default async function RootLayout({ children }: LayoutProps<"/">) {
  const locale = await getLocale();

  return (
    <html
      // 예전에는 항상 "en"으로 하드코딩돼 있었다(내용은 한국어인데도).
      // 이제 실제로 렌더링되는 언어를 알려준다 -- 스크린 리더의 발음,
      // 브라우저 번역 제안, 검색엔진 모두 이 속성을 본다.
      lang={LOCALE_HTML_LANG[locale]}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        {/* Phase H-3: blocking (no async/defer) so data-theme/data-accent/
            data-contrast are set on <html> before first paint -- without
            this, the page would flash the default light/blue theme for a
            frame before a saved dark/accent/high-contrast preference
            applies. Reads only localStorage, no network/DB -- see
            src/lib/theme/constants.ts's themeInitScript() for the single
            shared source of this logic (also used, non-serialized, by
            ThemeSettings for a live change). */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript() }} />
      </head>
      <body className="min-h-full flex flex-col">
        <I18nProvider locale={locale} messages={getDictionary(locale)}>
          {children}
        </I18nProvider>
      </body>
    </html>
  );
}
