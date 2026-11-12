"""Synthetic-only algorithm-2 conversion and application workflow checks."""

import hashlib
import json
import sys
from pathlib import Path
from tempfile import TemporaryDirectory

import numpy as np
import trimesh

sys.path.insert(0, str(Path(__file__).parent))
from converter import main
from mesh_convert import convert, normalize, soup
from mesh_validation import VERSION, checker_prerequisites, validate


def decode(data):
    triangles = np.frombuffer(data, dtype="<i2").astype(np.float64).reshape(-1, 3, 3) / 32767
    return trimesh.Trimesh(vertices=triangles.reshape(-1, 3),
                           faces=np.arange(triangles.size // 3).reshape(-1, 3), process=False)



def tetrahedron(vertices=None):
    if vertices is None:
        vertices = [[0., 0., 0.], [3., 0., 0.], [0., 2., 0.], [0., 0., 1.]]
    faces = [[0, 2, 1], [0, 1, 3], [0, 3, 2], [1, 2, 3]]
    return trimesh.Trimesh(vertices=np.asarray(vertices), faces=np.asarray(faces), process=False)


def _check_admission_rules(closed):
    opening = trimesh.Trimesh(vertices=closed.vertices, faces=closed.faces[:3], process=False)
    assert validate(opening)["pass"] and validate(opening)["open_edges"] > 0
    assert validate(opening, opening)["pass"], "intentional opening failed source-relative admission"

    nonmanifold_faces = np.vstack((closed.faces, [[0, 1, 4]]))
    nonmanifold_vertices = np.vstack((closed.vertices, [[1.5, 0., -1.]]))
    nonmanifold = trimesh.Trimesh(vertices=nonmanifold_vertices, faces=nonmanifold_faces,
                                  process=False)
    diagnostic = validate(nonmanifold)
    assert diagnostic["pass"] and diagnostic["nonmanifold_edges"] > 0
    assert validate(nonmanifold, nonmanifold)["pass"], "non-manifold source failed admission"

    box = trimesh.creation.box()
    back_wall_hole = box.copy()
    remove = np.abs(box.face_normals[:, 1]) > 0.99
    back_wall_hole.update_faces(~remove)
    assert not validate(back_wall_hole, box)["pass"], "visible back-wall removal was admitted"

    inverted = closed.copy()
    inverted.faces[0] = inverted.faces[0][::-1]
    inversion = validate(inverted, closed)
    assert not inversion["pass"] and any(
        view["inverted_normal_ratio"] > 0 for view in inversion["views"])

    second = tetrahedron()
    second.apply_translation([5, 0, 0])
    components = trimesh.util.concatenate([closed, second])
    missing_component = validate(closed, components)
    assert not missing_component["pass"]


def _check_convert_source(source, repro):
    outputs, certificate = convert(source, "+x", "+y")
    assert set(outputs) == {"hi", "lo"}
    assert certificate["pass"] and certificate["reference_checked"]
    assert certificate["algorithm_version"] == VERSION
    assert certificate["renderer_sha256"] and certificate["checker_sha256"]
    reference, _ = normalize(source, "+x", "+y")
    for lod, data in outputs.items():
        assert data and len(data) % 18 == 0
        encoded = decode(data)
        check = validate(encoded, reference)
        assert check["pass"] and check["reference_checked"]
        assert certificate["validation"][lod]["pass"]
        if source is repro:
            assert len(encoded.faces) == 4
            assert all(view[key] == 0 for view in check["views"] for key in
                       ("missing_ratio", "added_ratio", "inverted_normal_ratio"))


def _check_tiny_face_dropped(closed):
    tiny_face = np.array([[[0., 0., 0.], [1e-7, 0., 0.], [0., 1e-7, 0.]]])
    outputs, _ = convert(soup(np.vstack((closed.triangles, tiny_face))), "+x", "+y")
    for data in outputs.values():
        actual = decode(data)
        assert validate(actual)["pass"] and len(actual.faces) == 4


def _check_workflow(repro):
    with TemporaryDirectory() as directory:
        root = Path(directory) / "models"
        source_dir = root / "synthetic" / "tetra"
        source_dir.mkdir(parents=True)
        repro.export(source_dir / "model.glb")
        manifest = {"orient": {"forward": "+x", "up": "+y"}}
        (source_dir / "manifest.json").write_text(json.dumps(manifest))
        bad_dir = root / "synthetic" / "bad"
        bad_dir.mkdir()
        repro.export(bad_dir / "model.glb")
        (bad_dir / "manifest.json").write_text('{"orient": []}')

        output = root / "generated"
        generated_source = output / "ignored"
        generated_source.mkdir(parents=True)
        repro.export(generated_source / "model.glb")
        entries = main(root, output)
        index_bytes = (output / "meshes.json").read_bytes()
        assert index_bytes.endswith(b"\n")
        index = json.loads(index_bytes)
        assert sorted(entries) == sorted(index) == ["synthetic/bad", "synthetic/tetra"]
        entry = index["synthetic/tetra"]
        assert entry["validation_version"] == 1
        assert entry["validation"]["algorithm_version"] == VERSION
        assert entry["validation"]["reference_checked"] and entry["validation"]["pass"]
        assert index["synthetic/bad"]["validation"]["pass"] is False
        assert index["synthetic/bad"]["validation"]["reference_checked"] is False
        for filename, digest in entry["output_sha256"].items():
            assert hashlib.sha256((output / "mesh" / filename).read_bytes()).hexdigest() == digest
        filename = next(iter(entry["output_sha256"]))
        (output / "mesh" / filename).write_bytes(b"damaged output")
        repaired = main(root, output)["synthetic/tetra"]
        assert hashlib.sha256((output / "mesh" / filename).read_bytes()).hexdigest() == \
            repaired["output_sha256"][filename]


def run_checks():
    checker_prerequisites()
    closed = tetrahedron()
    _check_admission_rules(closed)

    # Exact float32-GLB reproduction: all four int16 faces survive the actual renderer check.
    repro = tetrahedron(np.asarray([[0, 0, 0], [2.4, 0, 0], [0, 3.2, 0], [0, 0, 1]],
                                   dtype=np.float32))
    for source in (closed, repro):
        _check_convert_source(source, repro)

    _check_tiny_face_dropped(closed)
    _check_workflow(repro)


if __name__ == "__main__":
    run_checks()
    print("converter checks passed")
