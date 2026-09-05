import { useState } from 'react';

/**
 * 게시물 이미지.
 * 파일이 없거나 깨졌으면 조용히 사라진다 -- 이미지 하나 때문에 목록 전체 렌더링이
 * 멈추지 않게 하려는 것으로, 원본 ui/common.py 의 render_post_thumbnail 과 같은 정책이다.
 */
export default function Thumb({ src, className = 'thumb' }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) return null;
  return <img className={className} src={src} alt="" loading="lazy" onError={() => setBroken(true)} />;
}
