#!/usr/bin/env python3
"""Reject placeholders and generic assistant filler in Markdown documents."""
import re
import subprocess
import sys
from pathlib import Path

MARKER = re.compile(
    r"\b(?:TODO|FIXME|TBD|PLACEHOLDER|LOREM IPSUM)\b"
    r"|as an AI language model|I hope this helps|let me know if you need anything else",
    re.I,
)


def main():
    names = subprocess.run(
        ["git", "ls-files", "--cached", "--others", "--exclude-standard", "-z"],
        check=True,
        capture_output=True,
    ).stdout.split(b"\0")
    failed = False
    for raw_name in filter(None, names):
        name = raw_name.decode(errors="replace")
        path = Path(name)
        if path.suffix.lower() != ".md" or not path.is_file():
            continue
        for line_number, line in enumerate(path.read_text(errors="replace").splitlines(), 1):
            if MARKER.search(line):
                print(f"documentation filler marker: {name}:{line_number}", file=sys.stderr)
                failed = True
    return int(failed)


if __name__ == "__main__":
    raise SystemExit(main())
