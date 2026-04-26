from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


ENV_FILE = Path(__file__).resolve().parents[1] / ".env"


class Settings(BaseSettings):
    app_name: str = "NubraOSS API"
    cors_origins: str = "http://localhost:5173,http://127.0.0.1:5173"
    frontend_dev_origin: str = "http://127.0.0.1:5173"
    serve_frontend: bool = False
    nubra_prod_base_url: str = "https://api.nubra.io"
    nubra_uat_base_url: str = "https://uatapi.nubra.io"
    cloudflared_path: str = "cloudflared"
    cloudflare_tunnel_target_url: str = "http://127.0.0.1:8000"
    sqlite_db_path: str = str(Path(__file__).resolve().parents[1] / "data" / "nubraoss.sqlite3")
    supabase_db_url: str = ""
    supabase_db_host: str = ""
    supabase_db_port: int = 5432
    supabase_db_name: str = "postgres"
    supabase_db_user: str = "postgres"
    supabase_db_password: str = ""

    model_config = SettingsConfigDict(
        env_file=str(ENV_FILE),
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()


def get_cors_origins() -> list[str]:
    return [origin.strip() for origin in settings.cors_origins.split(",") if origin.strip()]


def get_sqlite_db_path() -> Path:
    return Path(settings.sqlite_db_path).expanduser().resolve()


def get_supabase_dsn() -> str:
    if settings.supabase_db_url.strip():
        return settings.supabase_db_url.strip()
    if settings.supabase_db_host.strip() and settings.supabase_db_password.strip():
        return (
            f"host={settings.supabase_db_host.strip()} "
            f"port={settings.supabase_db_port} "
            f"dbname={settings.supabase_db_name.strip()} "
            f"user={settings.supabase_db_user.strip()} "
            f"password={settings.supabase_db_password.strip()}"
        )
    return ""
