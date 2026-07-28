# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — start the Vite dev server with HMR
- `npm run build` — type-check (`tsc -b`) then production-build (`vite build`); both must pass, the build fails on any TS error
- `npm run lint` — run Oxlint (`.oxlintrc.json`: `react`, `typescript`, `oxc` plugins)
- `npm run preview` — serve the production build locally

There is no test runner configured yet — no test script, no test files.

## Project state

ModuPick is currently a **pre-implementation scaffold**: a Vite + React 19 + TypeScript app containing design tokens and a common-component library extracted from Figma, plus a gallery page (`src/App.tsx`) that renders them for visual verification. No actual app screens (lobby, game rooms, results, etc.) have been built yet, no routing, no state management, no backend/socket integration. Not a git repo yet.

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

**Layout constraint:** the design is **fixed at FHD 1920×1080, no responsive breakpoints**. Grid constants for this (margins, column widths, band heights) are in `tokens.css` under the Grid section and `global.css` sets `min-width`/`min-height: 1920px/1080px` on `body`/`#root` accordingly. Don't add responsive/mobile behavior unless explicitly asked.

**Design source (Figma):** file key `IIqIz0uigrSQJnyTDKDsg6` ("몰입 디자인"), page `0:1`. Node IDs `543:xxx` are numbered spec/cheat sheets (00 파운데이션 & 토큰 = `543:13`, and 01–13 cover each screen's exact layout/typography/component rules) — these are the source of truth for tokens and common components, already reflected in `tokens.css`. Node IDs `542:xxx` are the actual screen frames (not yet implemented) and are mapped to screen numbers (S-01, S-02, …) in an external screen-design-spec document, not part of this repo. Node IDs under `666:xxx`/`618:xxx` are a reusable-asset staging area (game icons, the 30-character avatar set, the character-tile state component at `618:5799`) — already extracted into `src/assets/icons/` and `src/assets/avatars/characters/`. When extending tokens or building real screens, re-fetch the relevant node via the Figma MCP `get_design_context` tool rather than assuming this scaffold already covers it — only the 00-foundation sheet's tokens, the assets above, and a subset of common components (Card, Button, Chip, Avatar, StatTile, Badge, ChatBubble, Input, EmptyRow, SafeBandChip, CharacterTile) have been extracted so far.

**Figma asset gotcha:** when calling `download_assets` on a node, its `export` field (the composited render) bakes in an opaque background if the source shape has one — this silently produces assets with a solid white square instead of transparency (hit this exact bug with the character avatars). For artwork meant to sit on a colored/transparent background, use the `rawImages` field (the original uploaded source) instead, and verify with a quick alpha check before trusting it.
