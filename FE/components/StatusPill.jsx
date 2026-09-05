/** 게시물 상태 배지. '찾음'/'완료'는 초록, 진행 중은 주황. */
export default function StatusPill({ status }) {
  const done = status === '찾음' || status === '완료';
  return <span className={`pill ${done ? 'ok' : 'wait'}`}>{status}</span>;
}
