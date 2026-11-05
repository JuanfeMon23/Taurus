from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str
    # Frontend local: `pnpm local` (4321) y `pnpm dev` (3000, puerto por defecto de Nuxt).
    cors_origins: list[str] = [
        "http://localhost:4321",
        "http://127.0.0.1:4321",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]


def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
