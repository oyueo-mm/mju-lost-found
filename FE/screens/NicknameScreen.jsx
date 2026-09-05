import { useState } from 'react';
import { post } from '../api.js';
import Banner from '../components/Banner.jsx';

/**
 * 로그인·도메인은 통과했지만 아직 닉네임을 안 정한 사용자
 * (원본 ui/auth.py 의 render_nickname_setup_notice).
 * 닉네임은 한 번 정하면 바꿀 수 없고, 그 강제는 서버(db.setInitialNickname)가 한다.
 */
export default function NicknameScreen({ me, onRefresh }) {
  const [nickname, setNickname] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await post('/api/me/nickname', { nickname });
      onRefresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: 440, margin: '48px auto' }}>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>닉네임 설정</h3>
        <Banner kind="info">
          서비스를 이용하려면 먼저 고정 닉네임을 설정해주세요.
          {' '}닉네임은 한 번 설정하면 <b>변경할 수 없습니다</b>.
        </Banner>
        <Banner kind="error">{error}</Banner>
        <form onSubmit={submit}>
          <div className="field">
            <label>닉네임</label>
            <input
              type="text"
              value={nickname}
              maxLength={me.nicknameRules.max}
              placeholder={`한글/영문/숫자 ${me.nicknameRules.min}~${me.nicknameRules.max}자`}
              onChange={(e) => setNickname(e.target.value)}
            />
          </div>
          <button className="primary" type="submit" disabled={busy} style={{ width: '100%' }}>
            닉네임 설정하기 (변경 불가)
          </button>
        </form>
      </div>
    </div>
  );
}
