"""서버 시각.

두 축을 함께 유지한다.

    벽시계   저장·표시·감사용. UTC aware datetime
    단조시계 판정용. 정수 밀리초. 시각 동기화로 뒤로 가지 않는다

판정에 벽시계를 쓰지 않는 이유는 시각 보정 때문이다. 시스템 시각은 NTP 동기화로
뒤로 갈 수 있고 그 위에서 경과 시간을 재면 음수 간격이 나온다.

테스트에서 고정하려면 모듈 전역 clock을 교체한다.
"""

import time
from datetime import UTC, datetime


class Clock:
    def now(self) -> datetime:
        """UTC aware 현재 시각. 저장·표시용이며 판정에 쓰지 않는다."""
        return datetime.now(UTC)

    def monotonic_ms(self) -> int:
        """프로세스 단조 시계의 정수 밀리초. 판정용이다."""
        return time.monotonic_ns() // 1_000_000

    def monotonic_s(self) -> float:
        """TTL 계산용 단조 초."""
        return time.monotonic()


clock = Clock()
