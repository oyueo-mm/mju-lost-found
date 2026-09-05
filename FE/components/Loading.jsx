/** 로딩 스피너 + 안내 문구. */
export default function Loading({ text = '불러오는 중...' }) {
  return <div className="spinner-note"><span className="spinner" />{text}</div>;
}
