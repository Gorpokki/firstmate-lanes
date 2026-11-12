#!/usr/bin/env python3
"""Scan the working tree or Git trees, outgoing commits, and GitHub title/body text."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import sys

def scan_tree(tree, denylist, seen):
    entries = subprocess.run(
        ["git", "ls-tree", "-rz", "--full-tree", tree],
        check=True,
        capture_output=True,
    ).stdout
    failed = 0
    for entry in entries.split(b"\0"):
        if not entry or entry in seen:
            continue
        seen.add(entry)
        metadata, raw_name = entry.split(b"\t", 1)
        _, kind, oid = metadata.decode().split()
        name = os.fsdecode(raw_name)
        failed |= report(name, denylist)
        if kind == "blob":
            data = subprocess.run(
                ["git", "cat-file", "blob", oid], check=True, capture_output=True
            ).stdout.decode(errors="replace")
            failed |= report(data, denylist)
    return failed


def scan_worktree(denylist):
    names = git("ls-files", "--cached", "--others", "--exclude-standard", "-z").split("\0")
    failed = 0
    for name in filter(None, names):
        path = Path(name)
        failed |= report(name, denylist)
        if path.is_file():
            failed |= report(path.read_text(errors="replace"), denylist)
    return failed


HOME_MARKERS = ("/" + "Us" + "ers/", "/" + "ho" + "me/")
PRIVATE_SUFFIXES = ("internal", "local", "lan", "corp", "private", "localhost", "intranet", "home.arpa")
PATTERNS = tuple(re.compile(re.escape(root) + r"[^/\s]+(?:/|\b)", re.I) for root in HOME_MARKERS) + (
    re.compile(r"\b(?:[a-z0-9-]+\.)+(?:" + "|".join(map(re.escape, PRIVATE_SUFFIXES)) + r")\b", re.I),
    re.compile(r"\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b"),
    re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.I),
)


def denylist_entries(value):
    if not value or not value.strip():
        return None
    values = [line.strip() for line in value.splitlines() if line.strip()]
    return values or None


def matches(text, denylist):
    folded = text.casefold()
    return any(pattern.search(text) for pattern in PATTERNS) or any(item.casefold() in folded for item in denylist)


def report(text, denylist):
    if matches(text, denylist):
        print("leak detected (content redacted)", file=sys.stderr)
        return 1
    return 0


def git(*args, cwd=None):
    return subprocess.run(["git", *args], check=True, capture_output=True, text=True, cwd=cwd).stdout


def self_test():
    with tempfile.TemporaryDirectory() as directory:
        subprocess.run(["git", "init", "-q"], cwd=directory, check=True)
        sample = Path(directory) / "sample.txt"
        scanner = str(Path(__file__).resolve())
        marker = Path(directory) / "executed.marker"

        def commit(message="Synthetic commit"):
            subprocess.run(["git", "add", "-A"], cwd=directory, check=True)
            subprocess.run(
                [
                    "git", "-c", "user.name=Synthetic", "-c",
                    "user.email=synthetic@" + "example.invalid", "commit",
                    "--allow-empty", "-q", "-m", message,
                ],
                cwd=directory,
                check=True,
                capture_output=True,
            )

        def run(denylist="Synthetic-Private-Token", event=None, base=None):
            env = os.environ.copy()
            env.pop("LEAK_DENYLIST", None)
            if denylist is not None:
                env["LEAK_DENYLIST"] = denylist
            args = [sys.executable, scanner, "--tree", "HEAD"]
            if base is not None:
                args.extend(["--base", base])
            if event is not None:
                event_path = Path(directory) / "event.json"
                event_path.write_text(json.dumps(event))
                args.extend(["--event-file", str(event_path)])
            return subprocess.run(
                args, cwd=directory, env=env, capture_output=True, text=True
            )

        for missing in (None, "", " \n"):
            result = run(missing)
            assert result.returncode == 2
            assert "leak denylist required" in result.stderr
        sample.write_text("safe synthetic content")
        commit()
        base = git("rev-parse", "HEAD", cwd=directory).strip()
        result = run()
        assert result.returncode == 0 and not result.stdout and not result.stderr
        for name, content in (
            ("intermediate.txt", "synthetic-private-token"),
            ("service.cluster." + PRIVATE_SUFFIXES[0], "safe"),
        ):
            start = git("rev-parse", "HEAD", cwd=directory).strip()
            Path(directory, name).write_text(content)
            commit()
            Path(directory, name).unlink()
            commit()
            result = run(base=start)
            assert result.returncode == 1
            assert "leak detected (content redacted)" in result.stderr
            assert name not in result.stdout + result.stderr
            assert content not in result.stdout + result.stderr
        commit("synthetic-private-token")
        result = run(base=base)
        assert result.returncode == 1
        assert "leak detected (content redacted)" in result.stderr
        assert "synthetic-private-token" not in result.stdout + result.stderr
        sample.write_text("safe synthetic content")
        private_name = Path(directory) / ("service.cluster." + PRIVATE_SUFFIXES[0])
        private_name.write_text("safe")
        commit()
        result = run()
        assert result.returncode == 1
        private_name.unlink()
        commit()
        for content in (
            "path " + HOME_MARKERS[0] + "sample/file",
            "path " + HOME_MARKERS[1] + "sample/file",
            "service.cluster." + PRIVATE_SUFFIXES[0],
            "192" + ".168.4.5",
            "person@" + "example.invalid",
            "synthetic-private-token",
        ):
            sample.write_text(content)
            commit()
            result = run()
            assert result.returncode == 1
            assert "leak detected (content redacted)" in result.stderr
            assert content not in result.stdout + result.stderr
        assert all(
            any(
                pattern.search("service.cluster." + suffix)
                for pattern in PATTERNS
            )
            for suffix in PRIVATE_SUFFIXES
        )
        sample.write_text("safe synthetic content")
        malicious = Path(directory) / ".github/workflows/quality.yml"
        malicious.parent.mkdir(parents=True)
        malicious.write_text("run: $(touch executed.marker)")
        script = Path(directory) / "scripts/leak-check.py"
        script.parent.mkdir(parents=True)
        script.write_text("open('executed.marker', 'w').write('bad')")
        commit()
        result = run(event={"pull_request": {"title": "$(touch executed.marker)", "body": "safe"}})
        assert result.returncode == 0 and not result.stdout and not result.stderr
        assert not marker.exists()
        result = run(event={"pull_request": {"title": "person@" + "example.invalid", "body": ""}})
        assert result.returncode == 1
        assert "example.invalid" not in result.stdout + result.stderr
        assert not marker.exists()
        result = run(event={"issue": {"title": "safe", "body": "service.cluster." + PRIVATE_SUFFIXES[0]}})
        assert result.returncode == 1
        assert "cluster" not in result.stdout + result.stderr
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--base", help="published base commit; scans every outgoing commit's paths, contents and messages")
    parser.add_argument("--head", default="HEAD", help="outgoing commit head")
    parser.add_argument("--tree", help="Git tree to scan without checking it out")
    parser.add_argument("--event-file", help="GitHub event JSON with issue or PR text")
    args = parser.parse_args()
    denylist_value = os.environ.pop("LEAK_DENYLIST", None)
    if args.self_test:
        self_test()
        return 0
    denylist = denylist_entries(denylist_value)
    if denylist is None:
        print("leak denylist required", file=sys.stderr)
        return 2
    seen = set()
    failed = scan_tree(args.tree, denylist, seen) if args.tree else scan_worktree(denylist)
    if args.base:
        for commit in git("rev-list", f"{args.base}..{args.head}").split():
            failed |= scan_tree(commit, denylist, seen)
        failed |= report(git("log", "--format=%B", f"{args.base}..{args.head}"), denylist)
    if args.event_file:
        event = json.loads(Path(args.event_file).read_text())
        for payload in (event.get("issue", {}), event.get("pull_request", {})):
            for field in ("title", "body"):
                if payload.get(field):
                    failed |= report(payload[field], denylist)
    return failed


if __name__ == "__main__":
    raise SystemExit(main())
