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
	digest := converterFingerprint
	mux.HandleFunc("GET /meshes.json", func(w http.ResponseWriter, r *http.Request) {
		models := append([]ModelAsset(nil), proceduralModels()...)
		warnings := []string{}
		if _, err := os.Stat(filepath.Join(config.Ships, "meshes.json")); err == nil {
			admitted, err := LoadModelPool(config.Models, config.Ships, digest)
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
	})
	mux.HandleFunc("GET /mesh", func(w http.ResponseWriter, r *http.Request) {
		key, lod := r.URL.Query().Get("id"), r.URL.Query().Get("lod")
		if key == "" || (lod != "hi" && lod != "lo") {
			http.Error(w, "invalid mesh request", http.StatusBadRequest)
			return
		}
		var model ModelAsset
		found := false
		for _, builtIn := range proceduralModels() {
			if builtIn.ID == key {
				model = builtIn
				found = true
				break
			}
		}
		if !found {
			localKey, local := strings.CutPrefix(key, "local/")
			if !local || localKey == "" {
				http.NotFound(w, r)
				return
			}
			modelsRoot, err := filepath.EvalSymlinks(config.Models)
			if err != nil {
				http.NotFound(w, r)
				return
			}
			convertedRoot, err := filepath.EvalSymlinks(config.Ships)
			if err != nil {
				http.NotFound(w, r)
				return
			}
			indexPath, err := containedFile(convertedRoot, filepath.Join(convertedRoot, "meshes.json"))
			if err != nil {
				http.NotFound(w, r)
				return
			}
			data, err := os.ReadFile(indexPath)
			if err != nil {
				http.NotFound(w, r)
				return
			}
			var index map[string]modelCertificate
			if err = json.Unmarshal(data, &index); err != nil {
				http.Error(w, "model index unavailable", http.StatusServiceUnavailable)
				return
			}
			certificate, ok := index[localKey]
			if !ok {
				http.NotFound(w, r)
				return
			}
			model, err = admitModel(modelsRoot, convertedRoot, localKey, certificate, digest)
			if err != nil {
				http.Error(w, "model is not currently admitted", http.StatusConflict)
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
	})
}
