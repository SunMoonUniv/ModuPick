# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — start the Vite dev server with HMR, bound to `--host` so other LAN PCs can load the page
- `npm run build` — type-check (`tsc -b`) then production-build (`vite build`); both must pass, the build fails on any TS error
- `npm run lint` — run Oxlint (`.oxlintrc.json`: `react`, `typescript`, `oxc` plugins)
- `npm run preview` — serve the production build locally
- `npm run server` — start the temporary local realtime server (`local-server/`, port 8000, override with `PORT`). Run it in its own terminal alongside `npm run dev` — the two are deliberately separate processes so that deleting `local-server/` never touches the frontend's build or dev setup. Its deps (`express`, `ws`, `cors`) are in the root `package.json`, so the single root `npm install` covers it.

There is no test runner configured yet — no test script, no test files.

## Serving the built app

`Dockerfile` builds `dist/` and copies it into an nginx image together with `nginx.conf`; the repo-root `docker-compose.yml` runs that as the `frontend` service. nginx serves the static files **and** proxies `/api` and `/ws` to the backend container, so the browser only ever talks to one origin.

That single-origin rule is why `src/api/endpoint.ts` resolves the server from `window.location.origin` rather than a host and port. Don't reintroduce a hardcoded port there — it would bypass nginx, resurrect CORS, and break `wss` once the app is served over TLS. `VITE_SERVER_URL` stays as the escape hatch for pointing at a backend on a different address.

## Temporary local server (`local-server/`)

Until the real backend exists, `local-server/` (Express + raw WebSocket, in-memory, no DB) implements the **whole** v1.0 contract in `API 기본 명세서 요약.md` — REST (rooms/members/avatars/games), the waiting-room socket events, *and* the in-game protocol (`game:action`, `game:phase`, `server:tick`, `game:progress`, `game:tie`, `game:result`, `round:closed`) for all 6 minigames. Files: `server.js` (HTTP/socket wiring, room lifecycle), `ws.js` (the WebSocket adapter that gives `server.js` a Socket.IO-shaped API), `state.js` (in-memory store), `games.js` (game catalog + config schemas — the authoritative defaults), `engines.js` (per-game judging).

The socket transport matches the real backend: the client connects to `/ws/rooms/{code}`, sends a `conn:auth` frame within 3 seconds, and every S→C frame is the common envelope (`{event, success, code, message, data, timestamp}`). Close codes follow the backend's `CloseCode` (4002 protocol, 4401 unauthorized, 4408 auth timeout, 4413 too large). Run `node local-server/ws.js --selfcheck` to exercise the frame parser without booting the server.

**`local-server/` no longer works with this frontend.** The frontend has been migrated to the real backend's contract, and the two differ from the event names up (`server:tick` → `game:tick`, no `game:replay`, `game:decide` added, `phaseSeq` echoed on every action, per-game phase names, uppercase result variants, different config field names). Run `backend/` to exercise the app; treat `local-server/` as a historical artifact until someone deletes it.

All judging is server-side; client animations only replay an already-decided outcome. When changing a game rule, change `engines.js` — not the screen.

To play across LAN PCs: the host runs both `npm run server` (port 8000) and `npm run dev` on one machine; every player (including the host) opens `http://<host's LAN IP>:5173`. The dev server proxies `/api` and `/ws` to `127.0.0.1:8000` (`vite.config.ts`, override with the `BACKEND_URL` env var), so this works with zero config — and with no CORS involved — as long as the frontend and the backend run on the same machine. This whole directory is meant to be deleted once the real backend ships — don't build on top of it as if it were permanent.

## Project state

**Read `작업 인수인계.md` first.** It is deliberately short and carries only what the code cannot tell you: which screens are Figma-accurate vs still guessed, traps that cost real time, decisions already made, and open questions waiting on the user. Update its §1 list whenever a screen's design gets applied — and keep it short; don't grow it back into a manual.

Figma access is the remote MCP server (`https://mcp.figma.com/mcp`), not the desktop app's local Dev Mode server. On a fresh machine: `/plugin install figma@claude-plugins-official` then `/reload-plugins` (skipping the reload leaves 0 plugin MCP servers), then call `authenticate` and approve the URL.

