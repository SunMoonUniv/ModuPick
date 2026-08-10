import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/black-han-sans";
import "@fontsource/do-hyeon";
import "@fontsource/gothic-a1/500.css";
import "@fontsource/gothic-a1/700.css";
import "@fontsource/nanum-gothic-coding/400.css";
import "@fontsource/nanum-gothic-coding/700.css";
import "./styles/global.css";
import App from "./App";
import * as storeMod from "./lib/store";
import * as demoData from "./lib/data";

/* QA 전용 — dev 서버에서만 스토어를 노출해 화면별 스크린샷 검증에 사용 (prod 빌드에서 제거됨) */
if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__qa = {
    ...storeMod,
    ...demoData,
  };
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
