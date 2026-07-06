"""Sequential US-address source for filling registration forms.

Addresses come from an external Excel file (a list of ~7k real US addresses),
read ONE ROW AT A TIME with a persistent cursor: each call returns the next row,
advancing by one; at the end of the file it wraps back to the first row. The
cursor index is persisted to disk so it survives server restarts (we resume from
where we left off, never re-using a row out of order).

Columns in the file (sheet "Addresses"):
  Street | City | State/Province/Area | Phone Number | Zip Code | Country Calling Code | Country

The form needs the 2-letter state code (the file has full names) and a 10-digit
phone (the file has dashed), so those are normalized here.
"""
from __future__ import annotations

import random
import re
import threading
from pathlib import Path

# External address workbook path, from .env (ADBO_ADDRESS_XLSX), with a fallback.
# We load .env here ourselves because this module is imported before server.config
# (which is what normally calls load_dotenv), so the var wouldn't be set yet.
import os

from dotenv import load_dotenv

load_dotenv()

ADDRESS_XLSX = Path(
    os.getenv("ADBO_ADDRESS_XLSX") or r"D:\Work\Projects\AdrUs-Engine\data\us_address.xlsx"
)

# Persist the next-row cursor here so it survives restarts (this project's data/).
_DATA_DIR = Path(__file__).resolve().parents[1] / "data"
_CURSOR_FILE = _DATA_DIR / "address_cursor.txt"

# Full US state/territory name -> USPS 2-letter code (form <select> values).
_STATE_ABBR = {
    "alabama": "AL", "alaska": "AK", "arizona": "AZ", "arkansas": "AR",
    "california": "CA", "colorado": "CO", "connecticut": "CT", "delaware": "DE",
    "district of columbia": "DC", "florida": "FL", "georgia": "GA", "hawaii": "HI",
    "idaho": "ID", "illinois": "IL", "indiana": "IN", "iowa": "IA", "kansas": "KS",
    "kentucky": "KY", "louisiana": "LA", "maine": "ME", "maryland": "MD",
    "massachusetts": "MA", "michigan": "MI", "minnesota": "MN", "mississippi": "MS",
    "missouri": "MO", "montana": "MT", "nebraska": "NE", "nevada": "NV",
    "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
    "north carolina": "NC", "north dakota": "ND", "ohio": "OH", "oklahoma": "OK",
    "oregon": "OR", "pennsylvania": "PA", "rhode island": "RI",
    "south carolina": "SC", "south dakota": "SD", "tennessee": "TN", "texas": "TX",
    "utah": "UT", "vermont": "VT", "virginia": "VA", "washington": "WA",
    "west virginia": "WV", "wisconsin": "WI", "wyoming": "WY",
    "puerto rico": "PR", "guam": "GU", "virgin islands": "VI",
    "american samoa": "AS", "northern mariana islands": "MP",
}

_rows: list[dict[str, str]] | None = None
_idx: int = 0
_lock = threading.Lock()


def _digits(s: object) -> str:
    d = re.sub(r"\D", "", str(s or ""))
    return d[-10:] if len(d) > 10 else d  # drop any leading country code


def _zip5(s: object) -> str:
    d = re.sub(r"\D", "", str(s or ""))
    return d.zfill(5)[:5]


def _state_code(s: object) -> str:
    return _STATE_ABBR.get(str(s or "").strip().lower(), "")


def randomize_last4(phone: str) -> str:
    """Keep the file number's area code + exchange (first 6 digits) but replace
    the last 4 (the subscriber number) with random digits. Used only on the COPY
    we hand out for a form fill — the cached/original file value is never changed.
    """
    if len(phone) >= 5:  # need at least 1 kept digit + 4 to replace
        return phone[:-4] + "".join(str(random.randint(0, 9)) for _ in range(4))
    return phone


def _load_rows() -> list[dict[str, str]]:
    import openpyxl  # local import so a missing file/dep never breaks startup

    wb = openpyxl.load_workbook(ADDRESS_XLSX, read_only=True, data_only=True)
    try:
        ws = wb.active
        out = []
        it = ws.iter_rows(values_only=True)
        next(it, None)  # skip header
        for r in it:
            if not r or not r[0]:
                continue
            street, city, state, phone, zipc = (list(r) + [None] * 5)[:5]
            out.append({
                "address1": str(street).strip(),
                "city": str(city or "").strip(),
                "state": _state_code(state),
                "zip": _zip5(zipc),
                "phone": _digits(phone),
            })
        return out
    finally:
        wb.close()


def _read_cursor() -> int:
    try:
        return int(_CURSOR_FILE.read_text(encoding="utf-8").strip())
    except (OSError, ValueError):
        return 0


def _write_cursor(i: int) -> None:
    try:
        _DATA_DIR.mkdir(exist_ok=True)
        _CURSOR_FILE.write_text(str(i), encoding="utf-8")
    except OSError:
        pass  # persistence is best-effort; in-memory cursor still advances


def next_address() -> dict[str, str] | None:
    """The next address row (advancing + persisting the cursor, wrapping at the
    end). Returns None if the address file is unavailable."""
    global _rows, _idx
    with _lock:
        if not _rows:  # None (never loaded) or [] (last attempt failed) -> retry
            try:
                _rows = _load_rows()
                _idx = _read_cursor()
            except Exception:  # noqa: BLE001 — missing file/dep/corrupt/locked sheet
                _rows = []
                return None  # transient/missing; don't poison — retry next call
        if not _rows:
            return None
        i = _idx % len(_rows)
        addr = dict(_rows[i])  # a COPY — the cached original is left untouched
        addr["phone"] = randomize_last4(addr["phone"])  # randomize last 4 per fill
        _idx = (i + 1) % len(_rows)
        _write_cursor(_idx)
        addr["_row"] = i + 2  # 1-based row in the sheet (after header) for logging
        return addr
