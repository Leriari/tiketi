from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # App
    APP_ENV: str = "development"
    SECRET_KEY: str = "changeme"
    DEBUG: bool = True
    API_V1_PREFIX: str = "/api/v1"

    # Database
    DATABASE_URL: str = "sqlite:///./tiketi_dev.db"  # fallback for local dev

    # Redis
    REDIS_URL: str = "redis://localhost:6379/0"

    # M-Pesa Daraja
    MPESA_CONSUMER_KEY: str = ""
    MPESA_CONSUMER_SECRET: str = ""
    MPESA_SHORTCODE: str = "174379"
    MPESA_PASSKEY: str = ""
    MPESA_CALLBACK_URL: str = "https://example.com/api/v1/payments/mpesa/callback"
    MPESA_ENV: str = "sandbox"

    @property
    def MPESA_BASE_URL(self) -> str:
        if self.MPESA_ENV == "production":
            return "https://api.safaricom.co.ke"
        return "https://sandbox.safaricom.co.ke"

    # JWT
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60

    # OTP
    OTP_EXPIRE_SECONDS: int = 300

    # TOTP
    TOTP_ISSUER: str = "TiketiKE"


@lru_cache
def get_settings() -> Settings:
    return Settings()
