// 서버 주소 결정 규칙.
// 페이지를 연 오리진을 그대로 쓴다. `/api`와 `/ws`를 백엔드로 넘기는 일은 개발에서는 vite 프록시가
// (vite.config.ts), 배포에서는 nginx가(frontend/nginx.conf) 맡는다 — 두 환경 모두 같은 오리진이 되므로
// 프론트가 백엔드의 호스트·포트를 알 필요가 없고 CORS도 필요 없다.
// 백엔드를 다른 주소에 따로 띄워 붙일 때만 VITE_SERVER_URL로 덮어쓴다.

const OVERRIDE = import.meta.env.VITE_SERVER_URL as string | undefined

export const SERVER_URL = OVERRIDE ?? window.location.origin

export const API_BASE = `${SERVER_URL}/api`
