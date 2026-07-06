"""Sequential US-address reader: row-by-row cursor with wrap-around.

Uses a tiny temp workbook (not the external file) so the test is deterministic
and side-effect free.
"""
from __future__ import annotations

import openpyxl

from server import address_book as ab


def _make_workbook(path):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Addresses"
    ws.append(["Street", "City", "State/Province/Area", "Phone Number", "Zip Code",
               "Country Calling Code", "Country"])
    ws.append(["1 A St", "Akron", "Ohio", "330-238-9322", "44308", "+1", "United States"])
    ws.append(["2 B St", "Waltham", "Massachusetts", "781-775-7363", "02154", "+1", "United States"])
    wb.save(path)


def test_sequential_with_wrap_and_normalization(tmp_path, monkeypatch):
    wb_path = tmp_path / "addr.xlsx"
    _make_workbook(wb_path)
    monkeypatch.setattr(ab, "ADDRESS_XLSX", wb_path)
    monkeypatch.setattr(ab, "_CURSOR_FILE", tmp_path / "cursor.txt")
    monkeypatch.setattr(ab, "_rows", None)
    monkeypatch.setattr(ab, "_idx", 0)

    out = [ab.next_address() for _ in range(5)]  # 2 rows -> must wrap

    # Sequential, then wraps back to the start.
    assert [r["address1"] for r in out] == ["1 A St", "2 B St", "1 A St", "2 B St", "1 A St"]
    # Full state name -> 2-letter code; zip kept (leading zero).
    assert out[0]["state"] == "OH" and out[1]["state"] == "MA"
    assert out[0]["zip"] == "44308" and out[1]["zip"] == "02154"
    # Phone: file's area code + exchange kept (first 6), last 4 randomized -> 10 digits.
    assert out[0]["phone"][:6] == "330238" and len(out[0]["phone"]) == 10
    assert out[0]["phone"].isdigit()
    # The cached/original file value is NEVER changed by the randomization.
    assert ab._rows[0]["phone"] == "3302389322"
    # Cursor persisted to disk.
    assert (tmp_path / "cursor.txt").read_text().strip().isdigit()


def test_randomize_last4_keeps_prefix_and_varies():
    src = "3302389322"
    outs = {ab.randomize_last4(src) for _ in range(50)}
    for p in outs:
        assert len(p) == 10 and p.isdigit() and p[:6] == "330238"
    assert len(outs) > 1  # last 4 actually varies (astronomically unlikely to be 1)
    assert src == "3302389322"  # input untouched


def test_missing_file_returns_none(tmp_path, monkeypatch):
    monkeypatch.setattr(ab, "ADDRESS_XLSX", tmp_path / "does_not_exist.xlsx")
    monkeypatch.setattr(ab, "_rows", None)
    monkeypatch.setattr(ab, "_idx", 0)
    assert ab.next_address() is None  # callers fall back to a generated address
