package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoadModelPoolAdmitsHealthyAndReturnsQuarantineDiagnostics(t *testing.T) {
	root := t.TempDir()
	models := filepath.Join(root, "models")
	converted := filepath.Join(models, "converted")
	source := filepath.Join(models, "group", "ship")
	if err := os.MkdirAll(source, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(converted, "mesh"), 0755); err != nil {
		t.Fatal(err)
	}
	model := []byte("synthetic model")
	manifest := []byte(`{"key":"ship.one","name":"One","orient":{"forward":"+x","up":"+y"}}`)
	mesh := make([]byte, 18)
	writeTestFile(t, filepath.Join(source, "model.glb"), model)
	writeTestFile(t, filepath.Join(source, "manifest.json"), manifest)
	writeTestFile(t, filepath.Join(converted, "mesh", "one.hi.bin"), mesh)
	writeTestFile(t, filepath.Join(converted, "mesh", "one.lo.bin"), mesh)
	cert := modelCertificate{Name: "One", Slug: "one", Dir: "group/ship", Format: "int16-triangles", OutputSHA256: map[string]string{"one.hi.bin": testDigest(mesh), "one.lo.bin": testDigest(mesh)}, ValidationVersion: 1}
	cert.Orient.Forward = "+x"
	cert.Orient.Up = "+y"
	cert.Stamp.Input = testDigest(model)
	cert.Stamp.Manifest = testDigest(manifest)
	cert.Stamp.Converter = strings.Repeat("b", 64)
	cert.Validation.Pass = true
	cert.Validation.AlgorithmVersion = 2
	cert.Validation.ReferenceChecked = true
	cert.Validation.RendererSHA256 = rendererFingerprint
	cert.Validation.CheckerSHA256 = checkerFingerprint
	quarantined := cert
	quarantined.Skip = "quarantined"
	index, err := json.Marshal(map[string]modelCertificate{"ship.one": cert, "ship.quarantined": quarantined})
	if err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(converted, "meshes.json"), index)
	assets, err := LoadModelPool(models, converted, strings.Repeat("b", 64))
	if err == nil || len(assets) != 1 || assets[0].ID != "ship.one" || assets[0].Name != "One" || string(assets[0].Hi) != string(mesh) || string(assets[0].Lo) != string(mesh) {
		t.Fatalf("expected healthy asset and quarantine diagnostic, got %#v, %v", assets, err)
	}
	encoded, err := json.Marshal(assets[0])
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), "group/ship") {
		t.Fatalf("private source path leaked: %s", encoded)
	}
}

func TestLoadModelPoolAdmissionBoundaries(t *testing.T) {
	for _, mode := range []string{"source", "output", "traversal", "symlink", "algorithm", "reference", "renderer", "checker", "format", "optional-identity"} {
		t.Run(mode, func(t *testing.T) { runAdmissionBoundaryMode(t, mode) })
	}
}

func runAdmissionBoundaryMode(t *testing.T, mode string) {
	root := t.TempDir()
	models := filepath.Join(root, "models")
	converted := filepath.Join(models, "converted")
	source := filepath.Join(models, "group", "ship")
	if err := os.MkdirAll(source, 0755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(converted, "mesh"), 0755); err != nil {
		t.Fatal(err)
	}
	model := []byte("source")
	manifest := []byte(`{"key":"ship.one","name":"One","orient":{"forward":"+x","up":"+y"}}`)
	mesh := make([]byte, 18)
	writeTestFile(t, filepath.Join(source, "model.glb"), model)
	writeTestFile(t, filepath.Join(source, "manifest.json"), manifest)
	writeTestFile(t, filepath.Join(converted, "mesh", "one.hi.bin"), mesh)
	writeTestFile(t, filepath.Join(converted, "mesh", "one.lo.bin"), mesh)
	cert := modelCertificate{Name: "One", Slug: "one", Dir: "group/ship", Format: "int16-triangles", OutputSHA256: map[string]string{"one.hi.bin": testDigest(mesh), "one.lo.bin": testDigest(mesh)}, ValidationVersion: 1}
	cert.Orient.Forward = "+x"
	cert.Orient.Up = "+y"
	cert.Stamp.Input = testDigest(model)
	cert.Stamp.Manifest = testDigest(manifest)
	cert.Stamp.Converter = strings.Repeat("b", 64)
	cert.Validation.Pass = true
	cert.Validation.AlgorithmVersion = 2
	cert.Validation.ReferenceChecked = true
	cert.Validation.RendererSHA256 = rendererFingerprint
	cert.Validation.CheckerSHA256 = checkerFingerprint
	applyAdmissionBoundaryMode(t, mode, root, source, converted, mesh, &cert)
	key := "ship.one"
	if mode == "optional-identity" {
		key = "group/ship"
	}
	index, err := json.Marshal(map[string]modelCertificate{key: cert})
	if err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(converted, "meshes.json"), index)
	assets, err := LoadModelPool(models, converted, strings.Repeat("b", 64))
	if mode == "optional-identity" {
		if err != nil || len(assets) != 1 || assets[0].ID != key || assets[0].Name != key {
			t.Fatalf("default identity was not admitted: %#v, %v", assets, err)
		}
	} else if err == nil {
		t.Fatal("expected admission diagnostic")
	}
}

