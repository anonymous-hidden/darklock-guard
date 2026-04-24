#!/usr/bin/env python3
"""NOVA entrypoint. Run: python main.py   (or: python main.py "your request")."""
from __future__ import annotations

import sys

from nova.cli.terminal import main


if __name__ == "__main__":
    sys.exit(main())
