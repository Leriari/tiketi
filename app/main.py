from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager
import redis
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.json_response import UTCJSONResponse
from app.db.session import get_db
from app.services.platform_settings import flag_on
from app.api.routes import auth, events, payments, tickets, gate, resale, dev, organisations, organiser_console, me, admin

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Schema is managed exclusively by Alembic migrations (see migrations/).
    yield


app = FastAPI(
    title="TiketiKE API",
    description="Web 2.5 Event Ticketing Platform for Kenya — M-Pesa + NFT + Dynamic QR",
    version="1.0.0",
    lifespan=lifespan,
    default_response_class=UTCJSONResponse,
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=(
        [o.strip() for o in settings.CORS_ORIGINS.split(",") if o.strip()]
        or (["*"] if settings.DEBUG else [])
    ),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)



# Redis backs the OTP store and rate limits, so every login request needs
# it. Unhandled, a dead Redis surfaces as a bare 500 with no CORS headers —
# which the browser reports as an opaque "Failed to fetch". Handled here,
# the response passes back through CORSMiddleware and says what's wrong.
@app.exception_handler(redis.exceptions.ConnectionError)
@app.exception_handler(redis.exceptions.TimeoutError)
async def redis_unavailable_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=503,
        content={"detail": "Login is temporarily unavailable: the server can't reach Redis."
                 + (" Start it with: docker start tiketi-redis" if settings.APP_ENV == "development" else "")},
    )


# ── Routers ────────────────────────────────────────────────────────────────────
PREFIX = settings.API_V1_PREFIX
app.include_router(auth.router,     prefix=PREFIX)
app.include_router(events.router,   prefix=PREFIX)
app.include_router(payments.router, prefix=PREFIX)
app.include_router(tickets.router,  prefix=PREFIX)
app.include_router(gate.router,     prefix=PREFIX)
app.include_router(resale.router,   prefix=PREFIX)
app.include_router(organisations.router, prefix=PREFIX)
app.include_router(organiser_console.router, prefix=PREFIX)
app.include_router(me.router, prefix=PREFIX)
app.include_router(admin.router, prefix=PREFIX)
app.include_router(admin.public_router, prefix=PREFIX)
# Deliberately NOT under PREFIX — /dev/otp-inbox is not part of the
# versioned public API surface at all (Work Order 04 A5).
app.include_router(dev.router)


@app.get("/", tags=["Health"])
def health_check(db: Session = Depends(get_db)):
    return {
        "status": "ok",
        "service": "TiketiKE API",
        "version": "1.0.0",
        "env": settings.APP_ENV,
        # What the login screen should offer: "otp" (codes are delivered) or
        # "demo_numbers" (no SMS — only configured demo numbers have codes).
        "phone_login": "demo_numbers" if settings.OTP_DELIVERY_CHANNEL == "disabled" else "otp",
        "google_phone_confirmation": settings.GOOGLE_PHONE_CONFIRMATION,
        # Allowed by this server (ALLOW_SIMULATED_PAYMENTS) and not switched
        # off by an admin (Feature Flags).
        "simulated_payments": settings.simulated_payments and flag_on(db, "simulated_payments"),
        # Whether checkout offers "Pay by card" (Paystack).
        "card_payments": settings.PAYSTACK_CONFIGURED,
        # Test-mode key: checkout tells testers Paystack's test card number.
        "card_test_mode": settings.PAYSTACK_SECRET_KEY.startswith("sk_test_"),
        # Firebase web config — public by design (it identifies the project,
        # it doesn't authorise anything). The login screen uses Firebase for
        # phone codes and Google sign-in only when this is present.
        "firebase": {
            "apiKey": settings.FIREBASE_API_KEY,
            "authDomain": settings.FIREBASE_AUTH_DOMAIN or f"{settings.FIREBASE_PROJECT_ID}.firebaseapp.com",
            "projectId": settings.FIREBASE_PROJECT_ID,
            "appId": settings.FIREBASE_APP_ID or None,
            "phoneAuth": settings.FIREBASE_PHONE_AUTH,
        } if settings.FIREBASE_CONFIGURED else None,
    }
