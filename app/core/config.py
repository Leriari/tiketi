from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache
from urllib.parse import urlsplit


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # App
    # Required, no default (Work Order 04 A5) — "unset" must never silently
    # resolve to "development". Every other APP_ENV == "development" check
    # in this codebase (dev-confirm, the OTP dev_otp field, this file's own
    # validator below) depends on that never happening by accident.
    APP_ENV: str
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
    # Required. Its host is this API's public address (API_ORIGIN): each STK
    # push gets its own callback URL there, with a secret token in the path.
    MPESA_CALLBACK_URL: str
    MPESA_ENV: str = "sandbox"

    @property
    def MPESA_BASE_URL(self) -> str:
        if self.MPESA_ENV == "production":
            return "https://api.safaricom.co.ke"
        return "https://sandbox.safaricom.co.ke"

    # M-Pesa payouts (optional): B2C to phones, B2B to paybills and tills.
    # From the Daraja portal: the shortcode money is sent from, its API
    # operator ("initiator") name, and that operator's password encrypted
    # with Safaricom's certificate (the portal's "Security Credential"
    # generator does this). Sandbox values are on its Test Credentials page.
    # Unset: payouts still work, but an admin pays each one by hand and
    # records the M-Pesa receipt (app/services/payouts.py).
    MPESA_PAYOUT_SHORTCODE: str = ""
    MPESA_INITIATOR_NAME: str = ""
    MPESA_SECURITY_CREDENTIAL: str = ""

    @property
    def MPESA_PAYOUTS_CONFIGURED(self) -> bool:
        return bool(self.MPESA_CONSUMER_KEY and self.MPESA_PAYOUT_SHORTCODE
                    and self.MPESA_INITIATOR_NAME and self.MPESA_SECURITY_CREDENTIAL)

    @property
    def API_ORIGIN(self) -> str:
        """This API's public address (https://host), taken from
        MPESA_CALLBACK_URL. Each STK push and payout gets its own callback
        URL under it (app/api/routes/payments.py, app/services/payouts.py)."""
        parts = urlsplit(self.MPESA_CALLBACK_URL)
        return f"{parts.scheme}://{parts.netloc}"

    @property
    def PAYOUT_RESULT_BASE_URL(self) -> str:
        """Where Safaricom sends payout results. Daraja refuses result URLs
        containing words like "query", so nothing below uses them."""
        return f"{self.API_ORIGIN}/api/v1/payouts/results"

    # Card payments through Paystack Checkout (optional). The secret key is
    # from the Paystack dashboard → Settings → API Keys & Webhooks; use the
    # test key (sk_test_…) for the demo. It also verifies webhooks, sent to
    # <API>/payments/paystack/webhook. Unset: no card option at checkout.
    PAYSTACK_SECRET_KEY: str = ""

    @property
    def PAYSTACK_CONFIGURED(self) -> bool:
        return bool(self.PAYSTACK_SECRET_KEY)

    # Firebase Authentication (optional): real SMS codes for phone login,
    # plus Google sign-in. Values from Firebase console -> Project settings
    # -> General -> "Your apps" (web app config). None of these are secrets —
    # the frontend reads them from GET /. Unset = phone codes come from this
    # backend's own OTP flow (dev inbox/console) and there's no Google option.
    FIREBASE_PROJECT_ID: str = ""
    FIREBASE_API_KEY: str = ""
    FIREBASE_AUTH_DOMAIN: str = ""
    FIREBASE_APP_ID: str = ""
    # Send phone codes by real SMS through Firebase. Needs the Phone provider
    # enabled in Firebase (Authentication -> Sign-in method), which in turn
    # needs the Blaze (billing) plan. Off = phone codes use this backend's
    # own OTP flow, while Google sign-in still goes through Firebase.
    FIREBASE_PHONE_AUTH: bool = False

    @property
    def FIREBASE_CONFIGURED(self) -> bool:
        return bool(self.FIREBASE_PROJECT_ID and self.FIREBASE_API_KEY)

    # JWT
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60

    # OTP
    OTP_EXPIRE_SECONDS: int = 300
    # console: log to server log (current/default). inbox: write a
    # Notification row, readable via the dev-only /dev/otp-inbox endpoint.
    # sms: raises NotImplementedError — documents that no gateway is wired
    # up rather than silently pretending one exists. See
    # app/services/otp_delivery.py.
    OTP_DELIVERY_CHANNEL: str = "console"
    # disabled: no way to send codes (no SMS gateway) — only DEMO_PHONE_CODES
    # numbers can use phone login; everyone else uses Google.

    # Fixed codes for a few demo numbers, for a public demo with no SMS:
    # "0700000001:482913,0700000002:771204". Treat like passwords.
    DEMO_PHONE_CODES: str = ""

    # How a Google user's phone number is confirmed the first time:
    #   sms        — a one-time code to that phone (needs real code delivery)
    #   unverified — the number is recorded unverified (default M-Pesa
    #                number only), for deployments with no SMS
    GOOGLE_PHONE_CONFIRMATION: str = "sms"

    # The "Simulate M-Pesa success" button, outside development too. Only
    # ever sensible against the Daraja *sandbox*.
    ALLOW_SIMULATED_PAYMENTS: bool = False

    # Comma-separated browser origins allowed to call the API, e.g.
    # "https://tiketi-6e9fd.web.app". Empty: "*" when DEBUG, otherwise none.
    CORS_ORIGINS: str = ""

    # Outgoing email (purchase receipts, ticket transfers) over SMTP, e.g.
    # Gmail with an app password: smtp.gmail.com:587. Unset: nothing is sent.
    SMTP_HOST: str = ""
    SMTP_PORT: int = 587
    SMTP_USERNAME: str = ""
    SMTP_PASSWORD: str = ""
    EMAIL_FROM: str = ""  # defaults to SMTP_USERNAME
    EMAIL_FROM_NAME: str = "ChainTix"
    # Where links in emails point.
    SITE_URL: str = "http://localhost:5173"

    @property
    def EMAIL_CONFIGURED(self) -> bool:
        return bool(self.SMTP_HOST and self.SMTP_USERNAME and self.SMTP_PASSWORD)

    # Unit costs for Admin → Platform Costs. Defaults are what the free
    # deployment really pays: free hosting, a testnet, the Daraja sandbox.
    COST_INFRA_MONTHLY_USD: float = 0.0
    COST_GAS_PER_TX_USD: float = 0.0
    COST_SMS_PER_MESSAGE_KES: float = 0.8
    COST_DARAJA_PER_TXN_KES: float = 0.0

    @property
    def demo_phone_codes(self) -> dict[str, str]:
        from app.schemas.schemas import normalize_kenyan_phone
        codes = {}
        for pair in filter(None, (p.strip() for p in self.DEMO_PHONE_CODES.split(","))):
            phone, _, code = pair.partition(":")
            codes[normalize_kenyan_phone(phone.strip())] = code.strip()
        return codes

    @property
    def simulated_payments(self) -> bool:
        return self.APP_ENV == "development" or self.ALLOW_SIMULATED_PAYMENTS

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
    # The previous TiketiNFT (cap only, no resale floor), when tickets were
    # minted on it before NFT_CONTRACT_ADDRESS was deployed. They stay on it
    # (app/services/web3_service.py). Empty when there's only one contract.
    NFT_LEGACY_CONTRACT_ADDRESS: str = ""
    MINTER_PRIVATE_KEY: str = ""
    # Block explorer for the chain above — links in ticket pages and emails.
    BLOCKCHAIN_EXPLORER_URL: str = "https://sepolia.basescan.org"
    BLOCKCHAIN_NETWORK_NAME: str = "Base Sepolia (testnet)"

    @property
    def BLOCKCHAIN_CONFIGURED(self) -> bool:
        return bool(self.BLOCKCHAIN_RPC_URL and self.NFT_CONTRACT_ADDRESS and self.MINTER_PRIVATE_KEY)

    @model_validator(mode="after")
    def _otp_inbox_requires_development(self) -> "Settings":
        """
        GET /dev/otp-inbox is a complete authentication bypass if it is ever
        reachable outside development (Work Order 04 A5). The route itself
        fail-closes on APP_ENV at request time, but that only helps if the
        channel that feeds it was never enabled in the first place — this
        makes the dangerous combination impossible to boot with at all,
        rather than merely discouraged.
        """
        if self.OTP_DELIVERY_CHANNEL == "inbox" and self.APP_ENV != "development":
            raise ValueError(
                "OTP_DELIVERY_CHANNEL=inbox is only permitted when "
                "APP_ENV=development — refusing to start."
            )
        if self.GOOGLE_PHONE_CONFIRMATION not in ("sms", "unverified"):
            raise ValueError("GOOGLE_PHONE_CONFIRMATION must be 'sms' or 'unverified'")
        for phone, code in self.demo_phone_codes.items():
            if not (code.isdigit() and len(code) == 6):
                raise ValueError(f"DEMO_PHONE_CODES: the code for {phone} must be 6 digits")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
