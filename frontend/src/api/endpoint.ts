// 서버 주소 결정 규칙.
// 페이지를 연 호스트의 8000번 포트를 그대로 쓴다(uvicorn 기본 포트) — 방장 PC에서 dev 서버와 백엔드를 같이 띄우면
// LAN의 다른 PC가 `http://<방장 IP>:5173`으로 들어와도 설정 없이 같은 서버를 바라보게 된다.
// LAN에서 쓰려면 백엔드의 CORS_ORIGINS에 그 주소를 넣어야 한다 — 기본값은 http://localhost:5173 하나뿐이다.

const OVERRIDE = import.meta.env.VITE_SERVER_URL as string | undefined

export const SERVER_URL = OVERRIDE ?? `${window.location.protocol}//${window.location.hostname}:8000`

export const API_BASE = `${SERVER_URL}/api`
