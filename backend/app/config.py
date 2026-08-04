from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # 포트 3307 — docker-compose.yml 참고. 로컬 mysqld가 3306을 쓰는 환경을 피했다.
    # 계정은 modupick_app이며 participants DELETE 권한이 없다(sql/grants.sql).
    database_url: str = "mysql+aiomysql://modupick_app:apppass@127.0.0.1:3307/modupick"
    cors_origins: str = "http://localhost:5173"

    # 검증 콘솔(devtools/console.html)을 API 서버가 직접 내려줄지 여부.
    # **같은 오리진이어야 한다** — file://로 열면 Origin이 null이라 CORS에 막힌다.
    # 배포 시 DEVTOOLS_ENABLED=false로 끈다.
    devtools_enabled: bool = True

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


settings = Settings()
