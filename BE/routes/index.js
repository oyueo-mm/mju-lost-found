/**
 * 모든 API 라우터를 하나로 합쳐 준다. BE/server.js 는 이것만 /api 에 붙이면 된다.
 *
 * 새 기능을 추가할 때는 이 폴더에 파일을 하나 만들고 아래에 한 줄 추가하면 된다.
 */
import express from 'express';

import authRoutes from './auth.js';
import postsRoutes from './posts.js';
import aiRoutes from './ai.js';
import matchesRoutes from './matches.js';
import chatsRoutes from './chats.js';
import reportsRoutes from './reports.js';
import notificationsRoutes from './notifications.js';
import adminRoutes from './admin.js';

const api = express.Router();

api.use(authRoutes);          // /me, /auth/*
api.use(postsRoutes);         // /posts/:kind*, /my/posts
api.use(aiRoutes);            // /ai/search, /ai/match
api.use(matchesRoutes);       // /matches*
api.use(chatsRoutes);         // /chats*
api.use(reportsRoutes);       // /reports
api.use(notificationsRoutes); // /notifications*
api.use(adminRoutes);         // /admin/*

export default api;
