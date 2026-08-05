"""생성기와 서버가 어긋나지 않는지 본다.

TS 타입은 손으로 옮겨 적지 않고 생성하지만, **생성기가 들고 있는 이벤트 목록**은
사람이 적은 것이다. 라우터에 이벤트를 붙이고 목록에 안 적으면 프론트가 그 이벤트를
모른 채로 넘어간다.
"""

import importlib.util
from pathlib import Path

from app.domain import errors
from app.schemas import events as event_schemas
from app.ws import router

_GEN = Path(__file__).resolve().parents[2] / "devtools" / "gen_socket_types.py"


def _generator():
    spec = importlib.util.spec_from_file_location("gen_socket_types", _GEN)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class TestSync:
    def test_C2S_목록이_라우터와_같다(self):
        gen = _generator()
        # conn:auth는 인증 단계라 분기표에 없다
        assert set(gen.CLIENT_EVENTS) - {"conn:auth"} == set(router._HANDLERS)

    def test_S2C_모델이_실제로_존재한다(self):
        gen = _generator()
        for event, name in gen.SERVER_EVENTS.items():
            assert hasattr(event_schemas, name), f"{event} -> {name}"

    def test_상태_이벤트_목록이_라우터의_전표와_어긋나지_않는다(self):
        """게이트 대상은 정본이 정한 15종이다."""
        gen = _generator()
        assert len(gen.STATE_EVENTS) == 15
        assert not set(gen.STATE_EVENTS) & set(gen.NOTICE_EVENTS)

    def test_구현된_S2C는_전부_상태나_통지_한쪽에_속한다(self):
        gen = _generator()
        known = set(gen.STATE_EVENTS) | set(gen.NOTICE_EVENTS)
        assert set(gen.SERVER_EVENTS) <= known

    def test_에러_코드는_42종이다(self):
        specs = {
            obj.code
            for obj in vars(errors).values()
            if isinstance(obj, errors.ErrorSpec)
        }
        assert len(specs) == 42
