import { useEffect, useState } from 'react';
import { get } from '../api.js';
import { navigate } from '../navigation.js';
import Banner from '../components/Banner.jsx';
import Empty from '../components/Empty.jsx';
import Loading from '../components/Loading.jsx';

/**
 * 내 채팅 목록 (원본 pages/6_내_채팅.py).
 *
 * 서버가 매칭 방/다이렉트 방 모두에 other_nickname·unread_count 를 통일해서 채워주므로
 * 화면에서는 room_type 으로 제목 줄만 갈라 쓰면 된다.
 */
export default function ChatsScreen() {
  const [rooms, setRooms] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    get('/api/chats').then(setRooms).catch((e) => setError(e.message));
  }, []);

  return (
    <>
      <div className="page-head">
        <h1>💬 내 채팅</h1>
        <p>내가 참여 중인 채팅방을 최근 대화 순으로 확인할 수 있습니다.</p>
      </div>
      <Banner kind="error" onClose={() => setError('')}>{error}</Banner>

      {!rooms ? <Loading /> : rooms.length === 0 ? (
        <Empty>아직 시작한 채팅이 없습니다. 게시물 상세에서 &lsquo;작성자와 채팅하기&rsquo;를 눌러 대화를 시작해보세요.</Empty>
      ) : rooms.map((r) => (
        <div className="card" key={r.chat_room_id}>
          <div className="card-row">
            <div className="card-body">
              <p className="card-title">
                {r.room_type === 'match' ? `${r.lost_title} ↔ ${r.found_title}` : `💬 ${r.post_title}`}
                {r.unread_count > 0 && <span className="badge">{r.unread_count}</span>}
              </p>
              <p className="meta">
                상대방: {r.other_nickname}
                {r.room_type === 'match'
                  ? <> · <span className="mono-score">AI 유사도 점수: {r.score.toFixed(2)}</span></>
                  : ' · 게시글에서 바로 시작한 채팅'}
              </p>
              {r.last_message_content
                ? (
                  <>
                    <p className="desc">{r.last_message_content}</p>
                    <p className="faint">{r.last_message_created_at}</p>
                  </>
                )
                : <p className="faint">아직 메시지가 없습니다.</p>}
            </div>
            <div className="card-actions">
              <button className="primary sm" onClick={() => navigate(`/chats/${r.chat_room_id}`)}>채팅하기</button>
            </div>
          </div>
        </div>
      ))}
    </>
  );
}
