# 04 기술 선정 사유

> **대상**: ModuPick(모두픽) — 카테고리별 기술 결정 근거와 폐기된 대안
> **작성일**: 2026-08-02
> **원천**: docs_legacy/techstack.md(구 스택 문서 43줄) · git 529e312(docs/db.md §3 확정 정책) · git ecceb11(docs/03_architecture/00_tech_stack.md · docs/09_deployment/00_overview.md · docs/DECISIONS.md D-06·D-26) · [../README.md](../README.md)(고정 기준·전역 불변식)

각 기술 결정의 근거를 카테고리별로 기록한다. 확정된 제품 결정 원문은 [../01_overview/06_design_decisions.md](../01_overview/06_design_decisions.md)에, 기술결정 번호(ADR)는 [../04_architecture/08_decision_records.md](../04_architecture/08_decision_records.md)가 채번한다 — 본 문서는 새 ID를 만들지 않고 판단 근거만 서술한다.

## 종합 비교

| 영역 | 채택 | 보류·폐기한 대안 | 판단 |
|------|------|-------------------|------|
| 프론트엔드 | React + Vite | Next.js | MVP는 SEO·SSR보다 실시간 SPA와 빠른 개발이 중요하다 |
| 백엔드 | FastAPI | NestJS · Spring Boot | Python 경험을 활용하고 비동기 REST·WebSocket을 한 프레임워크로 다룬다 |
| 실시간 프로토콜 | Native WebSocket | Socket.IO | 재접속을 지원하지 않는 설계라 Socket.IO의 자동 재연결이 필요 없다 — 의존성과 프로토콜을 직접 통제한다 |
| 데이터베이스 | MySQL 8.4 | PostgreSQL | db.md의 스키마 모델링이 이미 MySQL 기준으로 끝나 있어 다시 쓰는 비용이 없다 |
| 상태 저장 위치 | 서버 인메모리(진행 중 상태) + MySQL(방·참가자·라운드·선택지·투표·확정 결과) | Redis(다중 인스턴스 상태 동기화) | 단일 인스턴스·워커 1개가 전제라 인스턴스 간 동기화 채널이 필요 없다 |
| 배포·오케스트레이션 | AWS EC2 단일 인스턴스 + Docker Compose | Kubernetes | replicas=1 고정·무중단 배포 불가 조합에서는 Kubernetes의 이점이 없다 |
| 로컬 개발 환경 | Docker Compose | — | 배포 환경과 구성이 같아져 로컬/배포 이원화가 사라졌다 |
| 리버스 프록시 | Nginx(TLS 종단·WebSocket 업그레이드 프록시) | — | 인스턴스가 하나로 줄며 "트래픽 분산" 역할은 없어지고 TLS·프록시 역할만 남았다 |

## 프론트엔드

| 결정 | 근거 |
|------|------|
| React + Vite 채택(Next.js 보류) | docs_legacy/techstack.md §5가 MVP는 SEO·SSR보다 실시간 SPA와 빠른 개발이 중요하다고 판단했다. ModuPick 화면은 서버가 렌더링해야 할 콘텐츠(공개 검색 노출 대상 페이지)가 없고, 대기방 진입 이후 전 기능이 WebSocket 기반 실시간 갱신이라 클라이언트 SPA 모델과 맞는다 |
| zustand 채택 | 단일 스토어로 화면 전환·방 상태·게임 진행·오버레이를 한곳에서 관리한다(frontend/src/lib/store.ts). Redux 대비 보일러플레이트가 적고, 여러 화면 컴포넌트가 구독하는 값이 자주 바뀌는 실시간 UI에서 Context API보다 리렌더 범위를 좁게 제어할 수 있다 |
| 폰트 셀프호스팅(@fontsource) 채택 | 구글 폰트 CDN 등 외부 네트워크 요청 없이 빌드·배포한다. Vercel 정적 배포와 궁합이 좋고, 폰트 로딩 실패가 빌드를 막는 경로를 없앤다 |
| html-to-image 채택 | 결과를 공유 가능한 이미지로 저장하는 기능을 별도 서버 렌더링 없이 클라이언트 DOM 캡처로 구현한다 |