func applyAdmissionBoundaryMode(t *testing.T, mode, root, source, converted string, mesh []byte, cert *modelCertificate) {
	switch mode {
	case "algorithm":
		cert.Validation.AlgorithmVersion = 1
	case "reference":
		cert.Validation.ReferenceChecked = false
	case "renderer":
		cert.Validation.RendererSHA256 = strings.Repeat("c", 64)
	case "checker":
		cert.Validation.CheckerSHA256 = strings.Repeat("c", 64)
	case "format":
		cert.Format = "float32-triangles"
	case "optional-identity":
		manifest := []byte(`{"orient":{"forward":"+x","up":"+y"}}`)
		writeTestFile(t, filepath.Join(source, "manifest.json"), manifest)
		cert.Stamp.Manifest = testDigest(manifest)
		cert.Name = "group/ship"
	case "source":
		writeTestFile(t, filepath.Join(source, "model.glb"), []byte("changed"))
	case "output":
		writeTestFile(t, filepath.Join(converted, "mesh", "one.hi.bin"), []byte("changed"))
	case "traversal":
		cert.Slug = "../escape"
	case "symlink":
		outside := filepath.Join(root, "outside.bin")
		writeTestFile(t, outside, mesh)
		if err := os.Remove(filepath.Join(converted, "mesh", "one.hi.bin")); err != nil {
			t.Fatal(err)
		}
		if err := os.Symlink(outside, filepath.Join(converted, "mesh", "one.hi.bin")); err != nil {
			t.Fatal(err)
		}
	}
}

func TestLoadLaneDropinsValidatesAndUsesLocalAlias(t *testing.T) {
	root := t.TempDir()
	lanesDir := filepath.Join(root, "lanes")
	if err := os.MkdirAll(lanesDir, 0755); err != nil {
		t.Fatal(err)
	}
	valid := `{"name":"Drop-in","state":"working","now":"Building","start":"2026-01-02T03:04:05Z","history":[],"asks":[]}`
	writeTestFile(t, filepath.Join(lanesDir, "sample.lane.json"), []byte(valid))
	lanes, err := LoadLaneDropins(root)
	if err != nil {
		t.Fatal(err)
	}
	if len(lanes) != 1 || lanes[0].ID != "sample" || lanes[0].Home != "local" || lanes[0].Kind != "local" || lanes[0].Title != "Drop-in" || lanes[0].Record == nil {
		t.Fatalf("unexpected lane: %#v", lanes)
	}
	writeTestFile(t, filepath.Join(lanesDir, "broken.lane.json"), []byte(`{"name":"broken"}`))
	if _, err := LoadLaneDropins(root); err == nil {
		t.Fatal("malformed drop-in must fail")
	}
}

func TestValidInt16MeshChecksVertexRadius(t *testing.T) {
	mesh := make([]byte, 18)
	mesh[0], mesh[1], mesh[2], mesh[3] = 0xff, 0x7f, 0xff, 0x7f
	if err := validInt16Mesh(mesh); err == nil {
		t.Fatal("vertex outside unit radius must fail")
	}
}

func writeTestFile(t *testing.T, path string, data []byte) {
	t.Helper()
	if err := os.WriteFile(path, data, 0644); err != nil {
		t.Fatal(err)
	}
}

func testDigest(data []byte) string {
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:])
}
