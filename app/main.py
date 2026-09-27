from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from app.core.config import get_settings
from app.api.routes import auth, events, payments, tickets, gate, resale

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
    docs_url="/docs",
    redoc_url="/redoc",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if settings.DEBUG else ["https://tiketi.ke"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ────────────────────────────────────────────────────────────────────
PREFIX = settings.API_V1_PREFIX
app.include_router(auth.router,     prefix=PREFIX)
app.include_router(events.router,   prefix=PREFIX)
app.include_router(payments.router, prefix=PREFIX)
app.include_router(tickets.router,  prefix=PREFIX)
app.include_router(gate.router,     prefix=PREFIX)
app.include_router(resale.router,   prefix=PREFIX)


@app.get("/", tags=["Health"])
def health_check():
    return {
        "status": "ok",
        "service": "TiketiKE API",
        "version": "1.0.0",
        "env": settings.APP_ENV,
    }
