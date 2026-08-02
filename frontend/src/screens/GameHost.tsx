import { useEffect } from "react";
import { useApp } from "../lib/store";
import { GuideModal } from "../components/Modals";
import { Roulette } from "../games/Roulette";
import { Ladder } from "../games/Ladder";
import { Kingmaker } from "../games/Kingmaker";
import { TimeCatch } from "../games/TimeCatch";
import { Sniper } from "../games/Sniper";
import { Nunchi } from "../games/Nunchi";

/** 게임 화면 디스패처 — 가이드(C-01)는 게임판 딤 위에 겹친다 */
export function GameHost() {
  const selectedGame = useApp((s) => s.selectedGame);
  const guideOpen = useApp((s) => s.guideOpen);
  const openModal = useApp((s) => s.openModal);

  // 데모 보조: L 키 = 방장 이탈 시뮬레이션 (S-11 · C-06 · 레이어 660:7/661:8)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "l" || e.key === "L") openModal({ kind: "hostLeft" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openModal]);

  return (
    <>
      {selectedGame === "roulette" && <Roulette />}
      {selectedGame === "ladder" && <Ladder />}
      {selectedGame === "kingmaker" && <Kingmaker />}
      {selectedGame === "timecatch" && <TimeCatch />}
      {selectedGame === "sniper" && <Sniper />}
      {selectedGame === "nunchi" && <Nunchi />}
      {guideOpen && <GuideModal />}
    </>
  );
}
