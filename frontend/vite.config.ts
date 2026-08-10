import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// LAN의 다른 PC에서도 접속할 수 있도록 host를 열어둔다 (여러 명이 같은 방에 들어와야 하는 게임이라 필수)
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
  },
})
