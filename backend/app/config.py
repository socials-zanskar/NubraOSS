from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "NubraOSS API"
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    nubra_prod_base_url: str = "https://api.nubra.io"
    nubra_uat_base_url: str = "https://uatapi.nubra.io"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()


def get_cors_origins() -> list[str]:
    return [origin.strip() for origin in settings.cors_origins.split(",") if origin.strip()]