ModuPick is a **functionally complete, visually provisional** Vite + React 19 + TypeScript app. Every screen exists and works end to end against `local-server/`: home → create/join → profile → waiting room → 6 minigames → result → replay/return. Routing, state, and socket integration are all in place. Not a git repo yet.

The visual layer is applied **screen by screen** and is not finished. `tokens.css` and the common components now carry the real neo-brutalist system extracted from Figma, and the home, waiting-room and profile screens match their frames. Create/join, the 6 minigame screens, and every result screen still use a guessed layout — right colours and components, wrong composition. Because every rule references tokens rather than raw values, a token fix propagates on its own; a layout fix does not.

Key modules:
- `src/protocol/types.ts` — the full REST + socket contract as TypeScript types, mirrored from the **real backend** (`backend/app/schemas/`, `app/domain/game_config.py`, `app/domain/games/*.py`), not from `local-server/`. Screens should read this, not the spec markdown.
- `src/screens/Result/adapters.ts` — result payloads name people by `memberId` only, so every result screen has to join them against the `game:started` roster snapshot. That join lives here.
- `src/constants/avatarTiles.ts` — per-avatar tile background colours (A01–A30), extracted from the Figma character-tile sheet (`618:5799`). Kept out of `tokens.css` on purpose: it's per-avatar data, not a reusable design token. **The sheet's listing order does not match `a01`–`a30`** (sheet slot 25 is a bat; `a25.png` is a seal clown), so anything taken from that sheet must be paired by *character*, not by index — each entry carries the character name in a comment for that reason.
- `src/store/roomStore.ts` — single zustand store holding all room state; applies the `roomVersion` ordering guard. Components never touch the socket directly.
- `src/App.tsx` — routing is driven by store state, not clicks, so a host action moves every participant's screen at once.
- `src/screens/Game/games/` — one component per minigame; `GameScreen.tsx` supplies the shared shell and guide popup.

## Development approach: build from components and tokens, not one-off styles

Screens get assembled by composing what already exists in `src/components/common/`, `src/styles/tokens.css`, and `src/assets/`, not by re-deriving styles per screen. This keeps the FHD layout consistent and means a token/asset/component change propagates everywhere instead of needing a find-and-replace across screens.

- Before writing new UI for a Figma node, check `src/components/common/` for a match first. Reuse it via props/variants; only add a new component there if the pattern is shared across screens (a truly screen-specific one-off can live next to that screen instead).
- Never hardcode a color, spacing, radius, shadow, or font value that already has an entry in `tokens.css`. If a Figma node needs a value that has no token yet, add the token to `tokens.css` rather than inlining the raw hex/px — that's what keeps `get_variable_defs` (currently empty, since this Figma file has no bound variables) from being the only source of truth.
- When a screen needs a variant of an existing common component (e.g. a new `Chip` color, a new `Badge` state) that doesn't exist yet, extend that component's props and `.module.css` rather than forking a copy.
- Downloaded image/SVG assets go under `src/assets/<category>/` (see `src/assets/avatars/`) and get reused across components/screens — don't inline as base64 and don't re-download an asset that's already in the repo.
- If the same layout fragment (e.g. a stat row, a header band) starts appearing in more than one screen, pull it into `src/components/common/` instead of copy-pasting the JSX.

## Commenting convention

Every file (`.ts`/`.tsx`/`.css`) carries short comments so intent is clear without reading the whole implementation — this project intentionally comments more than default practice. **All comments must be written in Korean (한글)**, including inline `//` and CSS `/* */` comments — not English, regardless of what language surrounding code/identifiers use. Apply this to all new code and when touching existing code:

- Write for a reader seeing the file for the first time, with no access to this conversation, the Figma file, or any other context — the comment alone must make the intent click. Spell out abbreviations and repo-only shorthand rather than assuming the reader already knows them.
- Every component function gets a one-line Korean comment above it stating what it renders and, if relevant, when to use it over a similar-looking component.
- Every non-obvious prop (variant enums, formatting expectations, anything not self-evident from its name/type) gets a one-line Korean comment.
- CSS rule blocks that encode a specific state or a value copied from the Figma spec (not an obvious default) get a short Korean comment, not a restatement of the property.
- Keep each comment to one line. Don't explain what the code literally does when the identifier already says so — explain the *why* or the *when-to-use*, briefly, in Korean.
- Comments describe the code as it is now, never its history. Don't write what a value used to be, that something was "fixed"/"corrected"/"temporary before this", who asked for a change, or which conversation/session produced it — that belongs in a commit message, not the code. If a past mistake is worth remembering, put it in project memory, not a comment.

