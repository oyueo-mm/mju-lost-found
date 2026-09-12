// 로그인 필요 앱이라 검색엔진엔 랜딩만 노출한다.
export default function robots() {
  return {
    rules: [
      { userAgent: "*", allow: "/", disallow: ["/admin", "/my", "/chat", "/api"] },
    ],
  };
}
