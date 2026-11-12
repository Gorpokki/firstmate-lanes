package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

func mountModelRoutes(mux *http.ServeMux, config runtimeConfig) {
	mux.HandleFunc("GET /meshes.json", func(w http.ResponseWriter, r *http.Request) { modelServeIndex(w, config) })
	mux.HandleFunc("GET /mesh", func(w http.ResponseWriter, r *http.Request) { modelServeMesh(w, r, config) })
}

func modelServeIndex(w http.ResponseWriter, config runtimeConfig) {
	models := append([]ModelAsset(nil), proceduralModels()...)
	warnings := []string{}
	if _, err := os.Stat(filepath.Join(config.Ships, "meshes.json")); err == nil {
		admitted, err := LoadModelPool(config.Models, config.Ships, converterFingerprint)
		for i := range admitted {
			admitted[i].ID = "local/" + admitted[i].ID
		}
		models = append(models, admitted...)
		if err != nil {
			warnings = append(warnings, err.Error())
		}
	} else if !errors.Is(err, os.ErrNotExist) {
		warnings = append(warnings, "model index unavailable")
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	json.NewEncoder(w).Encode(struct {
		Models   []ModelAsset `json:"models"`
		Warnings []string     `json:"warnings"`
	}{models, warnings})
}

func modelServeMesh(w http.ResponseWriter, r *http.Request, config runtimeConfig) {
	key, lod := r.URL.Query().Get("id"), r.URL.Query().Get("lod")
	if key == "" || (lod != "hi" && lod != "lo") {
		http.Error(w, "invalid mesh request", http.StatusBadRequest)
		return
	}
	model, found := modelBuiltIn(key)
	if !found {
		var status int
		var message string
		if model, status, message = modelLoadLocal(config, key); status != 0 {
			if status == http.StatusNotFound {
				http.NotFound(w, r)
			} else {
				http.Error(w, message, status)
			}
			return
		}
	}
	geometry := model.Hi
	if lod == "lo" {
		geometry = model.Lo
	}
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Cache-Control", "no-store")
	w.Write(geometry)
}

func modelBuiltIn(key string) (ModelAsset, bool) {
	for _, builtIn := range proceduralModels() {
		if builtIn.ID == key {
			return builtIn, true
		}
	}
	return ModelAsset{}, false
}

// modelLoadLocal admits a converted model; a non-zero status means the request failed.
func modelLoadLocal(config runtimeConfig, key string) (ModelAsset, int, string) {
	localKey, local := strings.CutPrefix(key, "local/")
	if !local || localKey == "" {
		return ModelAsset{}, http.StatusNotFound, ""
	}
	modelsRoot, err := filepath.EvalSymlinks(config.Models)
	if err != nil {
		return ModelAsset{}, http.StatusNotFound, ""
	}
	convertedRoot, err := filepath.EvalSymlinks(config.Ships)
	if err != nil {
		return ModelAsset{}, http.StatusNotFound, ""
	}
	indexPath, err := containedFile(convertedRoot, filepath.Join(convertedRoot, "meshes.json"))
	if err != nil {
		return ModelAsset{}, http.StatusNotFound, ""
	}
	data, err := os.ReadFile(indexPath)
	if err != nil {
		return ModelAsset{}, http.StatusNotFound, ""
	}
	var index map[string]modelCertificate
	if err = json.Unmarshal(data, &index); err != nil {
		return ModelAsset{}, http.StatusServiceUnavailable, "model index unavailable"
	}
	certificate, ok := index[localKey]
	if !ok {
		return ModelAsset{}, http.StatusNotFound, ""
	}
	model, err := admitModel(modelsRoot, convertedRoot, localKey, certificate, converterFingerprint)
	if err != nil {
		return ModelAsset{}, http.StatusConflict, "model is not currently admitted"
	}
	return model, 0, ""
}
