"""실제 시각을 제공하는 Clock 구현체. 테스트에서는 FixedClock(tests/conftest.py)으로 대체한다.

naive UTC(datetime.utcnow())로 통일한다 - SQLite는 timezone 정보를 보존하지 못해서, DB에 저장했다가
다시 읽은 값(naive)과 방금 만든 값(aware)을 비교하면 "can't subtract offset-naive and offset-aware
datetimes" 오류가 난다. tz 정보를 아예 안 쓰면 이 문제가 생기지 않는다.
"""

from datetime import datetime


class SystemClock:
    def now(self) -> datetime:
        return datetime.utcnow()
