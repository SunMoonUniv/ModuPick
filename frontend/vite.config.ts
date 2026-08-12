import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 백엔드 주소. 같은 PC에 띄웠으면 기본값 그대로 두고, 다른 PC에 있으면 BACKEND_URL로 바꾼다.
const backend = process.env.BACKEND_URL ?? 'http://127.0.0.1:8000'

// LAN의 다른 PC에서도 접속할 수 있도록 host를 열어둔다 (여러 명이 같은 방에 들어와야 하는 게임이라 필수)
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    // 배포의 nginx와 같은 경로 규칙을 개발에서도 만든다 — 그래야 프론트가 두 환경에서 같은 코드로 돌고
    // (src/api/endpoint.ts가 오리진만 본다) CORS 설정에 기대지 않게 된다.
    proxy: {
      '/api': { target: backend, changeOrigin: true },
      '/ws': { target: backend, changeOrigin: true, ws: true },
    },
  },
})
