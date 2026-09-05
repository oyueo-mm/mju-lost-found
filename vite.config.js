import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 프론트엔드(FE) 빌드 설정.
// 진입점은 루트의 index.html -> FE/main.jsx 이고, 결과물은 루트의 dist/ 에 나온다.
//
// 개발 중에는 Vite(5173, FE)와 Express(3000, BE)가 따로 뜬다.
// /api 와 /uploads 요청만 Express로 넘겨주면, FE 코드는 개발/배포 구분 없이
// 항상 같은 도메인의 상대 경로("/api/...")만 호출하면 된다.
// 배포 시에는 dist/ 를 Express가 직접 서빙하므로 프록시가 필요 없다.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/uploads': 'http://localhost:3000',
    },
  },
});
