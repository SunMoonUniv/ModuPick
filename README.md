# ModuPick (모두픽)

> 모두가 납득하는 유쾌한 선택 — 팀 의사결정을 실시간 미니게임으로

조별 과제·스터디·사내 TF에서 팀장 정하기, 역할 분담 같은 결정에 쓰는 시간과 눈치를 없앤다.
링크 하나로 모여서 **운명의 룰렛 · 랜덤 사다리 · 킹메이커 · 시간초 잡기 · 익명 저격 · 눈치게임**
6종 중 하나를 돌리면, 결과는 서버가 정하고 모두에게 똑같이 보인다. 로그인도 설치도 없다.

```
 표지  ──[MODU-427132]──▶  대기방  ──[게임 시작]──▶  결과 PNG 저장
   방 만들기 / 코드 입장      2~10명 · 실시간 채팅        전원 동시 확인
```

---

## 📄 문서

스펙 문서는 [`docs/`](docs/)에 있습니다.

| 알고 싶은 것 | 문서 |
|---|---|
| 왜 만드나 | [`docs/draft_plan.md`](docs/draft_plan.md) — 기획안 |
| **사용자가 무엇을 할 수 있어야 하나 · 완료를 어떻게 판정하나** | [`docs/requirements.md`](docs/requirements.md) — 요구사항 명세서 ★ |
| **무엇을 만들어야 하나 · 어디까지 됐나** | [`docs/features.md`](docs/features.md) — 기능 명세서 ★ |
| **이 화면에 뭘 넣어야 하나** | [`docs/screens.md`](docs/screens.md) — 화면 목록 · 기능 매핑 ★ |
| 이 게임은 누가 이기나 | [`docs/games.md`](docs/games.md) — 미니게임 6종 상세 규칙 |
| API가 어떻게 생겼나 | [`docs/api.md`](docs/api.md) — REST · 소켓 · 에러 코드 |
| 데이터가 어떻게 쌓이나 | [`docs/db.md`](docs/db.md) — DB 모델링 · 잠금 순서 |
| 무슨 기술을 쓰나 | [`docs/techstack.md`](docs/techstack.md) — 기술 스택과 결정 근거 |
| 화면이 어떻게 생겼나 | [`docs/draft_design/`](docs/draft_design/) — 웹디자인 시안 |

> ⚠️ **문서 정합성: 2026-07-29 기준 미확정 2건** — [Q-19 성능 목표치](docs/requirements.md#8-미확정-항목--팀-확정-필요) · **[Q-20 DB가 MySQL인가 PostgreSQL인가](docs/requirements.md#8-미확정-항목--팀-확정-필요)**. 둘 다 팀 회의 안건이며 **Q-20은 백엔드 착수를 막습니다.**
> 확정된 설계 결정 46건(D-01 ~ D-48 · 폐기 2건 제외)은 [`requirements.md §7`](docs/requirements.md#7-확정된-설계-결정)에 있고 `api.md`에 전부 반영되어 있습니다.
> 스펙이 어긋나면 **`requirements.md`가 정본**입니다. 고치기 전에 [`§9.4 정합성 점검 방법`](docs/requirements.md#94-정합성-점검-방법)을 보세요 — **"반영 완료"라고 적기 전에 그 명령을 실제로 돌립니다.**

### 문서 간 역할

```
draft_plan.md      왜 만드는가              기획 의도의 출처
      ↓
requirements.md    사용자가 무엇을 하고 싶은가   US-1xx · 수용 기준
      ↓
features.md        그러려면 무엇을 만들어야 하나  F-1xx · 담당 레이어 · 구현 상태
      ↓
screens.md         그 기능이 어느 화면에 있나    S-01 ~ C-05
      ↓
games.md / api.md / techstack.md    어떻게 만드는가   판정 규칙 · 인터페이스 · 기술
```

`F-1xx`는 `US-1xx`와 번호대가 대응합니다. 기능에서 요구사항을, 요구사항에서 기능을 양방향으로 찾을 수 있습니다.

스펙을 바꿀 때는 `requirements.md`의 해당 스토리를 먼저 고치고, `features.md`·`screens.md`·`api.md` 순으로 함께 수정합니다.

---

## 🛠 기술 스택

| 영역 | 선택 |
|---|---|
| 백엔드 | Python · FastAPI |
| 프론트엔드 | React + Vite · TypeScript |
| 실시간 | Native WebSocket |
| DB | PostgreSQL |
| 인프라 | Docker · Kubernetes · Nginx · GitHub Actions |

자세한 결정 근거와 보류한 대안은 [`docs/techstack.md`](docs/techstack.md).

---

## 📦 저장소 구조

```
ModuPick/
├── README.md              이 문서
├── docs/                  스펙 문서
│   ├── requirements.md    요구사항 명세서 (사용자 스토리 · NFR · 확정/미확정 결정)
│   ├── features.md        기능 명세서 (기능 98건 · 커버리지 · 구현 현황)
│   ├── screens.md         화면 목록 · 기능 매핑 (화면 35종)
│   ├── games.md           미니게임 6종 상세 규칙
│   ├── api.md             REST · 소켓 이벤트 · 에러 코드
│   ├── db.md              DB 모델링 (⚠️ MySQL 기준 — techstack.md와 충돌)
│   ├── techstack.md       기술 스택
│   ├── draft_plan.md      기획안 (원본 자료)
│   └── draft_design/      웹디자인 시안 (PNG · SVG)
├── mvp/                   프로토타입 데모 (React · mock 데이터 · 방장 시점)
├── frontend/              실제 프론트엔드 (미착수)
└── backend/               실제 백엔드 (미착수)
```

> `mvp/`는 화면·게임 흐름을 검증하는 **프로토타입**이다. 실제 제품 코드는
> `frontend/`·`backend/`에 따로 만든다.

### 지금 어디까지 왔나

| 단계 | 상태 |
|---|---|
| 기획안 · 요구사항 · 기능 · 화면 문서화 | ✅ 완료 |
| mock 기반 화면 개발 | 🔶 방장 시점 완료 · **참여자 시점(S-04P) 미착수** |
| 실제 API · 데이터 연동 | ⬜ 백엔드 미착수 |

남은 화면과 착수 순서는 [`screens.md §8`](docs/screens.md#8-구현-현황과-남은-화면)에 정리돼 있습니다.
