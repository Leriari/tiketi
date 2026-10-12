"""
Minimal Redis-backed rate limiting (Work Order 04 A3). Hand-rolled rather
than pulling in slowapi: it's a fixed-window counter in four lines
(INCR + EXPIRE-on-first-hit), and every route that needs it already has a
Redis client available via app.core.redis_client.

Endpoints are limited by BOTH phone number and client IP, not either
alone — per-phone-only lets an attacker cycle numbers from one machine;
per-IP-only lets a distributed attacker hammer one number.
"""
from fastapi import HTTPException, Request, status

from app.core.redis_client import get_redis_client

_PREFIX = "ratelimit:"


def enforce_rate_limit(key: str, limit: int, window_seconds: int) -> None:
    """
    Fixed-window counter: the window starts on the first hit for `key` and
    resets `window_seconds` after that first hit, not on a wall-clock
    boundary. Raises 429 once `limit` is exceeded within the window.
    """
    redis_client = get_redis_client()
    full_key = f"{_PREFIX}{key}"
    count = redis_client.incr(full_key)
    if count == 1:
        redis_client.expire(full_key, window_seconds)
    if count > limit:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many requests. Please try again later.",
        )


def client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"
