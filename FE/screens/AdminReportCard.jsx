import { useState } from 'react';
import { post } from '../api.js';
import {
  ACTION_TYPE_LABELS, REPORT_STATUS_LABELS, TARGET_TYPE_LABELS, TARGET_TYPE_TO_ACTION,
} from '../constants.js';
import Banner from '../components/Banner.jsx';
import ConfirmModal from '../components/ConfirmModal.jsx';

/**
 * 신고 1건 카드 + 처리 폼.
 *
 * 처리 방법은 두 가지다:
 *   반려(dismissed) -> /process   : 결정만 기록, 제재 없음
 *   조치 완료        -> /action    : 신고 처리 + 실제 제재를 한 트랜잭션으로 적용
 *
 * 어떤 제재를 쓸지는 신고 대상 종류가 정한다(게시물->삭제, 메시지->숨김, 사용자->정지).
 * 이 짝이 맞는지는 서버가 다시 검사하므로, 여기 표는 화면 표시용일 뿐이다.
 */
export default function AdminReportCard({ report: r, onProcessed }) {
  const [open, setOpen] = useState(false);
  // 대상이 이미 사라졌으면 적용할 제재가 없으므로 '반려'만 고를 수 있다.
  const [decision, setDecision] = useState(r.target_deleted ? 'dismissed' : 'actioned');
  const [suspendDays, setSuspendDays] = useState('7');
  const [actionReason, setActionReason] = useState('');
  const [adminNote, setAdminNote] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const actionType = TARGET_TYPE_TO_ACTION[r.target_type];
  const info = r.target_info;

  async function apply() {
    setBusy(true);
    setError('');
    try {
      if (decision === 'dismissed') {
        await post(`/api/admin/reports/${r.id}/process`, { status: 'dismissed', adminNote });
      } else {
        await post(`/api/admin/reports/${r.id}/action`, {
          actionType,
          actionReason,
          adminNote,
          // '영구' 를 고르면 기간을 null 로 보낸다 -> 서버가 영구 정지로 처리한다.
          suspendDurationDays: actionType === 'suspend_user' && suspendDays !== '영구'
            ? Number(suspendDays)
            : null,
        });
      }
      setConfirming(false);
      onProcessed();
    } catch (e) {
      setError(e.message);
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <p className="card-title">
        #{r.id} {TARGET_TYPE_LABELS[r.target_type]} 신고
        {' '}<span className={`pill ${r.status === 'pending' ? 'wait' : 'ok'}`}>{REPORT_STATUS_LABELS[r.status]}</span>
      </p>
      <p className="meta">사유: {r.reason}{r.detail && ` · 상세: ${r.detail}`}</p>
      <p className="faint">신고자: {r.reporter_nickname} · 접수일: {r.created_at}</p>

      <div className="section" style={{ marginTop: 12, paddingTop: 12 }}>
        <h3>신고 대상</h3>
        {r.target_deleted ? (
          <p className="muted">대상이 이미 삭제되었습니다.</p>
        ) : r.target_type === 'post' ? (
          <>
            <p className="meta">
              <b>{info.title}</b>{' '}
              <span className="pill brand">{info.post_kind === 'lost' ? '찾아요' : '찾았어요'}</span>
            </p>
            <p className="faint">{info.category} · {info.location} · 상태: {info.status} · 작성자: {info.author_nickname}</p>
            <p className="desc">{info.description}</p>
          </>
        ) : r.target_type === 'message' ? (
          <>
            <p className="faint">보낸이: {info.sender_nickname} · 채팅방 #{info.chat_room_id} · {info.created_at}</p>
            {/* 숨김 처리된 메시지라도 관리자에게는 원문이 보인다(판단 근거가 필요하므로). */}
            <p className="desc">{info.content}</p>
          </>
        ) : (
          <p className="meta">닉네임: {info.nickname}</p>
        )}
      </div>

      {r.status !== 'pending' ? (
        <p className="faint" style={{ marginBottom: 0 }}>
          처리자: {r.processed_by_nickname || '-'} · 처리일: {r.processed_at}
          {r.admin_note && ` · 메모: ${r.admin_note}`}
          {r.moderation_action && ` · 조치: ${ACTION_TYPE_LABELS[r.moderation_action.action_type]}`}
        </p>
      ) : (
        <>
          <Banner kind="error" onClose={() => setError('')}>{error}</Banner>
          <button className="sm" style={{ marginTop: 10 }} onClick={() => setOpen((v) => !v)}>
            {open ? '처리 닫기' : '처리하기'}
          </button>

          {open && (
            <div className="section">
              <div className="field">
                <label>처리 상태 선택</label>
                <select value={decision} onChange={(e) => setDecision(e.target.value)}>
                  <option value="dismissed">반려</option>
                  {!r.target_deleted && <option value="actioned">조치 완료</option>}
                </select>
                {r.target_deleted && <p className="faint">대상이 이미 삭제되어 &lsquo;반려&rsquo;만 선택할 수 있습니다.</p>}
              </div>

              {decision === 'actioned' && (
                <>
                  <p className="meta">조치: <b>{ACTION_TYPE_LABELS[actionType]}</b></p>
                  {actionType === 'suspend_user' && (
                    <div className="field">
                      <label>정지 기간</label>
                      <select value={suspendDays} onChange={(e) => setSuspendDays(e.target.value)}>
                        <option value="7">7일</option>
                        <option value="30">30일</option>
                        <option value="영구">영구</option>
                      </select>
                    </div>
                  )}
                  <div className="field">
                    <label>제재 사유 (선택)</label>
                    <input type="text" value={actionReason} onChange={(e) => setActionReason(e.target.value)} />
                  </div>
                </>
              )}

              <div className="field">
                <label>관리자 메모 (선택)</label>
                <textarea value={adminNote} onChange={(e) => setAdminNote(e.target.value)} />
              </div>
              <button className="danger" onClick={() => setConfirming(true)} disabled={busy}>
                이 처리 적용
              </button>
            </div>
          )}

          {confirming && (
            <ConfirmModal
              title="신고 처리"
              message={`정말 '${decision === 'dismissed' ? '반려' : `조치 완료 (${ACTION_TYPE_LABELS[actionType]})`}' 처리를 적용하시겠습니까? 처리 후에는 되돌릴 수 없습니다.`}
              confirmLabel="적용"
              busy={busy}
              onCancel={() => setConfirming(false)}
              onConfirm={apply}
            />
          )}
        </>
      )}
    </div>
  );
}
