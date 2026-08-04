"""프론트 두 창 검증 — 실제 React 화면을 진짜 브라우저로 조작한다.

    cd backend && uvicorn app.main:app &        (:8000)
    cd frontend && npm run dev &                (:5173 — /api·/ws를 백엔드로 프록시)
    backend/.venv/bin/python frontend/devtools/two-windows.py

    HEADED=1 SLOW_MO=800 HOLD=60 ...            사람이 보면서 따라갈 때

playwright는 backend/requirements.txt에 있다. 시스템 Chrome을 쓰므로 브라우저를
따로 내려받지 않는다.

콘솔(devtools/console.html)이 아니라 **제품 화면**을 본다. 여기서만 드러나는 것은
셀렉터·핸들러·렌더링이며, 계약 테스트가 통과해도 화면이 안 그려질 수 있다.
"""

import asyncio
import os
import sys
from pathlib import Path

from playwright.async_api import async_playwright

URL = "http://localhost:5173/"

#: HEADED=1이면 진짜 Chrome 창 두 개를 나란히 띄운다. 사람이 보면서 따라갈 수 있게
#: 동작 사이에 간격을 준다.
HEADED = os.environ.get("HEADED") == "1"
SLOW_MO = int(os.environ.get("SLOW_MO", "400" if HEADED else "0"))
HOLD_S = float(os.environ.get("HOLD", "10" if HEADED else "0"))
WIN_W, WIN_H = 950, 1020
#: 스크린샷 저장 위치. 저장소에 넣지 않는다 — 매 실행마다 달라진다.
SHOTS = Path(__file__).parent / "shots"
SHOTS.mkdir(exist_ok=True)

ok, bad = [], []


def check(label: str, cond: bool, detail: str = "") -> None:
    (ok if cond else bad).append(label)
    print(f"{'PASS' if cond else 'FAIL'}  {label}{'  — ' + detail if detail else ''}")


async def text_of(page, selector: str) -> str:
    return " ".join((await page.inner_text(selector)).split())


async def fill_profile(page, nick: str) -> None:
    """프로필 화면 — 닉네임 입력 → 아바타 선택 → 입장."""
    await page.wait_for_selector("text=대기방 입장하기", timeout=8000)
    await page.fill('input[placeholder="예) 코딩왕지호"]', nick)
    # 아바타는 랜덤 뽑기로 고른다 — 캐러셀 페이지마다 보이는 칸이 달라
    # 타일을 직접 집으면 창마다 결과가 갈린다.
    await page.click("button:has-text('랜덤 뽑기')")
    await page.click("button:has-text('대기방 입장하기')")


async def main() -> None:
    async with async_playwright() as pw:
        # 창 위치는 브라우저 인자로만 정해지므로 **브라우저를 둘 띄운다.**
        # 컨텍스트를 둘로 나누는 것만으로는 나란히 놓을 수 없다.
        async def launch(x: int):
            return await pw.chromium.launch(
                channel="chrome",
                headless=not HEADED,
                slow_mo=SLOW_MO,
                args=[f"--window-position={x},0", f"--window-size={WIN_W},{WIN_H}"],
            )

        br_a, br_b = await launch(0), await launch(WIN_W + 10)
        view = None if HEADED else {"width": 1600, "height": 950}
        ctx_a = await br_a.new_context(viewport=view, no_viewport=HEADED)
        ctx_b = await br_b.new_context(viewport=view, no_viewport=HEADED)
        a, b = await ctx_a.new_page(), await ctx_b.new_page()

        errors: list[str] = []
        for p in (a, b):
            p.on("pageerror", lambda e: errors.append(str(e)))
            p.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)

        # ── 창 1 — 방 만들기 ────────────────────────────────────────────
        await a.goto(URL)
        await a.wait_for_selector("text=새 방 만들기", timeout=10000)
        await a.screenshot(path=str(SHOTS / "1-landing.png"))

        await a.click("text=새 방 만들기")
        await a.fill('input[placeholder="예) 4조 · 알고리즘 스터디"]', "브라우저 검증 방")
        await a.click("text=▶ 방 만들기")

        await fill_profile(a, "지호")
        await a.wait_for_selector("text=실시간 대기방", timeout=8000)
        check("방장이 대기방에 들어간다", True)

        code_text = await text_of(a, "text=/◈ MODU-/")
        code = code_text.split("MODU-")[1].strip()
        check("서버가 발급한 코드가 화면에 뜬다", len(code) == 6 and code.isdigit(), code)
        await a.screenshot(path=str(SHOTS / "2-lobby-host.png"))

        # ── 창 2 — 코드로 참가 ──────────────────────────────────────────
        await b.goto(URL)
        await b.fill('input[placeholder="_ _ _ _ _ _"]', code)
        await b.click("button:has-text('참여')")
        await fill_profile(b, "서연")
        await b.wait_for_selector("text=실시간 대기방", timeout=8000)

        # **상대 화면에 1초 안에 반영되는 것**이 완료 기준이다
        await a.wait_for_function(
            "() => document.body.innerText.includes('서연')", timeout=1500
        )
        check("한쪽 입장이 다른 쪽 명단에 1초 안에 뜬다", True)
        check("두 창 모두 2명으로 센다",
              "2/" in await text_of(a, ".screen-header")
              and "2/" in await text_of(b, ".screen-header"),
              await text_of(a, ".screen-header"))
        await a.screenshot(path=str(SHOTS / "3-both-host.png"))
        await b.screenshot(path=str(SHOTS / "3-both-guest.png"))

        # ── 채팅 ────────────────────────────────────────────────────────
        chat_input = a.locator('input[placeholder="메시지 입력…"]')
        await chat_input.fill("잘 보이나요")
        await chat_input.press("Enter")
        await b.wait_for_function(
            "() => document.body.innerText.includes('잘 보이나요')", timeout=1500
        )
        check("채팅이 1초 안에 상대 화면에 뜬다", True)

        # ── 준비 ────────────────────────────────────────────────────────
        await b.click("text=✓ 준비 완료")
        await a.wait_for_function(
            "() => document.body.innerText.includes('READY 1')", timeout=1500
        )
        check("준비가 1초 안에 방장 화면에 반영된다", True)

        # ── 게임 선택 ───────────────────────────────────────────────────
        await a.click("text=랜덤 사다리")
        await b.wait_for_function(
            "() => document.body.innerText.includes('랜덤 사다리')", timeout=1500
        )
        check("게임 선택이 참여자 화면에 반영된다", True)
        await a.screenshot(path=str(SHOTS / "4-game-host.png"))
        await b.screenshot(path=str(SHOTS / "4-game-guest.png"))

        # ── 게임 시작 ───────────────────────────────────────────────────
        await a.click("text=▶ 게임 시작")
        await b.wait_for_function(
            "() => !document.body.innerText.includes('실시간 대기방')", timeout=3000
        )
        check("게임 시작이 두 창을 함께 넘긴다", True)
        await a.screenshot(path=str(SHOTS / "5-game-a.png"))
        await b.screenshot(path=str(SHOTS / "5-game-b.png"))

        check("브라우저 콘솔에 오류가 없다", not errors, "; ".join(errors[:3]))

        if HOLD_S:
            print(f"\n창을 {HOLD_S:.0f}초 동안 열어 둡니다 — 직접 눌러 보세요")
            await asyncio.sleep(HOLD_S)
        await br_a.close()
        await br_b.close()

    print(f"\n{len(ok)} PASS · {len(bad)} FAIL")
    print(f"스크린샷 → {SHOTS}")
    if bad:
        sys.exit(1)


asyncio.run(main())
