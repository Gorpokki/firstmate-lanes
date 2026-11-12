"""Visible conversion defects against a calibrated source; topology is diagnostic."""

import json
import os
import pathlib
import shutil
import struct
import subprocess

import numpy as np

VERSION = 2
TOLERANCE = 0.02
MAX_VISIBLE_LOSS = 0.01


def _diagnostics(mesh):
    if not len(mesh.faces) or not np.isfinite(mesh.vertices).all():
        return {"pass": False, "algorithm_version": VERSION, "reference_checked": False,
                "errors": ["empty or non-finite mesh"]}
    checked = mesh.copy()
    checked.merge_vertices(digits_vertex=12)
    _, counts = np.unique(np.sort(checked.edges, axis=1), axis=0, return_counts=True)
    return {"pass": True, "algorithm_version": VERSION, "reference_checked": False,
            "errors": [], "triangles": len(checked.faces),
            "open_edges": int((counts == 1).sum()),
            "nonmanifold_edges": int((counts > 2).sum()),
            "degenerate_faces": int((~checked.nondegenerate_faces(height=1e-10)).sum()),
            "duplicate_faces": int((~checked.unique_faces()).sum()),
            "winding_consistent": bool(checked.is_winding_consistent),
            "inverted_shells": int(not (counts == 1).any() and not (counts > 2).any()
                                    and checked.volume < 0)}


def checker_prerequisites():
    renderer = pathlib.Path(os.environ.get(
        "MESH_RENDERER", pathlib.Path(__file__).resolve().parent.parent /
        "web" / "holo-renderer.ts")).expanduser().resolve()
    checker = pathlib.Path(__file__).with_name("mesh_render_check.ts").resolve()
    bun = shutil.which("bun")
    missing = [str(path) for path in (checker, renderer) if not path.is_file()]
    if not bun:
        missing.insert(0, "bun executable")
    if missing:
        raise RuntimeError("algorithm-2 checker prerequisites missing: " + ", ".join(missing))
    return bun, checker, renderer


def validate(mesh, reference=None, tolerance=TOLERANCE,
             max_visible_loss=MAX_VISIBLE_LOSS, prerequisites=None):
    result = _diagnostics(mesh)
    if reference is None or not result["pass"]:
        return result
    if not len(reference.faces) or not np.isfinite(reference.vertices).all():
        result["pass"] = False
        result["errors"].append("empty or non-finite reference")
        return result
    bun, checker, renderer = prerequisites or checker_prerequisites()
    source = np.asarray(reference.triangles, dtype="<f4")
    output = np.asarray(mesh.triangles, dtype="<f4")
    payload = struct.pack("<II", source.size, output.size) + source.tobytes() + output.tobytes()
    process = subprocess.run([bun, str(checker), str(renderer), str(tolerance),
                              str(max_visible_loss)], input=payload, capture_output=True,
                             check=True)
    checked = json.loads(process.stdout)
    result.update(checked)
    result["algorithm_version"] = VERSION
    result["reference_checked"] = checked.get("reference_checked") is True
    if not result["reference_checked"]:
        result["pass"] = False
        result.setdefault("errors", []).append("renderer did not check the source reference")
    source_radius = float(np.linalg.norm(reference.vertices, axis=1).max())
    output_radius = float(np.linalg.norm(mesh.vertices, axis=1).max())
    result.update(source_radius=source_radius, output_radius=output_radius)
    if output_radius > source_radius + tolerance:
        result["errors"].append("output exceeds calibrated source radius tolerance")
        result["pass"] = False
    return result
