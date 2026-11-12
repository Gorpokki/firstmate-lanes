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

SCANNER_PATH = "scripts/leak-check.py"
SAFE_FIXTURE = 'for safe_text in ("https://github.com/users/synthetic/projects/1", "https://github.com/home/synthetic", "time.Local"):'
FIXTURE_ASSIGNMENT = 'fixture_denylist = "' + SAFE_FIXTURE.split('"')[1] + '"'


def scanned_text(name, text):
    if name != SCANNER_PATH:
        return text
    text = text.replace(SAFE_FIXTURE, "")
    return "\n".join(line for line in text.split("\n") if line.strip() != FIXTURE_ASSIGNMENT)


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
            failed |= report(scanned_text(name, data), denylist)
    return failed


def scan_worktree(denylist):
    names = git("ls-files", "--cached", "--others", "--exclude-standard", "-z").split("\0")
    failed = 0
    for name in filter(None, names):
        path = Path(name)
        failed |= report(name, denylist)
        if path.is_file():
            failed |= report(scanned_text(name, path.read_text(errors="replace")), denylist)
    return failed


HOME_MARKERS = ("/" + "Us" + "ers/", "/" + "ho" + "me/")
PRIVATE_SUFFIXES = ("internal", "local", "lan", "corp", "private", "localhost", "intranet", "home.arpa")
PRIVATE_SUFFIX_FORMS = "|".join(re.escape(form) for suffix in PRIVATE_SUFFIXES for form in (suffix, suffix.upper()))
PATTERNS = (
    re.compile(re.escape(HOME_MARKERS[0]) + r"[^/\s]+(?:/|\b)"),
    re.compile(r"\b[A-Za-z]:\\+Users\\+[^\\\s]+", re.I),
    re.compile(r"(?:(?<![\w./-])|(?<=file://))(?:/[\w.-]+)*" + re.escape(HOME_MARKERS[1]) + r"[^/\s]+(?:/|\b)"),
    re.compile(r"\b(?:[A-Za-z0-9-]+\.)+(?:" + PRIVATE_SUFFIX_FORMS + r")\b"),
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


NOREPLY_EMAIL = re.compile(r"\d+\+[A-Za-z0-9-]+@users\.noreply\.github\.com")


def identity_leaks(value, owner, denylist):
    if value == owner or NOREPLY_EMAIL.fullmatch(value):
        return 0
    return report(value, denylist)


def git(*args, cwd=None):
    return subprocess.run(["git", *args], check=True, capture_output=True, text=True, cwd=cwd).stdout


def self_test():
    def identity_checks():
        owner_login = "Synthetic-Owner"
        identity_denylist = "Synthetic-Private-Token\n" + owner_login
        for identity, committer, owner_arg, expected in (
            ((owner_login, noreply), None, None, 1),
            ((owner_login, noreply), None, owner_login, 0),
            ((owner_login + "-2", noreply), None, owner_login, 1),
            (("Synthetic", noreply), None, None, 0),
            (("Synthetic", "1+synthetic@" + "fake-users.noreply.github.com"), None, None, 1),
            (("Synthetic", noreply), ("Synthetic", "person@" + "example.invalid"), None, 1),
            (("Synthetic-Private-Token", noreply), None, None, 1),
        ):
            start = git("rev-parse", "HEAD", cwd=directory).strip()
            commit(identity=identity, committer=committer)
            result = run(denylist=identity_denylist, base=start, owner=owner_arg)
            assert result.returncode == expected
            assert not any(value in result.stdout + result.stderr for value in (*identity, *(committer or identity)))
            if expected:
                assert "leak detected (content redacted)" in result.stderr
            else:
                assert not result.stdout and not result.stderr

    def tree_and_history_checks():
        sample.write_text(noreply)
        commit()
        result = run()
        assert result.returncode == 1
        assert "leak detected (content redacted)" in result.stderr
        assert noreply not in result.stdout + result.stderr
        sample.write_text("safe synthetic content")
        commit()
        for name, content in (
            ("intermediate.txt", "synthetic-private-token"),
            (cluster_host, "safe"),
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
        base = git("rev-parse", "HEAD", cwd=directory).strip()
        commit("synthetic-private-token")
        result = run(base=base)
        assert result.returncode == 1
        assert "leak detected (content redacted)" in result.stderr
        assert "synthetic-private-token" not in result.stdout + result.stderr
        sample.write_text("safe synthetic content")
        private_name = Path(directory) / cluster_host
        private_name.write_text("safe")
        commit()
        result = run()
        assert result.returncode == 1
        private_name.unlink()
        commit()
        for content in (
            "path " + HOME_MARKERS[0] + "sample/file",
            "path " + HOME_MARKERS[1] + "sample/file",
            "path /mnt/c" + HOME_MARKERS[0] + "sample/file",
            "path /System/Volumes/Data" + HOME_MARKERS[0] + "sample/file",
            "path /var" + HOME_MARKERS[1] + "sample/file",
            "path /mnt" + HOME_MARKERS[1] + "sample/file",
            "path /export" + HOME_MARKERS[1] + "sample/file",
            "file://" + HOME_MARKERS[1] + "sample/file",
            "PATH=x:" + HOME_MARKERS[1] + "sample/bin",
            "path C:" + "\\" + "Users" + "\\" + "sample\\file",
            "path c:" + "\\" + "users" + "\\" + "sample\\file",
            cluster_host,
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
        for host in host_forms:
            sample.write_text(host)
            commit()
            result = run()
            assert result.returncode == 1
            assert "leak detected (content redacted)" in result.stderr
            assert host not in result.stdout + result.stderr
        for safe_text in SAFE_FIXTURE.split('"')[1::2]:
            sample.write_text(safe_text)
            commit()
            result = run()
            assert result.returncode == 0 and not result.stdout and not result.stderr
        sample.write_text("safe synthetic content")
        commit()

    def fixture_checks():
        fixture_denylist = SAFE_FIXTURE.split('"')[1]
        Path(directory, "scripts").mkdir()
        for content, name, expected in (
            (SAFE_FIXTURE, "scripts/leak-check.py", 0),
            (SAFE_FIXTURE + "\n" + fixture_denylist, "scripts/leak-check.py", 1),
            (SAFE_FIXTURE.replace("for safe_text", "for safe_texts"), "scripts/leak-check.py", 1),
            (SAFE_FIXTURE, "notes.txt", 1),
            (FIXTURE_ASSIGNMENT, "scripts/leak-check.py", 0),
            (FIXTURE_ASSIGNMENT.replace("fixture_denylist", "fixture_denylists"), "scripts/leak-check.py", 1),
            (FIXTURE_ASSIGNMENT + " + ''", "scripts/leak-check.py", 1),
            (FIXTURE_ASSIGNMENT + "\n" + fixture_denylist, "scripts/leak-check.py", 1),
            (FIXTURE_ASSIGNMENT, "notes.txt", 1),
        ):
            Path(directory, name).write_text(content)
            commit()
            result = run(denylist=fixture_denylist)
            assert result.returncode == expected
            assert fixture_denylist not in result.stdout + result.stderr
            if expected:
                assert "leak detected (content redacted)" in result.stderr
            else:
                assert not result.stdout and not result.stderr
            Path(directory, name).unlink()
            commit()

    def event_text_checks():
        sample.write_text("safe synthetic content")
        commit()
        result = run(event={"pull_request": {"title": "$(touch executed.marker)", "body": "safe"}})
        assert result.returncode == 0 and not result.stdout and not result.stderr
        assert not Path(directory, "executed.marker").exists()
        result = run(event={"pull_request": {"title": "person@" + "example.invalid", "body": ""}})
        assert result.returncode == 1
        assert "example.invalid" not in result.stdout + result.stderr
        result = run(event={"issue": {"title": "safe", "body": cluster_host}})
        assert result.returncode == 1
        assert "cluster" not in result.stdout + result.stderr
        result = run(event={"title": "safe", "body": "person@" + "example.invalid"})
        assert result.returncode == 2
        assert "example.invalid" not in result.stdout + result.stderr
    with tempfile.TemporaryDirectory() as directory:
        subprocess.run(["git", "init", "-q"], cwd=directory, check=True)
        sample = Path(directory) / "sample.txt"
        scanner = str(Path(__file__).resolve())
        cluster_host = ".".join(("service", "cluster", "internal"))
        host_forms = tuple(".".join(parts) for parts in (("printer", "local"), ("nas", "home", "arpa"), ("app", "localhost"), ("Johns-MacBook-Pro", "local"), ("NAS", "LOCAL")))
        noreply = "1+synthetic@" + "users.noreply.github.com"

        def commit(message="Synthetic commit", identity=("Synthetic", noreply), committer=None):
            committer = committer or identity
            env = {
                **os.environ,
                "GIT_AUTHOR_NAME": identity[0],
                "GIT_AUTHOR_EMAIL": identity[1],
                "GIT_COMMITTER_NAME": committer[0],
                "GIT_COMMITTER_EMAIL": committer[1],
            }
            subprocess.run(["git", "add", "-A"], cwd=directory, check=True)
            subprocess.run(
                ["git", "commit", "--allow-empty", "-q", "-m", message],
                cwd=directory,
                env=env,
                check=True,
                capture_output=True,
            )

        def run(denylist="Synthetic-Private-Token", event=None, base=None, owner=None):
            env = os.environ.copy()
            env.pop("LEAK_DENYLIST", None)
            if denylist is not None:
                env["LEAK_DENYLIST"] = denylist
            args = [sys.executable, scanner, "--tree", "HEAD"]
            if base is not None:
                args.extend(["--base", base])
            if owner is not None:
                args.extend(["--owner-login", owner])
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
        result = run()
        assert result.returncode == 0 and not result.stdout and not result.stderr
        identity_checks()
        tree_and_history_checks()
        fixture_checks()
        event_text_checks()
def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--base", help="published base commit; scans every outgoing commit's paths, contents and messages")
    parser.add_argument("--head", default="HEAD", help="outgoing commit head")
    parser.add_argument("--tree", help="Git tree to scan without checking it out")
    parser.add_argument("--event-file", help="GitHub event JSON with issue or PR text")
    parser.add_argument("--owner-login", help="repository owner login, allowed as an exact commit identity value")
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
        for identity in set(git("log", "--format=%an%n%ae%n%cn%n%ce", f"{args.base}..{args.head}").splitlines()):
            failed |= identity_leaks(identity, args.owner_login, denylist)
    if args.event_file:
        event = json.loads(Path(args.event_file).read_text())
        payloads = [event[key] for key in ("issue", "pull_request") if isinstance(event.get(key), dict)]
        if not payloads:
            print("event file needs an issue or pull_request object", file=sys.stderr)
            return 2
        for payload in payloads:
            for field in ("title", "body"):
                if payload.get(field):
                    failed |= report(payload[field], denylist)
    return failed


if __name__ == "__main__":
    raise SystemExit(main())
