import { useEffect, useState } from 'react';
import { get, post } from '../api.js';
import { navigate } from '../navigation.js';
import { BOARD_META } from '../constants.js';
import Banner from '../components/Banner.jsx';
import Empty from '../components/Empty.jsx';
import Loading from '../components/Loading.jsx';
import StatusPill from '../components/StatusPill.jsx';
import ReportButton from '../components/ReportButton.jsx';
import MatchCandidates from '../components/MatchCandidates.jsx';

/**
 * 게시물 상세 (/lost/:id, /found/:id).
 * 원본 pages/1,2 의 "선택한 게시물" 영역 + AI 매칭 섹션에 해당한다.
 */
export default function PostDetailScreen({ kind, id, me }) {
  const meta = BOARD_META[kind];
  // 'post' 는 api.js 의 POST 헬퍼 이름과 겹쳐서 postData 로 둔다.
  const [postData, setPostData] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [aiResults, setAiResults] = useState(null);
  const [aiBusy, setAiBusy] = useState(false);

  useEffect(() => {
    // alive 플래그: 응답이 오기 전에 다른 게시물로 옮겨가면 늦게 온 결과를 버린다.
    let alive = true;
    setPostData(null);
    setAiResults(null);
    get(`/api/posts/${kind}/${id}`)
      .then((p) => { if (alive) setPostData(p); })
      .catch((e) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [kind, id]);

  async function startDirectChat() {
    setError('');
    try {
      const room = await post('/api/chats/direct', { postKind: kind, postId: Number(id) });
      navigate(`/chats/${room.id}`);
    } catch (e) {
      setError(e.message);
    }
  }

  async function runAiMatch() {
    setAiBusy(true);
    setError('');
    try {
      const data = await post('/api/ai/match', { kind, postId: Number(id) });
      setAiResults(data.results);
    } catch (e) {
      setError(e.message);
      setAiResults(null);
    } finally {
      setAiBusy(false);
    }
  }

  if (error && !postData) return <Banner kind="error">{error}</Banner>;
  if (!postData) return <Loading />;

  const isMine = postData.user_id === me.user.id;
  // 신고 대상 id 는 부호로 게시판을 구분한다: 양수=찾아요, 음수=찾았어요.
  const reportTargetId = kind === 'lost' ? postData.id : -postData.id;

  return (
    <>
      <button className="ghost sm" onClick={() => navigate(`/${kind}`)}>← {meta.title}으로</button>

      <div className="page-head" style={{ marginTop: 12 }}>
        <h1>{postData.title}</h1>
        <p>{meta.icon} {meta.title} · <StatusPill status={postData.status} /></p>
      </div>

      <Banner kind="error" onClose={() => setError('')}>{error}</Banner>
      <Banner kind="success" onClose={() => setNotice('')}>{notice}</Banner>

      <div className="card">
        {postData.image_url && <img className="detail-image" src={postData.image_url} alt="" />}
        <p className="desc" style={{ marginTop: 0 }}>{postData.description}</p>
        <div className="section" style={{ marginTop: 14, paddingTop: 14 }}>
          <p className="meta"><b>작성자</b> {postData.author_nickname}</p>
          <p className="meta"><b>카테고리</b> {postData.category}</p>
          <p className="meta"><b>장소</b> {postData.location}</p>
          <p className="meta"><b>{meta.dateLabel} 시간</b> {postData[meta.dateField]}</p>
          <p className="meta"><b>작성일</b> {postData.created_at}</p>
        </div>
      </div>

      <div className="card">
        <div className="row tight">
          {/* 자기 글에는 채팅/신고 버튼을 띄우지 않는다 (서버도 거부하지만, 헛클릭을 막는다). */}
          {!isMine && (
            <button className="primary" onClick={startDirectChat}>💬 작성자와 채팅하기</button>
          )}
          {!isMine && (
            <ReportButton targetType="post" targetId={reportTargetId} reasons={me.reportReasons} />
          )}
          {isMine && <span className="muted">내가 작성한 게시물입니다. 수정·삭제는 &lsquo;내 게시물&rsquo;에서 할 수 있어요.</span>}
        </div>
      </div>

      <div className="section">
        <h3>AI 매칭</h3>
        <button onClick={runAiMatch} disabled={aiBusy}>{meta.matchButton}</button>
        {aiBusy && <Loading text="AI가 유사한 게시물을 찾는 중입니다..." />}
        {!aiBusy && aiResults !== null && (
          aiResults.length === 0
            ? <Empty>현재 등록된 게시물 중에는 유사한 후보가 없습니다.</Empty>
            : (
              <>
                <p className="muted"><b>AI 유사도 기준 추천 {aiResults.length}건</b></p>
                {/* 기준 게시물이 있으므로 각 후보에 "내 물건 같아요" 버튼이 붙는다. */}
                <MatchCandidates
                  kind={kind === 'lost' ? 'found' : 'lost'}
                  results={aiResults}
                  sourcePostId={postData.id}
                  onMatched={() => setNotice('매칭이 확정되었습니다. ‘내 매칭’에서 채팅을 시작할 수 있어요.')}
                />
              </>
            )
        )}
      </div>
    </>
  );
}
