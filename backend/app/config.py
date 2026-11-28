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

    # User management (KAN-69). The service role key can create and ban
    # accounts, so only the backend reads it; it is never sent to the browser.
    supabase_service_role_key: str = ""
    # Where the invite email sends new users: the page where they choose a
    # password. It must be in the Supabase project's allowed redirect URLs.
    invite_redirect_url: str = "http://localhost:3000/set-password"


def get_settings() -> Settings:
    return Settings()
