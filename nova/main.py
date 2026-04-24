"""NOVA entrypoint."""
from __future__ import annotations
import sys
from nova.cli.terminal import main

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