## Architecture

**Styling: CSS Modules + global CSS custom properties, no CSS framework.** Design tokens live in `src/styles/tokens.css` as `:root` CSS variables (color, typography, spacing, radius, shadow, grid constants) and are consumed by both `*.module.css` files and inline styles. `src/styles/global.css` imports `tokens.css` and sets the base reset/body styles; `main.tsx` imports only `global.css`. (Never-hardcode-a-tokenized-value rule is under Development approach above.)

Gotcha: the base font is **IBM Plex Sans KR at `font-weight: 500`** (Medium), set once on `body` in `global.css`. The Figma spec uses Medium for every body/sub/meta text instance — do not let component styles reset to 400.

Fonts (Black Han Sans, Do Hyeon, IBM Plex Sans KR) are loaded via a Google Fonts `@import` at the top of `tokens.css`, not self-hosted.

**Component convention** (`src/components/common/`): one folder per component, `ComponentName.tsx` + `ComponentName.module.css`, re-exported from `src/components/common/index.ts`. Follow this pattern for new components — colocated module CSS, variant props mapped to CSS module class names (see `Button.tsx`/`Chip.tsx`/`Badge.tsx` for the `variant`/`color` → `styles[variant]` pattern), no external UI library.

**Layout constraint:** every screen is **authored at a fixed FHD 1920×1080 with no responsive breakpoints**. Grid constants for this (margins, column widths, band heights) are in `tokens.css` under the Grid section.

Window-size adaptation happens in exactly one place: `Viewport` (`src/components/common/Viewport/`) wraps the whole app in `main.tsx`, computes `min(innerWidth / 1920, innerHeight / 1080)` on resize into the `--app-scale` custom property, and applies it as a `transform: scale()` on a 1920×1080 stage centred in the window. So a screen still positions everything in 1920×1080 coordinates and the page never scrolls — `global.css` sets `overflow: hidden` on `html`/`body`/`#root` and deliberately sets **no** `min-width`/`min-height`. Don't add breakpoints or mobile-specific layout unless explicitly asked; if something must stay proportional to the stage, use px against 1080/1920, not `vh`/`vw` (viewport units ignore the transform — that's why `Modal` uses `max-height: 864px` rather than `80vh`).

