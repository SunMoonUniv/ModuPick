"""`_dispatch` 처리 지연 계측 — REQ-NFR-01의 서버 내부 처리 축.

REQ-NFR-01은 두 축을 요구한다. 왕복(클라이언트 시계 기준)은 devtools/latency.py가
이미 재고 있고(2026-08-12, 5경로 500표본, p95 9.1ms), 여기서는 서버가 **자기 단조
시계 하나로** 프레임 도착부터 처리 완료까지의 소요를 잰다. 도착·완료 두 시각을 서로
다른 시계로 재면 시각 동기 문제가 다시 생기므로, 반드시 app.infra.clock의 단조 시계
하나만 쓴다(09_nonfunctional.md REQ-NFR-01 "두 측정 모두 시계 하나만 쓰므로 기기 간
시각 동기가 필요 없다").

**처리 경로에 부담을 더하지 않는다.** record() 한 번은 dict 조회 하나와 list append
하나뿐이다. DB에 쓰지 않고 로그도 남기지 않는다 — 계측 자체가 재려는 지연에 끼어들면
계측값이 계측 대상을 왜곡한다.

devtools_enabled로 켠다/끈다 — devtools 계열과 같은 결을 따른다(app/config.py가
DEVTOOLS_ENABLED로 검증 콘솔을 가르는 것과 동일한 스위치). 새 스위치를 두지 않은
이유는 둘이다.
    1. 이 계측은 제품 기능이 아니라 검증 도구다 — devtools/latency.py 하나만 읽는다.
       배포 환경(docker-compose.yml의 DEVTOOLS_ENABLED=false)에서 표본이 무한정
       쌓여 메모리를 먹을 이유가 없다.
    2. 이 값을 읽어 가는 경로(app/ws/router.py의 devtools:metrics 핸들러)도 같은
       devtools_enabled 게이트 안에 있다. 스위치를 하나로 모으면 "수집은 꺼져 있는데
       조회 경로만 열려 있는" 상태가 생기지 않는다.

이벤트 이름별로 표본을 가른다. game:action처럼 판정을 동반하는 이벤트와 chat:send처럼
저장만 하는 이벤트를 합쳐 재면 어느 경로가 100ms 기준을 못 넘기는지 가려낼 수 없다.
"""

from dataclasses import dataclass, field

from app.config import settings

#: 이벤트 하나가 보관하는 최근 표본 상한. 오래 도는 방 하나가 프로세스 수명 내내
#: 메모리를 무한정 먹지 않도록 원형으로 잘라낸다 — devtools/latency.py의 최대
#: 회차(수백 회) 호출을 몇 번 반복해도 넉넉한 여유다.
MAX_SAMPLES_PER_EVENT = 5000


@dataclass(slots=True)
class DispatchLatency:
    """이벤트별 서버 내부 처리 지연(정수 밀리초) 표본.

    **누적이다.** 서버 프로세스가 살아 있는 동안 계속 쌓인다 — 재기동 전까지의
    분포를 사후에 낼 수 있어야 한다는 REQ-NFR-16과 같은 취지다. 요청 하나만의
    값이 아니라 지금까지의 히스토그램을 보고 싶을 때 읽는다.
    """

    _samples: dict[str, list[int]] = field(default_factory=dict)

    def record(self, event: str, elapsed_ms: int) -> None:
        """devtools_enabled가 꺼져 있으면 즉시 반환한다 — 표본을 쌓지 않는다."""
        if not settings.devtools_enabled:
            return
        bucket = self._samples.setdefault(event, [])
        bucket.append(elapsed_ms)
        overflow = len(bucket) - MAX_SAMPLES_PER_EVENT
        if overflow > 0:
            del bucket[:overflow]

    def snapshot(self) -> dict[str, list[int]]:
        """이벤트별 표본의 복사본. 호출자가 원본 리스트를 바꾸지 못하게 한다."""
        return {event: list(values) for event, values in self._samples.items()}


#: 프로세스 전역 싱글턴. runtime_store와 같은 이유로 하나만 둔다 — 단일 인스턴스·
#: 워커 1개 구성이라 프로세스 간 합산이 필요 없다(ADR-02).
dispatch_latency = DispatchLatency()
