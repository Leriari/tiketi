"""
Single shared Redis connection, used by the OTP store, rate limiting, and
the development notification inbox (Work Order 04). Celery opens its own
separate connection (see app/worker.py) — this one is for request-path
reads/writes that need to happen synchronously inside a route.
"""
from functools import lru_cache
import redis
from app.core.config import get_settings


@lru_cache
def get_redis_client() -> redis.Redis:
    return redis.Redis.from_url(get_settings().REDIS_URL, decode_responses=True)
