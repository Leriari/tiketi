"""
Event cover images: validate an upload and turn it into something cheap to
serve to phones.

The Event Management form sends the picked file as a data: URL. Rather than
storing (and later serving) whatever arrives — often a 3-5 MB phone photo —
this decodes it, checks it really is an image, applies the camera's EXIF
rotation, shrinks it to at most MAX_EDGE pixels and re-encodes it as WebP.
A typical result is 100-300 KB.
"""
import base64
import binascii
import io
import re

from fastapi import HTTPException
from PIL import Image, ImageOps, UnidentifiedImageError

ALLOWED_UPLOAD_TYPES = {"image/png", "image/jpeg", "image/webp"}
MAX_UPLOAD_BYTES = 5 * 1024 * 1024  # matches the form's "up to 5MB"
MAX_EDGE = 1600
MAX_PIXELS = 40_000_000  # refuse decompression bombs well below Pillow's default
OUTPUT_MIME = "image/webp"

_DATA_URL = re.compile(r"^data:(?P<mime>[\w/+.-]+);base64,(?P<data>.+)$", re.DOTALL)


def _bad(detail: str):
    raise HTTPException(status_code=400, detail=detail)


def process_upload(data_url: str) -> tuple[bytes, str]:
    """data: URL from the form -> (WebP bytes, mime type). 400 on anything
    that isn't a PNG/JPEG/WebP image of a sensible size."""
    match = _DATA_URL.match(data_url.strip())
    if not match:
        _bad("The event image must be an uploaded PNG, JPEG or WebP file.")
    if match.group("mime") not in ALLOWED_UPLOAD_TYPES:
        _bad("Event images must be PNG, JPEG or WebP.")
    # base64 is ~4/3 the size of the bytes it encodes — reject before decoding.
    if len(match.group("data")) > MAX_UPLOAD_BYTES * 4 // 3 + 4:
        _bad("That image is too large — the limit is 5 MB.")
    try:
        raw = base64.b64decode(match.group("data"), validate=True)
    except (binascii.Error, ValueError):
        _bad("That image file is corrupted and couldn't be read.")
    if len(raw) > MAX_UPLOAD_BYTES:
        _bad("That image is too large — the limit is 5 MB.")

    try:
        with Image.open(io.BytesIO(raw)) as probe:
            if probe.width * probe.height > MAX_PIXELS:
                _bad("That image has too many pixels — use one under 40 megapixels.")
            probe.verify()  # structural check; the image must be reopened after this
        image = Image.open(io.BytesIO(raw))
        image.load()
    except HTTPException:
        raise
    except (UnidentifiedImageError, OSError, SyntaxError, Image.DecompressionBombError):
        _bad("That file isn't a valid image.")

    image = ImageOps.exif_transpose(image)  # phone photos carry their rotation in EXIF
    image.thumbnail((MAX_EDGE, MAX_EDGE), Image.Resampling.LANCZOS)
    if image.mode not in ("RGB", "RGBA"):
        image = image.convert("RGBA" if "A" in image.getbands() or image.mode == "P" else "RGB")

    out = io.BytesIO()
    image.save(out, format="WEBP", quality=82, method=4)
    return out.getvalue(), OUTPUT_MIME
