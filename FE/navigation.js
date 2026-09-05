/**
 * 아주 작은 라우터.
 *
 * 화면 수가 적어서 react-router 같은 라이브러리를 쓰지 않고 History API 를 직접 다룬다.
 * 서버가 SPA 폴백을 해주므로 /lost/3 같은 주소로 새로고침하거나 직접 접속해도 정상 동작한다.
 */
import { useEffect, useState } from 'react';

/** 화면 이동. pushState 후 popstate 를 직접 쏴서 useRoute 가 알아채게 한다. */
export function navigate(path) {
  if (window.location.pathname === path) return;
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/** 현재 경로를 구독한다. 뒤로가기/앞으로가기도 popstate 로 함께 잡힌다. */
export function useRoute() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  return path;
}
