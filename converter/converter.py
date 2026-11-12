# /// script
# dependencies = ["trimesh", "numpy", "fast-simplification", "networkx", "scipy"]
# ///
"""Run: uv run converter.py <models-root> <output-dir>."""

import hashlib
import json
import os
import re
import sys
import tempfile
from pathlib import Path

import trimesh

from mesh_convert import convert
from mesh_validation import VERSION, checker_prerequisites

VALIDATION_VERSION = 1


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def converter_hash(renderer):
    here = Path(__file__).resolve().parent
    files = (here / "converter.py", here / "mesh_convert.py", here / "mesh_validation.py",
             here / "mesh_render_check.ts", renderer, renderer.with_name("simulation-model.ts"))
    return sha256(b"".join(path.read_bytes() for path in files))


def atomic_write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(dir=path.parent, prefix=path.name + ".")
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def _entry_failure(key, rel, name, stamp, error):
    return {"name": name, "slug": "", "dir": rel, "format": "int16-triangles",
            "orient": {}, "stamp": stamp, "output_sha256": {},
            "validation_version": VALIDATION_VERSION,
            "validation": {"pass": False, "algorithm_version": VERSION,
                           "reference_checked": False, "errors": [error]}}


def _read_manifest(raw):
    parsed = json.loads(raw)
    if not isinstance(parsed, dict):
        raise ValueError("manifest must be a JSON object")
    for field in ("key", "name"):
        if field in parsed and (not isinstance(parsed[field], str) or not parsed[field].strip() or
                                any(ord(char) < 32 or ord(char) == 127 for char in parsed[field])):
            raise ValueError(f"manifest {field} must be non-empty text without controls")
    if not isinstance(parsed.get("orient", {}), dict):
        raise ValueError("manifest orient must be an object")
    return parsed


def _complete_certificate(certificate):
    if (not isinstance(certificate, dict) or certificate.get("pass") is not True or
            certificate.get("algorithm_version") != VERSION or
            certificate.get("reference_checked") is not True or
            not certificate.get("renderer_sha256") or not certificate.get("checker_sha256")):
        return False
    checks = certificate.get("validation")
    return (isinstance(checks, dict) and bool(checks) and all(
        isinstance(check, dict) and check.get("pass") is True and
        check.get("algorithm_version") == VERSION and check.get("reference_checked") is True and
        check.get("renderer_sha256") == certificate["renderer_sha256"] and
        check.get("checker_sha256") == certificate["checker_sha256"]
        for check in checks.values()))


def main(models_root, output_dir):
    models_root = Path(models_root).expanduser().resolve()
    output_dir = Path(output_dir).expanduser().resolve()
    if models_root.is_relative_to(output_dir):
        raise ValueError("output directory must not contain the model source root")
    _, _, renderer = checker_prerequisites()
    token = converter_hash(renderer)
    mesh_dir = output_dir / "mesh"
    index_path = output_dir / "meshes.json"
    try:
        previous = json.loads(index_path.read_text()) if index_path.exists() else {}
    except (OSError, ValueError):
        previous = {}
    entries = {}
    for source in sorted(models_root.glob("*/*/model.glb")):
        if source.resolve().is_relative_to(output_dir):
            continue
        rel = source.parent.relative_to(models_root).as_posix()
        manifest_path = source.parent / "manifest.json"
        key, name, stamp = rel, rel, {}
        try:
            manifest_raw = manifest_path.read_bytes() if manifest_path.exists() else b"{}"
            stamp = {"input": sha256(source.read_bytes()),
                     "manifest": sha256(manifest_raw) if manifest_path.exists() else None,
                     "converter": token}
            manifest = _read_manifest(manifest_raw)
            key = manifest.get("key", rel)
            name = manifest.get("name", key)
            orientation = manifest.get("orient", {})
            if not all(isinstance(orientation.get(axis), str) for axis in ("forward", "up")):
                raise ValueError("manifest orient requires explicit forward and up axes")
            old = previous.get(key, {})
            if (old.get("stamp") == stamp and old.get("validation_version") == VALIDATION_VERSION and
                    _complete_certificate(old.get("validation")) and all(
                        (mesh_dir / filename).is_file() and
                        sha256((mesh_dir / filename).read_bytes()) == digest
                        for filename, digest in old.get("output_sha256", {}).items())):
                entries[key] = old
                continue
            model = trimesh.load(source, force="mesh")
            if isinstance(model, trimesh.Scene):
                model = model.to_geometry()
            outputs, certificate = convert(model, orientation["forward"], orientation["up"])
            readable = re.sub(r"[^a-z0-9]+", "-", key.lower()).strip("-")[:48] or "model"
            slug = f"{readable}-{sha256(key.encode())[:12]}"
            output_hashes = {}
            for lod, data in outputs.items():
                filename = f"{slug}.{lod}.bin"
                atomic_write(mesh_dir / filename, data)
                output_hashes[filename] = sha256(data)
            entries[key] = {"name": name, "slug": slug, "dir": rel,
                            "format": "int16-triangles", "orient": orientation,
                            "checked": True, "stamp": stamp, "output_sha256": output_hashes,
                            "validation_version": VALIDATION_VERSION, "validation": certificate}
        except Exception as error:
            entries[key] = _entry_failure(
                key, rel, name, stamp, f"{type(error).__name__}: {error}")
    encoded = (json.dumps(entries, indent=2, sort_keys=True) + "\n").encode()
    atomic_write(index_path, encoded)
    return entries


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("usage: uv run converter.py <models-root> <output-dir>")
    main(Path(sys.argv[1]), Path(sys.argv[2]))
