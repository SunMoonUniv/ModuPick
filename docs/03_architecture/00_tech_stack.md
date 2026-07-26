# 기술 스택

> 최종 수정: 2026-07-26 · 소유자: [TEAM.md](../TEAM.md) 참조

---

## 1. 스택 요약

| 영역 | 선택 |
|---|---|
| **백엔드** | Python · **FastAPI** |
| **프론트엔드** | **React + Vite** · TypeScript · HTML/CSS |
| **실시간** | **Native WebSocket** ([D-26](../DECISIONS.md#d-26)) |
| **DB** | **PostgreSQL** |
| **컨테이너** | Docker · Docker Compose |
| **오케스트레이션** | Kubernetes |
| **라우팅 / 트래픽 분산** | Nginx |
| **배포 자동화** | GitHub Actions |

---

## 2. 대안 비교 및 결정 근거

| 비교 항목 | 선택 | 보류한 대안 | 판단 |
|---|---|---|---|
| Frontend | **React + Vite** | Next.js | MVP는 SEO·SSR보다 실시간 SPA와 빠른 개발이 중요 |
| Backend | **FastAPI** | NestJS / Spring Boot | Python 경험을 활용하고 비동기 API·WebSocket을 한 흐름으로 학습 |
| DB | **PostgreSQL** | MySQL | 둘 다 운영하지 않고 한 DB로 통일. 관계·제약조건 중심 설계에 적합 |
| 실시간 프로토콜 | **Native WebSocket** | Socket.IO | 의존성과 프로토콜을 단순화. 룸 관리·브로드캐스트는 직접 구현 |
| 로컬 환경 | **Docker Compose** | Kubernetes만 사용 | 일상 개발은 단순하게 유지하고 배포 단계에서 Kubernetes 적용 |

> **Next.js는 채택하지 않았다.** 구 `legacy/document.md:8`에 "next.js"가 적혀 있었으나
> 이는 기술 스택 확정 이전의 메모이며 현재 유효하지 않다.

---

## 3. Native WebSocket을 고른 대가

Socket.IO를 쓰지 않기로 했으므로([D-26](../DECISIONS.md#d-26)) 아래를 **직접 구현**해야 한다.

| 항목 | 직접 구현 필요 | 비고 |
|---|---|---|
| 룸(room) 관리 | ✅ | `room:{4자리코드}` 단위 그룹 관리 |
| 브로드캐스트 | ✅ | 같은 룸의 전체 연결에 순회 전송 |
| 핸드셰이크 인증 | ✅ | 연결 시 토큰 + 방 코드 검증 |
| 하트비트 / 연결 감지 | ✅ | ping/pong으로 끊긴 연결 회수 |
| **재연결 · 상태 복구** | ❌ **불필요** | [D-04](../DECISIONS.md#d-04)로 재접속 개념 자체가 없음 |

재접속을 구현하지 않기로 한 덕분에 Native WebSocket의 가장 큰 부담이 사라졌다.
단 [D-04](../DECISIONS.md#d-04)가 승인 대기이며, grace period 안이 채택되면 **이탈 대기 큐를 직접 만들어야 한다.**

---

## 4. PostgreSQL은 무엇에 쓰나

⚠️ **[D-06](../DECISIONS.md#d-06)이 승인 대기다.** 기본안 기준으로는 아래와 같다.

| 저장 대상 | 위치 |
|---|---|
| 게임 메타 6종 · 아바타 카탈로그 15종 | **PostgreSQL** (정적 데이터) |
| 방 · 멤버 · 라운드 · 게임 상태 · 채팅 | **서버 인메모리** |

즉 **PostgreSQL은 읽기 전용 카탈로그 역할**만 한다. 자세한 내용은 [`03_architecture/01_data_model.md`](01_data_model.md).

> 구 `legacy/document.md:7`의 "DB 존재 없음"과 구 `legacy/techstack.md:23`의 "PostgreSQL"이
> 정면 충돌한 상태였다. **둘 다 부분적으로 맞다** — 런타임 상태는 DB를 쓰지 않고, 정적 카탈로그만 DB를 쓴다.

---

## 5. 인프라 제약 ⚠️

[D-06](../DECISIONS.md#d-06) **기본안(인메모리)을 채택하면 서버를 여러 개 띄울 수 없다.**

방 상태가 특정 프로세스의 메모리에만 존재하므로, 파드가 2개 이상이면
같은 방의 참가자가 서로 다른 파드에 붙어 **서로를 보지 못한다.**

| 항목 | 기본안에서의 제약 |
|---|---|
| Kubernetes `replicas` | **1로 고정해야 한다** |
| 무중단 배포 | 불가 — 재시작하면 진행 중인 방이 전부 사라진다 |
| 수평 확장 | 불가 |
| 동시 방 수 상한 | 단일 프로세스의 메모리·소켓 한계에 종속 |

**이 제약을 없애려면** [D-06](../DECISIONS.md#d-06)의 (B) Redis 도입 또는 (C) PostgreSQL 전면 영속을 선택해야 한다.
팀 프로젝트 시연 규모에서는 기본안으로 충분하다고 판단했으나, **결정이 필요하다.**

---

## 6. 후속 작업 (Notion)

일정·태스크 관리는 Notion을 유지한다([TEAM.md §4](../TEAM.md)).

- DB 모델링 / DB 구성
- 백엔드 개발
- 프론트 개발

> Notion에 남아 있는 **스펙 문서**(기술 스택 · API 명세 등)는 폐기다. 이 저장소의 `docs/`가 정본이다.
