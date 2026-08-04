import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * 개발 서버는 백엔드를 **같은 오리진으로 프록시**한다.
 *
 * CORS를 열어 우회하지 않는 이유는 개발과 배포의 경로 형태를 갈라놓지 않기
 * 위해서다. 프록시로 같은 오리진을 만들어 두면 두 환경이 같은 코드로 돈다 —
 * 소켓 URL도 location에서 그대로 유도된다.
 *
 * 백엔드 주소는 BACKEND_URL로 바꾼다(기본 127.0.0.1:8000).
 */
const backend = process.env.BACKEND_URL ?? "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": { target: backend, changeOrigin: true },
      "/ws": { target: backend, changeOrigin: true, ws: true },
    },
  },
});
