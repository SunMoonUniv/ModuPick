import { useEffect, useState } from "react";
import { useApp } from "./lib/store";
import { Landing } from "./screens/Landing";
import { CreateRoom } from "./screens/CreateRoom";
import { Profile } from "./screens/Profile";
import { Lobby } from "./screens/Lobby";
import { GameHost } from "./screens/GameHost";
import { Result } from "./screens/Result";
import { Modals } from "./components/Modals";

/** 1920×1080 고정 스테이지(D-17)를 뷰포트에 맞춰 스케일 — 발표 화면 대응 */
function useStageScale() {
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const onResize = () =>
      setScale(Math.min(window.innerWidth / 1920, window.innerHeight / 1080));
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return scale;
}

export default function App() {
  const screen = useApp((s) => s.screen);
  const scale = useStageScale();

  return (
    <div className="stage-viewport">
      <div className="stage" style={{ transform: `scale(${scale})` }}>
        {screen === "landing" && <Landing />}
        {screen === "create" && <CreateRoom />}
        {screen === "profile" && <Profile />}
        {screen === "lobby" && <Lobby />}
        {screen === "game" && <GameHost />}
        {screen === "result" && <Result />}
        <Modals />
      </div>
    </div>
  );
}
