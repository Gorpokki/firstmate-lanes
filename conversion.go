package main

import (
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

//go:embed converter/converter.py converter/mesh_convert.py converter/mesh_validation.py converter/mesh_render_check.ts web/holo-renderer.ts web/simulation-model.ts
var conversionFiles embed.FS

var conversionNames = []string{"converter/converter.py", "converter/mesh_convert.py", "converter/mesh_validation.py", "converter/mesh_render_check.ts", "web/holo-renderer.ts", "web/simulation-model.ts"}
var converterFingerprint, rendererFingerprint, checkerFingerprint = conversionDigests()

func conversionDigests() (string, string, string) {
	hash := sha256.New()
	var renderer, checker string
	for _, name := range conversionNames {
		data, err := conversionFiles.ReadFile(name)
		if err != nil {
			panic(err)
		}
		hash.Write(data)
		if name == "web/holo-renderer.ts" || name == "converter/mesh_render_check.ts" {
			sum := sha256.Sum256(data)
			digest := hex.EncodeToString(sum[:])
			if name == "web/holo-renderer.ts" {
				renderer = digest
			} else {
				checker = digest
			}
		}
	}
	return hex.EncodeToString(hash.Sum(nil)), renderer, checker
}

func convertShips(modelsRoot, output string) error {
	if _, err := exec.LookPath("bun"); err != nil {
		return fmt.Errorf("model conversion requires Bun: %w", err)
	}
	temporary, err := os.MkdirTemp("", "fmlanes-converter-")
	if err != nil {
		return err
	}
	defer os.RemoveAll(temporary)
	for _, name := range conversionNames {
		data, err := conversionFiles.ReadFile(name)
		if err != nil {
			return err
		}
		path := filepath.Join(temporary, filepath.FromSlash(name))
		if err = os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			return err
		}
		if err = os.WriteFile(path, data, 0600); err != nil {
			return err
		}
	}
	command := exec.Command("uv", "run", "--script", filepath.Join(temporary, "converter", "converter.py"), modelsRoot, output)
	for _, value := range os.Environ() {
		if !strings.HasPrefix(value, "MESH_RENDERER=") && !strings.HasPrefix(value, "PYTHONDONTWRITEBYTECODE=") {
			command.Env = append(command.Env, value)
		}
	}
	command.Env = append(command.Env, "MESH_RENDERER="+filepath.Join(temporary, "web", "holo-renderer.ts"), "PYTHONDONTWRITEBYTECODE=1")
	command.Stdout, command.Stderr = os.Stdout, os.Stderr
	if err := command.Run(); err != nil {
		return fmt.Errorf("model conversion: %w", err)
	}
	return nil
}
