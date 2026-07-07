"""Server config: source URL list and success rate from the environment."""
from __future__ import annotations

import importlib
import os


def _reload_config(monkeypatch, **env: str | None) -> object:
    monkeypatch.setattr("dotenv.load_dotenv", lambda *args, **kwargs: None)
    for key in list(os.environ):
        if key.startswith("ADBO_SOURCE_URL") or key in ("ADBO_SOURCE_URL", "SUCCESS_RATE"):
            monkeypatch.delenv(key, raising=False)
    for key, value in env.items():
        if value is None:
            monkeypatch.delenv(key, raising=False)
        else:
            monkeypatch.setenv(key, value)
    import server.config as config

    return importlib.reload(config)


def test_source_urls_numbered(monkeypatch):
    cfg = _reload_config(
        monkeypatch,
        ADBO_SOURCE_URL_1="https://example.com/one",
        ADBO_SOURCE_URL_2="https://example.com/two",
    )
    assert cfg.SOURCE_URLS == [
        "https://example.com/one",
        "https://example.com/two",
    ]
    assert cfg.SOURCE_URL == "https://example.com/one"


def test_success_rate_clamped(monkeypatch):
    cfg = _reload_config(monkeypatch, SUCCESS_RATE="150")
    assert cfg.SUCCESS_RATE == 100.0

    cfg = _reload_config(monkeypatch, SUCCESS_RATE="-5")
    assert cfg.SUCCESS_RATE == 0.0

    cfg = _reload_config(monkeypatch, SUCCESS_RATE="60")
    assert cfg.SUCCESS_RATE == 60.0


def test_legacy_single_source_url(monkeypatch):
    cfg = _reload_config(monkeypatch, ADBO_SOURCE_URL="https://legacy.example/")
    assert cfg.SOURCE_URLS == ["https://legacy.example/"]
