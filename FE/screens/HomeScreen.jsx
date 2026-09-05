import { navigate } from '../navigation.js';
import Banner from '../components/Banner.jsx';

/** 홈 화면 -- 각 기능으로 가는 카드 목록 (원본 app.py). */
export default function HomeScreen({ me }) {
  const unreadMsg = me.counts?.unreadMessages || 0;
  const unreadNotif = me.counts?.unreadNotifications || 0;

  const cards = [
    { path: '/lost', icon: '🔍', title: '찾아요', desc: '물건을 잃어버렸다면 등록하고, 등록된 습득물과 비교해보세요.' },
    { path: '/found', icon: '📦', title: '찾았어요', desc: '물건을 주웠다면 등록해서 원래 주인을 찾아주세요.' },
    { path: '/my-posts', icon: '🗂️', title: '내 게시물', desc: '내가 작성한 게시물을 확인하고 수정·삭제·상태 변경을 할 수 있습니다.' },
    { path: '/matches', icon: '🔗', title: '내 매칭', desc: '확정한 AI 매칭 결과를 확인하고 필요하면 취소할 수 있습니다.', count: unreadMsg },
    { path: '/chats', icon: '💬', title: '내 채팅', desc: '참여 중인 채팅방을 최근 대화 순으로 확인할 수 있습니다.', count: unreadMsg },
    { path: '/notifications', icon: '🔔', title: '알림', desc: '새 메시지·매칭·신고 처리 결과 등의 알림을 확인할 수 있습니다.', count: unreadNotif },
  ];

  return (
    <>
      <div className="page-head">
        <h1>명지 스마트 분실물 센터</h1>
        <p>
          명지대학교 교내에서 잃어버리거나 습득한 물건을 쉽게 찾을 수 있는 분실물 플랫폼입니다.
          {' '}AI가 게시물의 제목·설명·카테고리·장소를 분석해 서로 관련 있는 글을 찾아줍니다.
        </p>
      </div>

      {me.user.isSuspended && (
        <Banner kind="error">
          현재 계정이 정지 상태입니다. 게시물 등록·매칭 확정·메시지 전송이 제한됩니다.
          {' '}(기존 내용 열람과 알림 확인은 가능합니다.)
        </Banner>
      )}

      <div className="grid">
        {cards.map((c) => (
          <button className="card home-card" key={c.path} onClick={() => navigate(c.path)}>
            <h3>
              {c.icon} {c.title}
              {c.count > 0 && <span className="badge">{c.count}</span>}
            </h3>
            <p>{c.desc}</p>
          </button>
        ))}

        {/* 관리자 카드는 관리자에게만 보인다. 다만 이걸 숨기는 것 자체가 보안 경계는
            아니며, 실제 검증은 서버의 requireAdminUser + db 계층에서 다시 이루어진다. */}
        {me.user.isAdmin && (
          <button className="card home-card" onClick={() => navigate('/admin')}>
            <h3>🛡️ 관리자</h3>
            <p>신고된 게시물/메시지/사용자를 검토하고 처리할 수 있습니다.</p>
          </button>
        )}
      </div>
    </>
  );
}
