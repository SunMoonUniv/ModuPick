# ModuPick (모두픽)

> 모두가 납득하는 유쾌한 선택 — 팀 의사결정을 실시간 미니게임으로

조별 과제·스터디·사내 TF에서 팀장 정하기, 역할 분담 같은 결정에 쓰는 시간과 눈치를 없앤다.
링크 하나로 모여서 **운명의 룰렛 · 랜덤 사다리 · 킹메이커 · 시간초 잡기 · 익명 저격 · 눈치게임**
6종 중 하나를 돌리면, 결과는 서버가 정하고 모두에게 똑같이 보인다. 로그인도 설치도 없다.

```
 S-01 표지  ──[MODU-4271]──▶  대기방  ──[게임 시작]──▶  결과 PNG 저장
   방 만들기 / 코드 입장          2~10명 · 실시간 채팅        전원 동시 확인
```

---

## 📄 문서

**스펙 정본은 [`docs/`](docs/)에 있습니다.** 시작은 [`docs/README.md`](docs/README.md).

| 알고 싶은 것 | 문서 |
|---|---|
| 뭘 만들고 뭘 안 만드나 | [`01_overview/`](docs/01_overview/00_product.md) |
| 코드가 어느 디렉터리에 있나 | [`02_file_structure/`](docs/02_file_structure/00_repository.md) ⚠️ |
| 무슨 기술을 쓰나 · 데이터는 어디 저장되나 | [`03_architecture/`](docs/03_architecture/00_tech_stack.md) |
| 사용자가 화면에서 뭘 하나 · 화면을 뭐라고 부르나 | [`04_requirements/`](docs/04_requirements/00_user_flow.md) |
| 이 게임은 누가 이기나 | [`05_game_rules/`](docs/05_game_rules/00_common.md) |
| API가 어떻게 생겼나 | [`06_api/`](docs/06_api/00_conventions.md) |
| 몇 px · 무슨 색 · 화면 규격 | [`07_design/`](docs/07_design/00_foundation.md) |
| 로컬에서 어떻게 띄우나 | [`08_development/`](docs/08_development/00_setup.md) ⚠️ |
| 어떻게 배포하나 | [`09_deployment/`](docs/09_deployment/00_overview.md) ⚠️ |
| 무엇을 테스트하나 | [`10_testing/`](docs/10_testing/00_strategy.md) ⚠️ |
| **왜 이렇게 정했나** | [`DECISIONS.md`](docs/DECISIONS.md) ★ |
| 누가 뭘 맡나 | [`TEAM.md`](docs/TEAM.md) |

⚠️ = 아직 채우지 않은 스텁. 무엇을 언제 쓸지는 문서 안에 적혀 있다.
문서 30개 전체 목록은 [`docs/README.md`](docs/README.md)에 있다.

> ⚠️ **구현 전에 [`docs/DECISIONS.md`](docs/DECISIONS.md)를 먼저 읽으세요.**
> 팀 승인이 필요한 결정 6건이 남아 있고, 확정 전까지 해당 영역 구현이 뒤집힐 수 있습니다.

---

## 🛠 기술 스택

| 영역 | 선택 |
|---|---|
| 백엔드 | Python · FastAPI |
| 프론트엔드 | React + Vite · TypeScript |
| 실시간 | Native WebSocket |
| DB | PostgreSQL |
| 인프라 | Docker · Kubernetes · Nginx · GitHub Actions |

자세한 결정 근거와 인프라 제약은 [`docs/03_architecture/00_tech_stack.md`](docs/03_architecture/00_tech_stack.md).

---

## ✅ 문서 정합성 검증

스펙 문서를 고친 뒤에는 반드시 실행하세요.

```bash
./docs/check-docs.sh
```

초대코드 자릿수, 폐기된 API, 구 화면 ID, 깨진 링크, 인덱스 미등록 문서 등 **17개 규칙**을 검사합니다.
2026-07-25 문서 재구축에서 해소한 모순이 다시 들어오는 것을 막습니다.

**문서를 고치는 순서**

1. [`docs/DECISIONS.md`](docs/DECISIONS.md)에 결정을 먼저 기록한다
2. 각 결정의 "영향" 목록에 적힌 문서를 수정한다
3. `./docs/check-docs.sh` 통과 확인

결정 없이 개별 문서만 고치면 다시 모순이 생깁니다. 자세한 규칙은 [`docs/TEAM.md`](docs/TEAM.md).

---

## 📦 저장소 구조

```
ModuPick/
├── README.md      이 문서
├── docs/          ★ 스펙 정본 — 10개 폴더 · 30개 문서 + 검증 스크립트
│   ├── 01_overview/       02_file_structure/   03_architecture/
│   ├── 04_requirements/   05_game_rules/       06_api/
│   ├── 07_design/         08_development/      09_deployment/
│   ├── 10_testing/
│   ├── DECISIONS.md       TEAM.md              check-docs.sh
└── legacy/        폐기된 구 문서 — 로컬 전용 (.gitignore)
```

**`legacy/`는 저장소에 올라가지 않습니다.** 로컬에만 두는 폐기 문서지만,
[`docs/DECISIONS.md`](docs/DECISIONS.md)의 근거 인용 **129건**이 `legacy/파일:줄번호`를 가리킵니다.
**로컬에서 삭제하면 "왜 이렇게 정했나"를 추적할 수 없게 되니** 지우지 마세요.
