/**
 * 신고 접수 (게시물 / 메시지 / 사용자).
 *
 * targetId 부호 규칙에 주의: target_type 이 'post' 일 때
 *   양수 = 찾아요(LostPost) id, 음수 = -(찾았어요(FoundPost) id).
 * 두 테이블의 id 가 각각 1부터 시작하는 별개 시퀀스라 숫자만으로는 구분할 수 없어서다.
 * (자세한 이유는 db.js 의 validateReportTarget 주석 참고)
 *
 * 대상 존재 확인, 자기 신고 금지, 중복 신고 금지는 전부 db.createReport 가 한다.
 */
import express from 'express';

import * as db from '../db.js';
import * as auth from '../auth.js';
import { intOrNull, wrap } from '../helpers.js';

const router = express.Router();

router.post('/reports', wrap(async (req, res) => {
  const user = auth.requireReadyUser(req, res);
  if (!user) return;
  const id = db.createReport(
    user.id,
    req.body?.targetType,
    intOrNull(req.body?.targetId),
    req.body?.reason,
    req.body?.detail
  );
  res.status(201).json({ id });
}));

export default router;