## 백엔드

| 결정 | 근거 |
|------|------|
| FastAPI 채택(NestJS·Spring Boot 보류) | docs_legacy/techstack.md §5 — Python 경험을 활용하고 비동기 API·WebSocket을 한 프레임워크·한 흐름으로 다룬다. 스키마 검증(pydantic)이 프레임워크에 내장돼 REST 요청 검증과 WebSocket 페이로드 검증을 같은 방식으로 처리할 수 있다 |
| SQLAlchemy(비동기) + aiomysql 채택 | ORM과 비동기 MySQL 드라이버를 FastAPI의 비동기 런타임과 같은 이벤트 루프에서 동작시킨다. 동기 드라이버(PyMySQL)를 애플리케이션 요청 경로에 쓰면 이벤트 루프가 DB I/O로 블로킹된다 |
| Alembic 채택 | 스키마 변경을 코드 리뷰 가능한 리비전 파일로 남긴다. autogenerate 결과는 후보안으로만 쓰고 사람이 DDL을 검토한다(git 529e312 docs/db.md §19) |

## 실시간 프로토콜 — Native WebSocket

| 결정 | 근거 |
|------|------|
| Native WebSocket 채택(Socket.IO 폐기) | docs_legacy/techstack.md §5 — 의존성과 프로토콜을 단순화하고, 룸 관리·브로드캐스트는 직접 구현한다. git ecceb11 docs/DECISIONS.md D-26이 이를 확정으로 기록했다 |
| Socket.IO를 폐기한 이유 | Socket.IO의 핵심 가치는 자동 재연결·전송 폴백·룸 관리 헬퍼다. 그런데 ModuPick은 재접속을 지원하지 않는다는 설계를 전역 불변식으로 확정했다(../README.md "재접속 | 불가하다. 나갔다 들어오면 새 참가자이며 진행 중인 판에는 낄 수 없다") — 연결이 끊기면 그 참가자를 즉시 퇴장 처리해야 하므로, Socket.IO가 자동으로 재연결을 시도하는 동작은 오히려 이 설계와 충돌한다. 남는 이점(전송 폴백 등)에 비해 의존성 하나를 통째로 얹는 비용이 크다고 판단해 폐기했다 |

## 데이터베이스 — MySQL로 통일(PostgreSQL 폐기)

| 결정 | 근거 |
|------|------|
| MySQL 8.4 채택(PostgreSQL 폐기) | docs_legacy/techstack.md는 초안 단계에서 PostgreSQL로 적혀 있었으나, db.md의 모델링(스키마·인덱스·잠금 순서)이 이미 MySQL 기준으로 끝나 있어 다시 쓰는 비용이 없는 MySQL로 통일했다(docs_legacy/techstack.md D-49, 2026-07-29 확정) |
| 폐기된 중간안 — PostgreSQL을 "정적 카탈로그 전용"으로 두는 3계층 모델 | git ecceb11 docs/03_architecture/00_tech_stack.md·docs/DECISIONS.md D-06(승인 대기 상태로 남아 있었다)은 한때 런타임 상태를 서버 인메모리에, 게임 메타·아바타 카탈로그 같은 정적 데이터만 PostgreSQL에 두는 분리안을 검토했다. 이 안은 D-49로 DB가 MySQL로 통일되며 자연히 폐기됐고, 현재 설계는 카탈로그 전용이 아니라 방·참가자·라운드·선택지·투표·확정 결과까지 MySQL이 영속 저장한다 — DB의 책임 범위가 원안보다 넓어졌다(../README.md 전역 불변식 "상태 경계") |

## 인프라·배포 — 단일 인스턴스 EC2 + Docker Compose(Kubernetes 폐기)

