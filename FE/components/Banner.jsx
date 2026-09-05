/** 화면 상단 알림 줄. children 이 비면 아무것도 그리지 않는다. */
export default function Banner({ kind = 'info', children, onClose }) {
  if (!children) return null;
  return (
    <div className={`banner ${kind}`}>
      {children}
      {onClose && (
        <button className="ghost sm" style={{ float: 'right', marginTop: -2 }} onClick={onClose}>닫기</button>
      )}
    </div>
  );
}
