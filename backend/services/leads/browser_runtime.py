"""Make sure the headless browser the lead pipeline needs is actually on disk.

Both halves of lead generation drive a real browser: Scrapling's
DynamicFetcher for Google Maps, Crawlee's PlaywrightCrawler for each
company's own website. Both launch through Playwright.

Playwright pins its Chromium to a build number and bumps that number on
every upgrade. When the package upgraded here, the new build was never
downloaded, so every launch failed with

    Executable doesn't exist at ...\\ms-playwright\\chromium-1243\\...

The backend degraded quietly: Maps fell back to a static parser that
carries no phone number, website enrichment was skipped entirely, and the
app reported "No contactable leads found" — which reads like the lead
engine is broken rather than a missing 150 MB download.

This module answers the only question that matters — is the browser there,
right now — and, once per process, tries to put it there if it is not.
"""
from __future__ import annotations

import logging
import os
import subprocess
import sys
import threading

logger = logging.getLogger(__name__)

_lock = threading.Lock()
_attempted = False          # one install attempt per process, no retry storms
_state: bool | None = None  # cached answer once we know it


def browser_path() -> str | None:
    """The Chromium binary Playwright will actually launch, or None."""
    try:
        from playwright.sync_api import sync_playwright
    except Exception:
        return None
    try:
        with sync_playwright() as p:
            return p.chromium.executable_path
    except Exception:
        return None


def browser_ready() -> bool:
    path = browser_path()
    return bool(path and os.path.exists(path))


def _clean_env() -> dict:
    """The launcher can leave VIRTUAL_ENV pointing at a stale venv; a child
    pip/playwright that inherits it installs into the wrong place, or fails."""
    env = {k: v for k, v in os.environ.items()
           if not (k == "VIRTUAL_ENV" or k.startswith(("UV_", "PIP_", "CONDA_")))}
    env["PIP_DISABLE_PIP_VERSION_CHECK"] = "1"
    return env


def ensure_browser(timeout: int = 900) -> bool:
    """True when the browser is usable. Installs it once if it is missing.

    Safe to call on every request: after the first answer it is a cached
    boolean, and a failed install is never retried in this process.
    """
    global _attempted, _state
    if _state is True:
        return True
    with _lock:
        if _state is True:
            return True
        if browser_ready():
            _state = True
            return True
        if _attempted:
            return False
        _attempted = True
        if os.getenv("CLAVIS_AUTO_INSTALL_BROWSER", "true").lower() == "false":
            logger.warning("Lead browser missing and auto-install is off "
                           "(CLAVIS_AUTO_INSTALL_BROWSER=false)")
            _state = False
            return False

        logger.warning("Lead-scraper browser is missing — downloading Chromium once. "
                       "This takes a couple of minutes on a first run.")
        try:
            done = subprocess.run(
                [sys.executable, "-m", "playwright", "install", "chromium"],
                env=_clean_env(), timeout=timeout,
                stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
            )
            if done.returncode != 0:
                logger.warning("playwright install chromium exited %s: %s",
                               done.returncode,
                               (done.stdout or b"").decode("utf-8", "replace")[-400:])
        except Exception as exc:
            logger.warning("Could not install the lead browser automatically: %r", exc)

        _state = browser_ready()
        if _state:
            logger.info("Lead-scraper browser installed and ready")
        else:
            logger.warning(
                "Lead browser still unavailable. Run once in the backend folder: "
                "python -m playwright install chromium")
        return bool(_state)


def status() -> dict:
    """For /health and the app's own diagnostics."""
    path = browser_path()
    return {
        "browser_path": path,
        "browser_ready": bool(path and os.path.exists(path)),
        "install_attempted": _attempted,
    }
