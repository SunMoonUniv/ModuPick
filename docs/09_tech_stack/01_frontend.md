# 01 프론트엔드 스택

> **대상**: ModuPick(모두픽) — React 19 + Vite 기반 단일 페이지 애플리케이션
> **작성일**: 2026-08-02
> **원천**: frontend/package.json · frontend/vite.config.ts · frontend/tsconfig.app.json · frontend/.oxlintrc.json · frontend/src/main.tsx · frontend/src/styles/global.css · frontend/src/screens/Result.tsx · frontend/src/lib/store.ts

프론트엔드 계층의 기술 구성과 실제 설치된 버전을 정한다. 선정 근거는 [04_decisions_rationale.md](./04_decisions_rationale.md)에 둔다.

## 프론트엔드 스택

| 항목 | 버전 | 내용 |
|------|------|------|
| 프레임워크 | **React 19**(19.2.7) + react-dom(19.2.7) | 컴포넌트 기반 UI. StrictMode로 렌더링(frontend/src/main.tsx) |
| 빌드 도구 | **Vite**(8.1.1) | 개발 서버·HMR·프로덕션 번들링. plugins는 @vitejs/plugin-react(6.0.3) 하나뿐이며 그 외 커스터마이즈가 없다(frontend/vite.config.ts) |
| 언어 | **TypeScript**(~6.0.2) | 전 소스 정적 타입. 컴파일은 번들러(Vite)가 담당하고 tsc는 타입 검사 전용(noEmit) |
| 상태 관리 | **zustand**(5.0.14) | 단일 스토어(frontend/src/lib/store.ts)로 화면 전환(screen)·방 정보·참가자 목록·채팅·게임 설정·결과·모달·토스트를 관리한다 |
| 폰트 | @fontsource/black-han-sans · @fontsource/do-hyeon · @fontsource/gothic-a1 · @fontsource/nanum-gothic-coding(모두 5.3.0) | 셀프호스팅 웹폰트 4종. next/font 같은 프레임워크 내장 폰트 로더가 없어 각 패키지를 직접 import한다 |
| 이미지 캡처 | **html-to-image**(1.11.13) | 결과 카드 DOM을 PNG로 변환해 다운로드시킨다(frontend/src/screens/Result.tsx의 toPng) |
| 타입 정의 | @types/node(^24.13.2) · @types/react(^19.2.17) · @types/react-dom(^19.2.3) | 개발 시점 타입 |
| 린터 | **oxlint**(1.71.0) | Rust 기반 정적 분석. plugins는 react·typescript·oxc(frontend/.oxlintrc.json) |

## TypeScript 설정

frontend/tsconfig.app.json의 주요 옵션은 다음과 같다.

- target: es2023 · lib: ES2023 + DOM
- moduleResolution: bundler(번들러가 모듈 해석을 담당) · module: esnext
- jsx: react-jsx(React 17+ 자동 런타임, import React 불필요)
- verbatimModuleSyntax: true(타입 전용 import를 명시적으로 구분)
- noEmit: true(타입 검사 전용, 실제 트랜스파일은 Vite가 담당)
- 린팅형 옵션 — noUnusedLocals · noUnusedParameters · noFallthroughCasesInSwitch · erasableSyntaxOnly를 모두 켜 타입 제거만으로 자바스크립트가 되는 문법만 허용한다

빌드 명령(tsc -b && vite build)은 tsconfig.json의 프로젝트 참조(tsconfig.app.json·tsconfig.node.json)를 먼저 타입 검사한 뒤 Vite가 번들링한다.

## 상태 관리 — zustand

frontend/src/lib/store.ts는 zustand의 create 하나로 앱 전체 상태와 액션을 정의하는 단일 스토어다. 담는 상태는 화면(screen) · 방 정보(roomName·capacity·roomCode·members) · 채팅(chat) · 프로필 선점(takenAvatars) · 게임 진행(selectedGame·settings·playing·result) · 오버레이(modal·toast)이며, goto·createRoom·tryJoin·startGame 같은 액션이 상태 전이를 담당한다. 현재는 서버 연동이 없어 봇 시뮬레이션(makeBotMember·after 타이머)으로 진행을 대신하며, 이 경계는 docs/README.md의 "현재 상태"가 명시한다 — 실서버 연동 후에는 WebSocket 이벤트가 같은 스토어의 액션을 호출하는 구조로 대체된다.

## 폰트 구성

frontend/src/main.tsx가 앱 진입 시점에 폰트 4종을 로드한다.

- @fontsource/black-han-sans(400) · @fontsource/gothic-a1의 500·700 웨이트 · @fontsource/nanum-gothic-coding의 400·700 웨이트는 frontend/src/styles/global.css의 CSS 변수 --font-black · --font-gothic · --font-mono로 연결되어 있다. 역할은 제목·이름(Black Han Sans) · 본문(Gothic A1) · 메타 정보와 초대 코드 같은 고정폭 표기(Nanum Gothic Coding)다.
- @fontsource/do-hyeon은 로드는 되어 있으나 어떤 CSS 변수에도 연결되어 있지 않다. global.css의 주석("Black Han Sans·Do Hyeon은 400만 존재 — 가짜 볼드 합성 시 대형 글리프가 깨져 보임")만 남아 있어, 대형 글자 대체 폰트로 예비된 상태로 보이며 실제 화면 매핑은 아직 없다.
- 모든 폰트가 셀프호스팅이므로 빌드·런타임에 구글 폰트 등 외부 네트워크 요청이 없다.

## 이미지 캡처 — html-to-image

결과 화면(frontend/src/screens/Result.tsx)에서 결과 카드 DOM 참조(cardRef)를 html-to-image의 toPng로 PNG Data URL로 변환한 뒤 앵커 엘리먼트의 download 속성으로 파일을 내려받는다. pixelRatio 2 · backgroundColor 흰색 고정 옵션을 쓴다. 별도 서버 렌더링·워터마크 처리는 없다.

## 개발·빌드 명령

frontend/package.json의 scripts 절이 아래 네 명령을 정의한다.

```
npm run dev       # vite — 개발 서버(HMR)
npm run build     # tsc -b && vite build — 타입 검사 후 프로덕션 번들 생성
npm run lint      # oxlint — 정적 분석
npm run preview   # vite preview — 빌드 산출물 로컬 미리보기
```

Vercel 배포는 build 명령(npm run build)의 산출물(dist/)을 정적 호스팅한다. 별도 서버 런타임이 없으므로 Node.js 런타임 선택이나 서버 전용 코드 경로는 없다.

## 관련 문서

- [04_decisions_rationale.md](./04_decisions_rationale.md) — React + Vite를 선택한 근거
- [../08_screen/README.md](../08_screen/README.md) — 화면 인벤토리
- [../01_overview/05_priorities_roadmap.md](../01_overview/05_priorities_roadmap.md) — 프로토타입과 명세가 어긋난 지점의 구현 정정 목록
