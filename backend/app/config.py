from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # 포트 3307 — docker-compose.yml 참고. 로컬 mysqld가 3306을 쓰는 환경을 피했다.
    # 계정은 modupick_app이며 participants DELETE 권한이 없다(sql/grants.sql).
    database_url: str = "mysql+aiomysql://modupick_app:apppass@127.0.0.1:3307/modupick"
    cors_origins: str = "http://localhost:5173"

    # 이탈 유예 — 소켓이 끊긴 것과 사람이 방을 떠난 것은 다르다. 그 사이의 창이다.
    # **코드에 상수로 박지 않는다.** 실측으로 조정할 값인데 상수면 조정에 배포가 필요하고,
    # 배포는 곧 진행 중인 방의 소멸이다(ADR-24).
    grace_member_s: float = 30.0
    grace_host_s: float = 60.0

    log_level: str = "INFO"

    # GET /api/rooms/{code}의 IP 단위 분당 상한. 코드 공간이 100만이라 상한이 없으면
    # 전수 탐색으로 방 존재 여부를 캐낼 수 있다(07_api/02_rest.md).
    lookup_rate_per_min: int = 20
    # 거절에 주는 지연. 무차별 대입의 속도를 한 번 더 깎는다.
    lookup_reject_delay_s: float = 0.5
    # 프록시 뒤에 있으면 X-Forwarded-For의 첫 항목을 클라이언트 IP로 본다.
    # **기본값은 끔** — 켠 채로 프록시 없이 노출하면 헤더를 위조해 상한을 우회한다.
    trust_proxy: bool = False

    # 가입 후 이 시간 안에 핸드셰이크가 없으면 슬롯을 푼다. **가입 경로에만 적용한다** —
    # 정본이 이 값을 POST /rooms/{code}/members 절에 두었다(07_api/02_rest.md).
    # 방 생성 직후의 방장 슬롯은 3분 미확정 회수와 10분 만료가 맡는다.
    unconnected_release_s: float = 15.0

    # 스위퍼 주기. 만료 지연 상한이 곧 이 값이다 — 최대 10분 + 60초 뒤에 삭제된다.
    sweep_interval_s: float = 60.0

    # 하트비트는 WebSocket 제어 프레임 ping이다. 애플리케이션 이벤트를 두지 않는다 —
    # 제어 프레임의 pong은 브라우저가 JS 실행 없이 돌려주므로 백그라운드 탭에서도 산다.
    # 이 값은 uvicorn에 넘긴다: --ws-ping-interval 20 --ws-ping-timeout 60
    ws_ping_interval_s: float = 20.0
    ws_ping_timeout_s: float = 60.0

    # 검증 콘솔(devtools/console.html)을 API 서버가 직접 내려줄지 여부.
    # **같은 오리진이어야 한다** — file://로 열면 Origin이 null이라 CORS에 막힌다.
    # 배포 시 DEVTOOLS_ENABLED=false로 끈다.
    devtools_enabled: bool = True

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


settings = Settings()
