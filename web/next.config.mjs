/** @type {import('next').NextConfig} */

// 모든 응답에 붙는 보안 헤더. 로그인이 필요한 앱이라 iframe 삽입·MIME 스니핑·
// 불필요한 브라우저 권한을 전부 막는다.
const SECURITY_HEADERS = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  },
];

const nextConfig = {
  // 이미지 도메인 (Supabase Storage 공개 URL)
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "kisyddtmlquqyrflpznu.supabase.co" },
    ],
  },
  async headers() {
    return [{ source: "/(.*)", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
