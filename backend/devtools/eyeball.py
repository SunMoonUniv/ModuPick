"""두 창 육안 확인 — 진짜 브라우저로 연다.

    uvicorn app.main:app &
    python devtools/eyeball.py


plan.md §3.0의 완료 기준이 이것이다.

    브라우저 창 2개를 열어 한쪽에서 방을 만들고 다른 쪽에서 코드로 들어갔을 때,
    서로가 목록에 보이고, 채팅이 오가고, 준비 버튼이 상대 화면에 1초 안에 반영된다.

계약 테스트는 프레임을 보고 e2e는 프로토콜을 본다. 여기서 보는 것은 **실제로 그려진
화면**이다 — 셀렉터가 어긋났거나 핸들러가 안 붙었으면 여기서만 드러난다.

시스템 Chrome을 쓴다(channel="chrome"). 브라우저를 따로 내려받지 않는다.
"""

import asyncio
import sys
from pathlib import Path

from playwright.async_api import async_playwright

URL = "http://127.0.0.1:8000/devtools/console.html"
#: 스크린샷 저장 위치. 저장소에 넣지 않는다 — 매 실행마다 달라진다.
SHOTS = Path(__file__).parent / "shots"
SHOTS.mkdir(exist_ok=True)

ok, bad = [], []


def check(label: str, cond: bool, detail: str = "") -> None:
    (ok if cond else bad).append(label)
    print(f"{'PASS' if cond else 'FAIL'}  {label}{'  — ' + detail if detail else ''}")


async def members_of(page) -> list[str]:
    return await page.eval_on_selector_all(
        "#members li .nm", "els => els.map(e => e.textContent.trim())"
    )


async def text_of(page, selector: str) -> str:
    return " ".join((await page.inner_text(selector)).split())


