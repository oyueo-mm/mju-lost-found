/**
 * 이미지 업로드 설정 (ui/common.py 의 save_uploaded_image 포팅).
 *
 * 브라우저의 accept 속성은 클라이언트 힌트일 뿐이라 조작이 가능하다.
 * 실제 확장자 검사는 여기(서버)가 유일한 강제 지점이다.
 */
import multer from 'multer';
import crypto from 'node:crypto';
import path from 'node:path';

import * as db from './db.js';

const ALLOWED_IMAGE_SUFFIXES = new Set(['.jpg', '.jpeg', '.png']);

export const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, db.UPLOAD_DIR),
    // 원본 파일명은 쓰지 않는다 -- 경로 조작(../)과 파일명 충돌을 한 번에 없애기 위해
    // 랜덤 UUID + 검증된 확장자로만 저장한다.
    filename: (req, file, cb) => {
      const suffix = path.extname(file.originalname).toLowerCase();
      cb(null, `${crypto.randomUUID().replace(/-/g, '')}${suffix}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    const suffix = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_IMAGE_SUFFIXES.has(suffix)) {
      cb(new db.ValidationError(`허용되지 않는 파일 형식입니다: ${suffix || '(확장자 없음)'}`));
      return;
    }
    cb(null, true);
  },
});

/** 저장된 파일 -> 브라우저가 부를 수 있는 경로. 파일이 없으면 null. */
export const imageUrlFor = (file) => (file ? `/uploads/${file.filename}` : null);
