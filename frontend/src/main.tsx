import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/global.css' // App보다 먼저 로드해야 토큰·리셋이 먼저 적용됨
import App from './App.tsx'

// 앱 진입점 — index.html의 #root에 React 트리를 마운트
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
