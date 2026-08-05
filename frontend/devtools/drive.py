"""이미 떠 있는 Chrome에 붙어 한 번에 몇 동작만 하고 빠진다.

    python drive.py L 'await page.click("text=새 방 만들기")'
    python drive.py R 'print(await page.title())'

창을 내가 소유하지 않는다 — 원격 디버깅 포트로 **붙었다 떼는** 것이라 명령이 끝나도
창은 그대로 열려 있다. 그래서 사람이 옆에서 실시간으로 보고 있을 수 있다.

L = 왼쪽 창(9222) · R = 오른쪽 창(9223).
"""

import asyncio
import sys

from playwright.async_api import async_playwright

PORTS = {"L": 9222, "R": 9223}


async def main() -> None:
    which = sys.argv[1].upper()
    code = sys.argv[2]

    async with async_playwright() as pw:
        browser = await pw.chromium.connect_over_cdp(f"http://127.0.0.1:{PORTS[which]}")
        ctx = browser.contexts[0]
        page = ctx.pages[0] if ctx.pages else await ctx.new_page()
        await page.bring_to_front()

        scope = {"page": page, "ctx": ctx, "asyncio": asyncio, "print": print}
        wrapped = "async def _run(page, ctx, asyncio, print):\n" + "\n".join(
            "    " + line for line in code.splitlines()
        )
        exec(wrapped, scope)  # noqa: S102 — 내가 쓴 코드만 들어온다
        await scope["_run"](page, ctx, asyncio, print)

        # **닫지 않는다.** 연결만 끊는다 — 창은 사람이 보고 있다.


asyncio.run(main())
