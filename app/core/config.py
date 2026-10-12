from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # App
    APP_ENV: str = "development"
    SECRET_KEY: str  # required — no insecure default; set in .env
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
    MPESA_CALLBACK_URL: str  # required — a placeholder default means callbacks silently never arrive
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

    # Credential encryption (Work Order 04 A4) — encrypts Barcode.token
    # (the TOTP secret seed) at rest. Required, no insecure default, same
    # reasoning as SECRET_KEY: a Fernet key, e.g. generated with
    # `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`
    CREDENTIAL_ENCRYPTION_KEY: str

    # Blockchain (Base Sepolia) — all optional. Left unset, minting stays a
    # logged no-op stub rather than the app failing to start; this feature is
    # additive, not load-bearing for the rest of the platform.
    BLOCKCHAIN_RPC_URL: str = ""
    NFT_CONTRACT_ADDRESS: str = ""
    MINTER_PRIVATE_KEY: str = ""

    @property
    def BLOCKCHAIN_CONFIGURED(self) -> bool:
        return bool(self.BLOCKCHAIN_RPC_URL and self.NFT_CONTRACT_ADDRESS and self.MINTER_PRIVATE_KEY)


@lru_cache
def get_settings() -> Settings:
    return Settings()