**Design source (Figma):** file key `IIqIz0uigrSQJnyTDKDsg6` ("몰입 디자인"), page `0:1`. Node IDs `543:xxx` are numbered spec/cheat sheets (00 파운데이션 & 토큰 = `543:13`, and 01–13 cover each screen's exact layout/typography/component rules) — these are the source of truth for tokens and common components, already reflected in `tokens.css`. Node IDs `542:xxx` are the actual screen frames (not yet implemented) and are mapped to screen numbers (S-01, S-02, …) in an external screen-design-spec document, not part of this repo. Node IDs under `666:xxx`/`618:xxx` are a reusable-asset staging area (game icons, the 30-character avatar set, the character-tile state component at `618:5799`) — already extracted into `src/assets/avatars/` (30 PNGs, `a01`–`a30`) and `src/assets/icons/` (`arrow.svg`, `sparkle.svg`). When extending tokens or building real screens, re-fetch the relevant node via the Figma MCP `get_design_context` tool rather than assuming this scaffold already covers it — the foundation sheet (`543:13`), the waiting-room frame (`542:422`), the profile frame (`542:642`) and the character-tile sheet (`618:5799`) have been extracted; `tokens.css` and the common components now carry the real neo-brutalist system. The other `542:xxx` frames have **not** been applied yet — those screens use the right colours and components but a guessed layout.

**Applying a frame:** frames position everything on absolute FHD coordinates, so render the screen inside `<ScreenFrame fullBleed>` (drops the 59px padding so the body's top-left is page `(0,0)`) and place children with the frame's own `left`/`top` values. Figma child coordinates inside a bordered card are relative to that card's **padding box**, which is exactly what CSS absolute positioning uses — so the numbers transfer unchanged.

**Verifying a frame:** don't sign off by eyeballing two screenshots side by side — that catches position errors but misses wrong colours and wrong assets. Overlay the reference on the running page instead: take the frame's PNG via `get_screenshot`, inject its (short-lived) URL into the live page as an `<img>` at `position:absolute; width:1920px; height:1080px; opacity:.5`, and anything misaligned shows up as a double edge. For coordinates specifically, `getBoundingClientRect()` beats any screenshot — remember the 1920px layout is centred, so subtract `(innerWidth - 1920) / 2` from `x` before comparing to frame values.

**When the foundation sheet and a screen frame disagree, the frame wins** (user decision). The sheet says body text is IBM Plex Sans KR with an 18px floor; the actual frames use `Nanum Gothic Coding Bold` for meta lines, `Gothic A1 Bold` for chat, and go down to 16px (11–14px inside the settings panel). Take colours, border widths, hard shadows and radii from the sheet; take layout, fonts and sizes from the frame you are implementing.

Game icons are still placeholder emoji in `src/constants/gameVisuals.ts` — the real PNGs (game icons, crown, dice, play button, STEP badge) need `download_assets` with `rawImages`.

Known node → screen mapping: home `542:195`, profile `542:642`, waiting room (host) `542:422`, waiting room (guest) `542:5270`, ladder `542:935`, snipe `542:1432`, nunchi `542:3142`, timer `542:5622`, timer (number hidden) `542:5472`, roulette+guide `542:3720`, kingmaker+guide `542:4155`, timer+guide `542:4327`, nunchi+guide `542:3320`, kingmaker result (anon) `542:2173`, kingmaker result (named) `542:5326`, timer result `542:2292`, snipe result `542:2476`, nunchi result `542:2619`, nunchi all-eliminated `542:3525`, snipe tie `542:4755`. Note the home frame puts **both** "new room" and the join-code field on one screen — the current `/create` and `/join` split does not match it.

Kingmaker was **re-drawn with auto layout** under `878:xxx`, and those supersede its `542:xxx` frames: submit phase `878:1750`, vote phase `878:684`, tally result anon `878:2320`, tally result named `878:5221`. Auto-layout frames carry their structure as flex/gap instead of absolute coordinates, so port the outer skeleton as real flexbox — only the page-level start position stays fixed. Expect the same treatment for the remaining screens as they get redrawn.

To identify an unknown node cheaply, call `get_screenshot` with `maxDimension: 560` and `enableBase64Response: true` and just look at it. Alternatively call `get_metadata` and read the "Currently selected nodes" block at the top of the response — frame names carry the screen number (`S-04P · 실시간 대기방 (방장)`). It lists only the frames currently selected in Figma, capped at 16, so ask the user to select the ones you need. Do not `get_metadata` the whole page (`0:1`) — the XML is enormous.

**Figma asset gotcha:** when calling `download_assets` on a node, its `export` field (the composited render) bakes in an opaque background if the source shape has one — this silently produces assets with a solid white square instead of transparency (hit this exact bug with the character avatars). For artwork meant to sit on a colored/transparent background, use the `rawImages` field (the original uploaded source) instead, and verify with a quick alpha check before trusting it.

**Real-time socket events:** when implementing a waiting-room or in-game screen that sends/receives socket events, check `실시간 소켓 이벤트 명세 요약.md` (summary of `실시간 소켓 이벤트 명세.md`) for the event names, payloads, and confirmed decisions first.

**REST + WebSocket API contract:** when wiring any screen to real REST endpoints or socket events (room creation/join, profile, waiting room, in-game), check `API 기본 명세서 요약.md` (summary of `API 기본 명세서.md`) first — it's the authoritative request/response shapes, error codes, and the v1.0 corrections that override the older draft sections in the source doc.

**Game rules:** when implementing or changing a mini-game's round flow, scoring, config options, or tie-break logic, check `게임 기획안 요약.md` (summary of `게임 기획안.md`) first — per-game settings, progression steps, and judging rules for all 6 games.
