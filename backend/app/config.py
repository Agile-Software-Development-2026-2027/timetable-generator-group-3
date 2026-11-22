from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_url: str = "sqlite:///./timetable.db"

    # Supabase Auth. Set SUPABASE_JWT_SECRET for projects that sign tokens
    # with the legacy shared secret (HS256), or SUPABASE_JWKS_URL for projects
    # that use asymmetric signing keys. When SUPABASE_URL is set, tokens must
    # also have been issued by that project.
    supabase_url: str = ""
    supabase_jwt_secret: str = ""
    supabase_jwks_url: str = ""
    supabase_jwt_audience: str = "authenticated"


def get_settings() -> Settings:
    return Settings()
