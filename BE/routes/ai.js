/**
 * AI 의미 검색 / AI 매칭 추천.
 * 실제 유사도 계산은 BE/ai.js 가 하고, 여기서는 후보를 모아 넘기고 결과를 돌려준다.
 */
import express from 'express';

import * as db from '../db.js';
import * as ai from '../ai.js';
import * as auth from '../auth.js';
import { filterValue, intOrNull, wrap } from '../helpers.js';

const router = express.Router();

/**
 * AI 의미 검색 -- 자유 문장으로 *반대편* 게시판을 찾는다.
 * (찾아요 화면에서 검색하면 습득물이, 찾았어요 화면에서 검색하면 분실물이 나온다.)
 * 원본 pages/1,2 의 "AI 의미 검색" 탭과 같은 동작.
 */
router.post('/ai/search', wrap(async (req, res) => {
  if (!auth.requireReadyUser(req, res)) return;
  const targetKind = req.body?.kind === 'lost' ? 'lost' : 'found';
  const candidates = db.searchPosts(targetKind, {
    category: filterValue(req.body?.category),
    status: filterValue(req.body?.status),
  });
  const results = await ai.searchSimilarPosts(req.body?.query, candidates, ai.SEARCH_TOP_K);
  res.json({ kind: targetKind, results });
}));

/**
 * 게시물 상세의 "🤖 AI로 유사한 OO 찾기".
 * 내 게시물과 의미가 비슷한 반대편 게시물 상위 5건을 돌려준다.
 */
router.post('/ai/match', wrap(async (req, res) => {
  if (!auth.requireReadyUser(req, res)) return;
  const kind = req.body?.kind === 'found' ? 'found' : 'lost';
  const post = db.getPost(kind, intOrNull(req.body?.postId));
  if (!post) throw new db.ValidationError('게시물을 찾을 수 없습니다.');

  const candidateKind = kind === 'lost' ? 'found' : 'lost';
  const candidates = db.searchPosts(candidateKind, {});
  const results = await ai.rankSimilarPosts(post, candidates, 5);
  res.json({ kind: candidateKind, results });
}));

export default router;
