"""Compatibility package to expose src/gurt without editable install."""

from __future__ import annotations

from pathlib import Path
from pkgutil import extend_path

__path__ = extend_path(__path__, __name__)  # type: ignore[assignment]

_SRC_PACKAGE = Path(__file__).resolve().parent.parent / "src" / "gurt"
if _SRC_PACKAGE.exists():
    __path__.append(str(_SRC_PACKAGE))
