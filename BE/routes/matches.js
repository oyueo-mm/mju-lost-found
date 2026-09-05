/**
 * AI 매칭 확정/조회/취소 (pages/4_내_매칭.py).
 * 매칭 확정은 두 게시물 중 한쪽의 작성자만 할 수 있고, 그 검사는 db.createMatch 가 한다.
 */
import express from 'express';

import * as db from '../db.js';
import * as auth from '../auth.js';
import { intOrNull, wrap } from '../helpers.js';

const router = express.Router();

router.get('/matches', wrap(async (req, res) => {
  const user = auth.requireReadyUser(req, res);
  if (!user) return;
  res.json(db.listMatchesByUser(user.id));
}));

/** "내 물건 같아요" -- 매칭 확정. 이미 있으면 기존 id 를 그대로 돌려준다(멱등). */
router.post('/matches', wrap(async (req, res) => {
  const user = auth.requireReadyUser(req, res);
  if (!user) return;
  const id = db.createMatch(
    intOrNull(req.body?.lostPostId),
    intOrNull(req.body?.foundPostId),
    Number(req.body?.score) || 0,
    user.id
  );
  res.status(201).json({ id });
}));

router.delete('/matches/:id', wrap(async (req, res) => {
  const user = auth.requireReadyUser(req, res);
  if (!user) return;
  db.deleteMatch(intOrNull(req.params.id), user.id);
  res.json({ ok: true });
}));

export default router;