async def main() -> None:
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(channel="chrome", headless=True)
        # 창마다 별도 컨텍스트를 쓴다 — sessionStorage가 섞이면 두 사람이 아니다.
        ctx_a = await browser.new_context(viewport={"width": 1500, "height": 1000})
        ctx_b = await browser.new_context(viewport={"width": 1500, "height": 1000})
        a = await ctx_a.new_page()
        b = await ctx_b.new_page()

        errors_a: list[str] = []
        a.on("pageerror", lambda e: errors_a.append(str(e)))
        b.on("pageerror", lambda e: errors_a.append(str(e)))

        # ── 창 1 — 방장으로 한 번에 ──────────────────────────────────────
        await a.goto(URL)
        await a.click("#btn-quick-host")
        await a.wait_for_selector("#members li", timeout=5000)

        code = await a.input_value("#in-code")
        check("방이 만들어지고 코드가 채워진다", len(code) == 6 and code.isdigit(), code)
        check("방장 소켓이 열렸다", "열림" in await text_of(a, "#b-ws"))
        check("방장이 명단에 보인다", len(await members_of(a)) == 1)
        await a.screenshot(path=str(SHOTS / "1-host.png"), full_page=True)

        # ── 창 2 — 코드로 한 번에 ────────────────────────────────────────
        await b.goto(f"{URL}?code={code}")
        await b.click("#btn-quick-guest")
        await b.wait_for_selector("#members li:nth-child(2)", timeout=5000)

        # **상대 화면에 반영되는 데 걸리는 시간**이 완료 기준이다
        await a.wait_for_selector("#members li:nth-child(2)", timeout=1000)
        check("한쪽 입장이 다른 쪽 목록에 1초 안에 뜬다", True)

        names_a, names_b = await members_of(a), await members_of(b)
        check("두 창의 명단이 같다", len(names_a) == len(names_b) == 2,
              f"{names_a} / {names_b}")
        await a.screenshot(path=str(SHOTS / "2-both-a.png"), full_page=True)
        await b.screenshot(path=str(SHOTS / "2-both-b.png"), full_page=True)

        # ── 채팅 ─────────────────────────────────────────────────────────
        await a.fill("#in-chat", "잘 보이나요")
        await a.click("#btn-chat")
        await b.wait_for_function(
            "() => document.querySelectorAll('#chat .msg').length > 0", timeout=1000
        )
        check("채팅이 1초 안에 상대 화면에 뜬다", True)
        check("보낸 본인 화면에도 남는다",
              "잘 보이나요" in await text_of(a, "#chat"))
        check("받는 쪽에도 같은 내용이 뜬다",
              "잘 보이나요" in await text_of(b, "#chat"))

        # ── 준비 ─────────────────────────────────────────────────────────
        await b.click("#btn-ready")
        await a.wait_for_function(
            "() => document.querySelector('#b-ready b').textContent === '1/1'",
            timeout=1000,
        )
        check("준비가 1초 안에 상대 화면에 반영된다",
              await text_of(a, "#b-ready") == "준비 1/1", await text_of(a, "#b-ready"))
        check("참여자 카드에 준비 배지가 붙는다",
              await a.eval_on_selector_all(
                  "#members .tag.ready", "els => els.length"
              ) == 1)

        # ── 게임 선택·설정 ───────────────────────────────────────────────
        await a.click("#games button:nth-child(2)")  # 사다리
        await b.wait_for_function(
            "() => document.querySelector('#game-id').textContent.includes('ladder')",
            timeout=1000,
        )
        check("게임 선택이 참여자 화면에 반영된다",
              "ladder" in await text_of(b, "#game-id"))
        check("참여자의 설정 위젯은 읽기 전용이다",
              await b.eval_on_selector_all(
                  "#config input, #config select", "els => els.every(e => e.disabled)"
              ))
        check("설정 항목이 그려진다",
              await b.eval_on_selector_all("#config label", "els => els.length") == 2)
        await a.screenshot(path=str(SHOTS / "3-game-a.png"), full_page=True)
        await b.screenshot(path=str(SHOTS / "3-game-b.png"), full_page=True)

        # ── 게임 시작 ────────────────────────────────────────────────────
        check("준비가 차야 시작 버튼이 열린다",
              await a.is_enabled("#btn-start"))
        await a.click("#btn-start")
        await b.wait_for_selector("#round dl", timeout=2000)
        check("라운드가 두 창에 모두 뜬다",
              "rnd_" in await text_of(a, "#round") and "rnd_" in await text_of(b, "#round"))
        check("READY 단계가 표시된다", "READY" in await text_of(a, "#round"))
        check("방 상태가 PLAYING으로 바뀐다", "PLAYING" in await text_of(a, "#kv"),
              await text_of(a, "#kv"))
        await a.screenshot(path=str(SHOTS / "4-round-a.png"), full_page=True)
        await b.screenshot(path=str(SHOTS / "4-round-b.png"), full_page=True)

        # ── 방장 나가기 → 방이 닫힌다 ────────────────────────────────────
        await a.click("#btn-disconnect")
        await b.wait_for_function(
            "() => document.querySelector('#banner').textContent.includes('종료')",
            timeout=2000,
        )
        check("방장이 나가면 남은 창이 사유와 함께 밀려난다",
              "방장" in await text_of(b, "#banner"), await text_of(b, "#banner"))
        check("종료 코드 4410이 표시된다", "4410" in await text_of(b, "#b-ws"),
              await text_of(b, "#b-ws"))
        check("방이 사라지면 준비 집계도 비워진다",
              await text_of(b, "#b-ready") == "준비 0/0", await text_of(b, "#b-ready"))
        await b.screenshot(path=str(SHOTS / "5-closed-b.png"), full_page=True)

        check("브라우저 콘솔에 예외가 없다", not errors_a, "; ".join(errors_a[:2]))

        await browser.close()

    print(f"\n{len(ok)} PASS · {len(bad)} FAIL")
    print(f"스크린샷 → {SHOTS}")
    if bad:
        sys.exit(1)


asyncio.run(main())