| 결정 | 근거 |
|------|------|
| AWS EC2 단일 인스턴스 + Docker Compose 채택(Kubernetes 폐기) | docs_legacy/techstack.md는 애초 클러스터 관리로 Kubernetes를 확정했고 §5는 "로컬 환경 | Docker Compose | Kubernetes만 사용 | 일상 개발은 단순하게 유지하고 배포 단계에서 Kubernetes 적용"이라고 로컬·배포를 나눠 두었다. 그러나 git ecceb11 docs/DECISIONS.md D-06과 docs/09_deployment/00_overview.md가 이 구성의 문제를 지적했다 — 방 상태를 서버 인메모리에 두는 기본안을 채택하면 Kubernetes의 replicas를 1로 고정해야 하고 무중단 배포도 할 수 없다("재시작하면 진행 중인 방이 전부 사라진다"). **replicas=1에 무중단 배포도 못 하는 구성은 Kubernetes가 주는 수평 확장·롤링 업데이트·오토스케일링의 이점을 전부 포기하면서, 매니페스트·Ingress·클러스터 운영이라는 복잡도만 떠안는 것과 같다.** ModuPick은 방 상태를 프로세스 메모리에 두는 것을 최종 확정했으므로(../README.md 전역 불변식 "인스턴스" — "백엔드는 단일 인스턴스·워커 1개다. 방 상태가 프로세스 메모리에 있으므로 수평 확장과 무중단 배포를 하지 않는다"), Kubernetes를 폐기하고 EC2 한 대 위에서 Docker Compose로 컨테이너를 직접 운영한다 |
| 로컬 개발 환경도 Docker Compose로 통일 | Kubernetes가 빠지며 구 스펙이 나눴던 "로컬은 Compose·배포는 K8s" 구도가 사라졌다. 이제 로컬과 EC2 배포가 같은 docker-compose.yml 계열 구성을 쓴다([03_database_infra.md](./03_database_infra.md)) |

## 캐시·상태 동기화 계층 — Redis 폐기

| 결정 | 근거 |
|------|------|
| Redis 미채택 | git ecceb11 docs/DECISIONS.md D-06은 수평 확장이 필요해지면 Redis를 방 상태 저장소로 추가하는 방안(B안)을 승인 대기로 남겨 뒀었다. ModuPick은 단일 인스턴스·워커 1개를 최종 전제로 확정했으므로 여러 프로세스 간 방 상태를 동기화할 채널 레이어 자체가 필요 없다 — Redis가 해결하려던 문제(다중 인스턴스 간 pub/sub 브로드캐스트)가 이 설계에서는 애초에 발생하지 않는다. 운영·학습할 스택을 하나 줄인다 |

## 리버스 프록시 — Nginx 역할 축소

| 결정 | 근거 |
|------|------|
| Nginx 유지, 역할은 트래픽 분산에서 TLS 종단·WebSocket 프록시로 축소 | docs_legacy/techstack.md는 Nginx를 "트래픽 분산 / 라우팅"으로 소개했다. 이는 여러 백엔드 인스턴스에 요청을 분산한다는 전제였는데, 인스턴스가 하나로 확정되며 분산할 대상이 사라졌다. 현재 Nginx의 역할은 인증서 기반 TLS 종단(wss 제공)과 WebSocket 업그레이드 헤더 프록시로 좁아졌다 — 상세는 [03_database_infra.md](./03_database_infra.md) |

## 관련 문서

- [README.md](./README.md) — 스택 한눈에·아키텍처 개요
- [01_frontend.md](./01_frontend.md) · [02_backend.md](./02_backend.md) · [03_database_infra.md](./03_database_infra.md) — 계층별 스택 상세
- [../01_overview/06_design_decisions.md](../01_overview/06_design_decisions.md) — 확정된 제품 결정(D-NN)
- [../04_architecture/08_decision_records.md](../04_architecture/08_decision_records.md) — 기술 결정(ADR) 채번 정본
