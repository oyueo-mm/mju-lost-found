import Banner from '../components/Banner.jsx';

/**
 * 명지대 계정이 아닌 구글 계정으로 로그인한 경우.
 * 서버가 로그인 자체는 허용하되 API 를 막는다 -- 그래야 "현재 계정: xxx" 를
 * 보여줄 수 있기 때문이다(원본과 같은 UX).
 */
export default function DomainBlockedScreen({ me, onLogout }) {
  return (
    <div style={{ maxWidth: 440, margin: '48px auto' }}>
      <div className="card">
        <Banner kind="error">명지대학교 계정({me.allowedDomain})만 이용할 수 있습니다.</Banner>
        <p className="muted">현재 로그인된 계정: {me.user?.email}</p>
        <button onClick={onLogout} style={{ width: '100%' }}>로그아웃</button>
      </div>
    </div>
  );
}
