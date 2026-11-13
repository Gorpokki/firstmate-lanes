"""Convert oriented source meshes to certified normalized int16 triangle LODs."""

import numpy as np
import trimesh

from mesh_validation import TOLERANCE, VERSION, checker_prerequisites, validate

AXES = ("+x", "-x", "+y", "-y", "+z", "-z")


def soup(triangles):
    triangles = np.asarray(triangles, dtype=np.float64).reshape(-1, 3, 3)
    mesh = trimesh.Trimesh(vertices=triangles.reshape(-1, 3),
                           faces=np.arange(triangles.size // 3).reshape(-1, 3), process=False)
    _clean(mesh)
    return mesh


def _clean(mesh):
    mesh.merge_vertices(digits_vertex=12)
    mesh.update_faces(mesh.nondegenerate_faces(height=1e-10))
    mesh.update_faces(mesh.unique_faces())
    mesh.remove_unreferenced_vertices()
    if len(mesh.faces):
        trimesh.repair.fix_winding(mesh)
        trimesh.repair.fix_normals(mesh, multibody=True)
    return mesh


def normalize(mesh, forward, up):
    def axis(value):
        if value not in AXES:
            raise ValueError(f"invalid orientation axis: {value}")
        return np.eye(3)["xyz".index(value[1])] * (1 if value[0] == "+" else -1)

    f, u = axis(forward), axis(up)
    if np.dot(f, u):
        raise ValueError("forward and up must be perpendicular axes")
    triangles = np.asarray(mesh.triangles, dtype=np.float64)
    if not len(triangles) or not np.isfinite(triangles).all():
        raise ValueError("empty or non-finite source mesh")
    repaired = soup(triangles)
    if not len(repaired.faces):
        raise ValueError("source repair left no faces")
    oriented = np.asarray(repaired.triangles) @ np.stack((f, u, np.cross(f, u))).T
    points = oriented.reshape(-1, 3)
    center = (points.max(axis=0) + points.min(axis=0)) / 2
    radius = float(np.linalg.norm(points - center, axis=1).max())
    if not np.isfinite(radius) or radius <= 0:
        raise ValueError("source mesh has no finite extent")
    return soup((oriented - center) / radius), {"center": center.tolist(), "radius": radius}


def _decode(data):
    triangles = np.frombuffer(data, dtype="<i2").astype(np.float64).reshape(-1, 3, 3) / 32767
    return trimesh.Trimesh(vertices=triangles.reshape(-1, 3),
                           faces=np.arange(triangles.size // 3).reshape(-1, 3), process=False)



def _pack(mesh):
    if not len(mesh.faces):
        return b""
    quantized = np.rint(np.clip(np.asarray(mesh.triangles), -1, 1) * 32767).astype(np.int64)
    radius = np.linalg.norm(quantized.reshape(-1, 3), axis=1).max()
    if radius > 32767:
        quantized = np.rint(quantized * (32767 / radius)).astype(np.int64)
    if np.linalg.norm(quantized, axis=-1).max() > 32767:
        quantized = np.rint(quantized * (32766 / 32767)).astype(np.int64)
    return quantized.astype("<i2").tobytes()


def _encode(mesh):
    repaired = _decode(_pack(mesh))
    _clean(repaired)
    data = _pack(repaired)
    return data, _decode(data)


def _decimate(normalized, budget):
    if len(normalized.faces) <= budget:
        return normalized
    try:
        candidate = normalized.simplify_quadric_decimation(face_count=budget)
        if candidate is None:
            candidate = normalized
        _clean(candidate)
        if not len(candidate.faces):
            candidate = normalized
    except (ValueError, RuntimeError):
        candidate = normalized
    return candidate


def _summary_certificate(certificates, transform):
    first = next(iter(certificates.values()))
    return {"pass": all(c["pass"] and c["reference_checked"]
                        for c in certificates.values()),
            "reference_checked": all(c["reference_checked"]
                                     for c in certificates.values()),
            "algorithm_version": VERSION, "encoding": "int16-triangles",
            "renderer_sha256": first["renderer_sha256"],
            "checker_sha256": first["checker_sha256"],
            "transform": transform, "validation": certificates}


def convert(mesh, forward, up, budgets=None):
    budgets = budgets or {"hi": 4000, "lo": 900}
    normalized, transform = normalize(mesh, forward, up)
    prerequisites = checker_prerequisites()
    outputs, certificates = {}, {}
    full = None
    for lod, budget in budgets.items():
        candidate = _decimate(normalized, budget)
        data, decoded = _encode(candidate)
        certificate = validate(decoded, normalized, TOLERANCE, prerequisites=prerequisites)
        if candidate is normalized:
            full = data, certificate
        if not certificate["pass"] and candidate is not normalized:
            if full is None:
                full_data, full_decoded = _encode(normalized)
                full = (full_data, validate(full_decoded, normalized, TOLERANCE,
                                             prerequisites=prerequisites))
            data, certificate = full
            certificate = {**certificate, "retained_source_detail": True}
        if not certificate["pass"] or not certificate["reference_checked"]:
            raise ValueError(f"{lod} output failed validation: " +
                             "; ".join(certificate.get("errors", ["reference not checked"])))
        outputs[lod] = data
        certificates[lod] = certificate
    return outputs, _summary_certificate(certificates, transform)
