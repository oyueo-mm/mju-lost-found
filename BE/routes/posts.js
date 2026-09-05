/**
 * 찾아요 / 찾았어요 게시판 (pages/1_찾아요.py, 2_찾았어요.py, 3_내_게시물.py).
 *
 * :kind 는 'lost' 또는 'found'. 두 게시판의 동작이 완전히 대칭이라
 * 라우트도 한 벌만 두고 kind 로 갈라 쓴다 (db.js 의 POST_KINDS 와 짝).
 */
import express from 'express';

import * as db from '../db.js';
import * as auth from '../auth.js';
import { filterValue, intOrNull, requireKind, wrap } from '../helpers.js';
import { imageUrlFor, upload } from '../upload.js';

const router = express.Router();

/** 목록 + 검색 ("키워드 검색" 탭). 필터를 다 비우면 전체 목록이 된다. */
router.get('/posts/:kind', wrap(async (req, res) => {
  const kind = requireKind(req);
  if (!auth.requireReadyUser(req, res)) return;
  res.json(db.searchPosts(kind, {
    keyword: String(req.query.keyword || '').trim(),
    category: filterValue(req.query.category),
    status: filterValue(req.query.status),
  }));
}));

router.get('/posts/:kind/:id', wrap(async (req, res) => {
  const kind = requireKind(req);
  if (!auth.requireReadyUser(req, res)) return;
  const post = db.getPost(kind, intOrNull(req.params.id));
  if (!post) {
    res.status(404).json({ error: '선택한 게시물을 찾을 수 없습니다.' });
    return;
  }
  res.json(post);
}));

router.post('/posts/:kind', upload.single('image'), wrap(async (req, res) => {
  const kind = requireKind(req);
  const user = auth.requireReadyUser(req, res);
  if (!user) return;

  const { title, description, category, location, at } = req.body;
  // 원본 폼의 "* 필수" 검사와 같은 항목들.
  const errors = [];
  if (!String(title || '').trim()) errors.push('제목을 입력해주세요.');
  if (!String(description || '').trim()) errors.push('설명을 입력해주세요.');
  if (!String(location || '').trim()) errors.push('장소를 입력해주세요.');
  if (!db.CATEGORIES.includes(category)) errors.push('카테고리를 선택해주세요.');
  if (errors.length) throw new db.ValidationError(errors.join(' '));

  const id = db.createPost(kind, {
    userId: user.id,
    title: title.trim(),
    description: description.trim(),
    category,
    location: location.trim(),
    at,
    imageUrl: imageUrlFor(req.file),
  });
  res.status(201).json({ id });
}));

router.patch('/posts/:kind/:id', upload.single('image'), wrap(async (req, res) => {
  const kind = requireKind(req);
  const user = auth.requireReadyUser(req, res);
  if (!user) return;

  const fields = {};
  for (const key of ['title', 'description', 'location']) {
    if (req.body[key] !== undefined) {
      const value = String(req.body[key]).trim();
      if (!value) throw new db.ValidationError('제목/설명/장소는 비워둘 수 없습니다.');
      fields[key] = value;
    }
  }
  if (req.body.category !== undefined) {
    if (!db.CATEGORIES.includes(req.body.category)) throw new db.ValidationError('카테고리를 선택해주세요.');
    fields.category = req.body.category;
  }
  // 이미지를 새로 올렸을 때만 교체한다 (비워두면 기존 이미지 유지 -- 원본과 동일).
  if (req.file) fields.image_url = imageUrlFor(req.file);

  db.updatePost(kind, intOrNull(req.params.id), user.id, fields);
  res.json({ ok: true });
}));

router.patch('/posts/:kind/:id/status', wrap(async (req, res) => {
  const kind = requireKind(req);
  const user = auth.requireReadyUser(req, res);
  if (!user) return;
  db.updatePost(kind, intOrNull(req.params.id), user.id, { status: req.body?.status });
  res.json({ ok: true });
}));

router.delete('/posts/:kind/:id', wrap(async (req, res) => {
  const kind = requireKind(req);
  const user = auth.requireReadyUser(req, res);
  if (!user) return;
  db.deletePost(kind, intOrNull(req.params.id), user.id);
  res.json({ ok: true });
}));

/** 내 게시물 화면 (pages/3_내_게시물.py) -- 두 게시판을 한 번에 내려준다. */
router.get('/my/posts', wrap(async (req, res) => {
  const user = auth.requireReadyUser(req, res);
  if (!user) return;
  res.json({
    lost: db.listPostsByUser('lost', user.id),
    found: db.listPostsByUser('found', user.id),
  });
}));

export default router;
