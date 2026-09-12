export default function manifest() {
  return {
    name: "명지 스마트 분실물 센터",
    short_name: "명지 분실물",
    description:
      "명지대학교 교내 분실물·습득물을 AI 매칭으로 찾아주는 서비스",
    start_url: "/",
    display: "standalone",
    background_color: "#f2f5fb",
    theme_color: "#0b4da2",
    lang: "ko",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icon-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
