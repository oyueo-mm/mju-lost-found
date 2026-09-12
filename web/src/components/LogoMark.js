// 앱 로고 마크 — 파란 그라데이션 타일 + 돋보기(분실물=찾기).
// size: 타일 한 변 px, radius: 모서리 클래스
export default function LogoMark({ size = 32, className = "", rounded = "rounded-xl" }) {
  const glyph = Math.round(size * 0.58);
  return (
    <span
      className={`logo-tile ${rounded} ${className}`}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg
        width={glyph}
        height={glyph}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="M20 20l-4.5-4.5" />
      </svg>
    </span>
  );
}
