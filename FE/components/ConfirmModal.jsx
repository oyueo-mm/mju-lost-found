/** 되돌릴 수 없는 동작(삭제/취소/제재) 전에 한 번 더 묻는 확인 창. */
export default function ConfirmModal({
  title, message, confirmLabel = '확인', onConfirm, onCancel, busy,
}) {
  return (
    // 바깥을 눌러도 닫히게 하되, 창 안쪽 클릭은 stopPropagation 으로 막는다.
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        <p className="muted" style={{ marginTop: 0 }}>{message}</p>
        <div className="row tight" style={{ marginTop: 16 }}>
          <button className="danger" onClick={onConfirm} disabled={busy}>{confirmLabel}</button>
          <button onClick={onCancel} disabled={busy}>취소</button>
        </div>
      </div>
    </div>
  );
}
