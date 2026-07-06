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

# The URL the extension loads to start the redirect loop. The extension fetches
# this from /api/config at Start; set ADBO_SOURCE_URL in .env to change it
# without touching the extension. (background.js keeps a hardcoded fallback.)
SOURCE_URL = (
    os.getenv("ADBO_SOURCE_URL")
    or "https://glstrk.com/?offer_ids=MTQyMSwyMzcw&affiliate_id=MTkwNDU3"
)
