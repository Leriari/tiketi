"""
Every DateTime column here is stored naive and means UTC (see
organiser_service._naive_utc). Serialised as-is, "2026-11-07T07:00:00"
carries no zone, and browsers read a zone-less ISO string as *local* time —
so a Nairobi viewer saw every time three hours early. This response class
adds the missing "Z" to naive ISO datetimes on the way out, in one place,
whether a route returns a Pydantic model or a hand-built dict.
"""
import re
from typing import Any

from fastapi.responses import JSONResponse

_NAIVE_ISO_DATETIME = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$")


def mark_utc(value: Any) -> Any:
    if isinstance(value, str):
        return value + "Z" if _NAIVE_ISO_DATETIME.match(value) else value
    if isinstance(value, list):
        return [mark_utc(v) for v in value]
    if isinstance(value, dict):
        return {k: mark_utc(v) for k, v in value.items()}
    return value


class UTCJSONResponse(JSONResponse):
    def render(self, content: Any) -> bytes:
        return super().render(mark_utc(content))
