package main

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestLocalModelCannotShadowDefaultsOrServeStaleGeometry(t *testing.T) {
	root := t.TempDir()
	models := filepath.Join(root, "models")
	converted := filepath.Join(root, "converted")
	builtIn := proceduralModels()[0]
	source := []byte("self-made surface")
	manifest, _ := json.Marshal(map[string]any{"key": builtIn.ID, "name": "Local surface", "orient": map[string]string{"forward": "+x", "up": "+y"}})
	geometry := make([]byte, 18)
	for i, value := range []int16{-32767, 0, 0, 0, 32767, 0, 32767, 0, 0} {
		binary.LittleEndian.PutUint16(geometry[i*2:], uint16(value))
	}
	sourcePath := filepath.Join(models, "group", "surface", "model.glb")
	for _, directory := range []string{filepath.Dir(sourcePath), filepath.Join(converted, "mesh")} {
		if err := os.MkdirAll(directory, 0700); err != nil {
			t.Fatal(err)
		}
	}
	writeTestFile(t, sourcePath, source)
	writeTestFile(t, filepath.Join(models, "group", "surface", "manifest.json"), manifest)
	writeTestFile(t, filepath.Join(converted, "mesh", "surface.hi.bin"), geometry)
	writeTestFile(t, filepath.Join(converted, "mesh", "surface.lo.bin"), geometry)
	certificate := modelCertificate{Name: "Local surface", Slug: "surface", Dir: "group/surface", Format: "int16-triangles", ValidationVersion: 1,
		OutputSHA256: map[string]string{"surface.hi.bin": testDigest(geometry), "surface.lo.bin": testDigest(geometry)}}
	certificate.Orient.Forward = "+x"
	certificate.Orient.Up = "+y"
	certificate.Stamp.Input = testDigest(source)
	certificate.Stamp.Manifest = testDigest(manifest)
	certificate.Stamp.Converter = converterFingerprint
	certificate.Validation.Pass = true
	certificate.Validation.AlgorithmVersion = 2
	certificate.Validation.ReferenceChecked = true
	certificate.Validation.RendererSHA256 = rendererFingerprint
	certificate.Validation.CheckerSHA256 = checkerFingerprint
	index, err := json.Marshal(map[string]modelCertificate{builtIn.ID: certificate})
	if err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(converted, "meshes.json"), index)
	mux := http.NewServeMux()
	mountModelRoutes(mux, runtimeConfig{Models: models, Ships: converted})
	get := func(path string) *httptest.ResponseRecorder {
		response := httptest.NewRecorder()
		mux.ServeHTTP(response, httptest.NewRequest("GET", path, nil))
		return response
	}
	catalog := get("/meshes.json")
	var decoded struct {
		Models []ModelAsset `json:"models"`
	}
	if err = json.Unmarshal(catalog.Body.Bytes(), &decoded); err != nil {
		t.Fatal(err)
	}
	names := map[string]string{}
	for _, model := range decoded.Models {
		names[model.ID] = model.Name
	}
	if names[builtIn.ID] != builtIn.Name || names["local/"+builtIn.ID] != "Local surface" {
		t.Fatalf("model identity collision: %+v", names)
	}
	local := get("/mesh?id=local/" + builtIn.ID + "&lod=lo")
	if local.Code != http.StatusOK || !bytes.Equal(local.Body.Bytes(), geometry) {
		t.Fatalf("local mesh unavailable: %d", local.Code)
	}
	writeTestFile(t, sourcePath, []byte("changed source"))
	if response := get("/mesh?id=local/" + builtIn.ID + "&lod=lo"); response.Code != http.StatusConflict {
		t.Fatalf("stale mesh served: %d", response.Code)
	}
	if response := get("/mesh?id=" + builtIn.ID + "&lod=hi"); response.Code != http.StatusOK || !bytes.Equal(response.Body.Bytes(), builtIn.Hi) {
		t.Fatalf("local failure damaged public default: %d", response.Code)
	}
}
