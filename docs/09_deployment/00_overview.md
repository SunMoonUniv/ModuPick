# 배포 · 인프라 · 운영

> ⚠️ **아직 채우지 않은 문서다.** 배포 대상이 없다.
> 최종 수정: 2026-07-26 · 소유자: [`TEAM.md`](../TEAM.md) 참조

---

## 언제 채우나

**첫 배포를 시도하기 전**에 작성한다. 배포는 즉흥으로 하면 반드시 망가진다.

## 이미 정해진 것

| 항목 | 값 |
|---|---|
| 컨테이너 | Docker |
| 오케스트레이션 | Kubernetes |
| 라우팅 · 트래픽 분산 | Nginx |
| 배포 자동화 | GitHub Actions |

근거는 [`03_architecture/00_tech_stack.md`](../03_architecture/00_tech_stack.md).

## ⚠️ 배포 전에 반드시 해결해야 하는 것

**[D-06](../DECISIONS.md#d-06)이 미결이면 배포 구성을 확정할 수 없다.**

기본안(서버 인메모리)을 채택하면 방 상태가 특정 파드의 메모리에만 존재한다. 그 결과,

| 항목 | 제약 |
|---|---|
| `replicas` | **1로 고정해야 한다.** 2 이상이면 같은 방 참가자가 서로를 못 본다 |
| 무중단 배포 | **불가.** 재시작하면 진행 중인 방이 전부 사라진다 |
| 수평 확장 | 불가 |
| 오토스케일링 | 불가 |

Kubernetes를 쓰면서 `replicas=1`에 무중단 배포도 못 하는 구성은 사실상 K8s의 이점을 포기하는 것이다.
**Redis 도입([D-06](../DECISIONS.md#d-06) B안) 여부를 배포 설계 전에 결정하는 편이 낫다.**

## 무엇을 쓸 것인가

| 항목 | 설명 |
|---|---|
| 환경 구분 | local / staging / production 각각의 용도와 접근 방법 |
| 배포 파이프라인 | GitHub Actions 워크플로 단계, 트리거 브랜치 |
| K8s 매니페스트 | Deployment · Service · Ingress · ConfigMap · Secret 구성 |
| Nginx 설정 | **WebSocket 업그레이드 프록시 설정** (`Upgrade`·`Connection` 헤더) |
| 시크릿 관리 | DB 비밀번호 등을 어디에 두는가 |
| 롤백 절차 | 배포가 깨졌을 때 되돌리는 방법 |
| 모니터링 · 로그 | [`01_overview/00_product.md`](../01_overview/00_product.md) §7 지표 집계 수단과 연결 |

> **Nginx WebSocket 프록시는 놓치기 쉬운 함정이다.** 기본 설정으로는 WebSocket 핸드셰이크가 실패한다.
> ModuPick은 대기방 진입 이후 전 기능이 소켓이라([`06_api/02_socket.md`](../06_api/02_socket.md)) 이게 안 되면 아무것도 동작하지 않는다.
