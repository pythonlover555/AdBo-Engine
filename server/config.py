"""Server configuration for the Adbo-Engine extension backend.

Values come from the environment (.env loaded once at import) with defaults.
"""
from __future__ import annotations

import os

from dotenv import load_dotenv

load_dotenv()

# Port the nav-extension talks to (it targets http://localhost:8137).
# Set ADBO_PORT in .env to change it (keep nav-extension/background.js SERVER in sync).
PORT = int(os.getenv("ADBO_PORT") or "8137")

_DEFAULT_SOURCE_URL = (
    "https://glstrk.com/?offer_ids=MTQyMSwyMzcw&affiliate_id=MTkwNDU3"
)


def _load_source_urls() -> list[str]:
    """Collect ADBO_SOURCE_URL_1, ADBO_SOURCE_URL_2, … from the environment."""
    urls: list[str] = []
    i = 1
    while True:
        raw = os.getenv(f"ADBO_SOURCE_URL_{i}")
        if not raw:
            break
        url = raw.strip()
        if url:
            urls.append(url)
        i += 1
    if urls:
        return urls
    legacy = (os.getenv("ADBO_SOURCE_URL") or "").strip()
    if legacy:
        return [legacy]
    return [_DEFAULT_SOURCE_URL]


# URLs the extension cycles through (one per funnel run). Fetched from /api/config.
SOURCE_URLS = _load_source_urls()
# First URL — kept for backward compatibility with older extension builds.
SOURCE_URL = SOURCE_URLS[0]

# Percentage of funnel runs that reach the reward page (0–100). The rest drop
# off mid-funnel to simulate users losing interest before the end.
_raw_success = os.getenv("SUCCESS_RATE")
try:
    SUCCESS_RATE = float(_raw_success) if _raw_success is not None else 100.0
except ValueError:
    SUCCESS_RATE = 100.0
SUCCESS_RATE = max(0.0, min(100.0, SUCCESS_RATE))
