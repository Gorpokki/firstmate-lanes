package main

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

type ModelAsset struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Hi       []byte `json:"-"`
	Lo       []byte `json:"-"`
	geometry []meshPoint
}

type modelCertificate struct {
	Name   string `json:"name"`
	Slug   string `json:"slug"`
	Dir    string `json:"dir"`
	Format string `json:"format"`
	Orient struct {
		Forward string `json:"forward"`
		Up      string `json:"up"`
	} `json:"orient"`
	Stamp struct {
		Input     string  `json:"input"`
		Manifest  string  `json:"manifest"`
		Converter string  `json:"converter"`
		Overrides *string `json:"overrides"`
	} `json:"stamp"`
	OutputSHA256      map[string]string `json:"output_sha256"`
	ValidationVersion int               `json:"validation_version"`
	Validation        struct {
		Pass             bool   `json:"pass"`
		AlgorithmVersion int    `json:"algorithm_version"`
		ReferenceChecked bool   `json:"reference_checked"`
		RendererSHA256   string `json:"renderer_sha256"`
		CheckerSHA256    string `json:"checker_sha256"`
	} `json:"validation"`
	Skip string `json:"skip"`
}

var modelSlugPattern = regexp.MustCompile(`^[a-z0-9]+(?:-[a-z0-9]+)*$`)

func LoadModelPool(modelsRoot, convertedRoot, converterDigest string) ([]ModelAsset, error) {
	modelsBase, err := filepath.EvalSymlinks(modelsRoot)
	if err != nil {
		return nil, fmt.Errorf("resolve models root: %w", err)
	}
	convertedBase, err := filepath.EvalSymlinks(convertedRoot)
	if err != nil {
		return nil, fmt.Errorf("resolve converted root: %w", err)
	}
	indexPath, err := containedFile(convertedBase, filepath.Join(convertedBase, "meshes.json"))
	if err != nil {
		return nil, fmt.Errorf("mesh index: %w", err)
	}
	data, err := os.ReadFile(indexPath)
	if err != nil {
		return nil, fmt.Errorf("read mesh index: %w", err)
	}
	var index map[string]modelCertificate
	if err := json.Unmarshal(data, &index); err != nil {
		return nil, fmt.Errorf("decode mesh index: %w", err)
	}
	keys := make([]string, 0, len(index))
	for key := range index {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	assets := make([]ModelAsset, 0, len(keys))
	var failures []string
	for _, key := range keys {
		asset, err := admitModel(modelsBase, convertedBase, key, index[key], converterDigest)
		if err != nil {
			failures = append(failures, fmt.Sprintf("%q: %v", key, err))
			continue
		}
		assets = append(assets, asset)
	}
	if len(failures) != 0 {
		return assets, errors.New(strings.Join(failures, "; "))
	}
	return assets, nil
}

func admitModel(modelsRoot, convertedRoot, key string, c modelCertificate, converterDigest string) (ModelAsset, error) {
	if c.Skip != "" {
		return ModelAsset{}, fmt.Errorf("skipped: %s", c.Skip)
	}
	if c.ValidationVersion != 1 || !c.Validation.Pass || c.Validation.AlgorithmVersion != 2 || !c.Validation.ReferenceChecked {
		return ModelAsset{}, errors.New("missing, stale or failed reference validation certificate")
	}
	if c.Validation.RendererSHA256 != rendererFingerprint || c.Validation.CheckerSHA256 != checkerFingerprint {
		return ModelAsset{}, errors.New("stale renderer or checker fingerprint")
	}
	if c.Format != "int16-triangles" {
		return ModelAsset{}, errors.New("unsupported mesh format")
	}
	if c.Stamp.Overrides != nil {
		return ModelAsset{}, errors.New("overrides are not admitted")
	}
	if !modelSlugPattern.MatchString(c.Slug) {
		return ModelAsset{}, errors.New("unsafe slug")
	}
	if strings.TrimSpace(key) == "" || strings.TrimSpace(c.Name) == "" {
		return ModelAsset{}, errors.New("missing stable key or display name")
	}
	if !validOrientation(c.Orient.Forward, c.Orient.Up) {
		return ModelAsset{}, errors.New("invalid orientation")
	}
	if c.Stamp.Converter != converterDigest {
		return ModelAsset{}, errors.New("stale converter digest")
	}
	rel := filepath.Clean(filepath.FromSlash(c.Dir))
	if rel == "." || filepath.IsAbs(rel) || rel == ".." || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return ModelAsset{}, errors.New("unsafe source directory")
	}
	sourceDir, err := containedPath(modelsRoot, filepath.Join(modelsRoot, rel))
	if err != nil {
		return ModelAsset{}, fmt.Errorf("source directory: %w", err)
	}
	modelPath, err := containedFile(modelsRoot, filepath.Join(sourceDir, "model.glb"))
	if err != nil {
		return ModelAsset{}, fmt.Errorf("source model: %w", err)
	}
	manifestPath, err := containedFile(modelsRoot, filepath.Join(sourceDir, "manifest.json"))
	if err != nil {
		return ModelAsset{}, fmt.Errorf("manifest: %w", err)
	}
	if err := hashMatches(modelPath, c.Stamp.Input); err != nil {
		return ModelAsset{}, fmt.Errorf("source model: %w", err)
	}
	if err := hashMatches(manifestPath, c.Stamp.Manifest); err != nil {
		return ModelAsset{}, fmt.Errorf("manifest: %w", err)
	}
	manifestBytes, err := os.ReadFile(manifestPath)
	if err != nil {
		return ModelAsset{}, err
	}
	var manifest struct {
		Name   string `json:"name"`
		Key    string `json:"key"`
		Orient struct {
			Forward string `json:"forward"`
			Up      string `json:"up"`
		} `json:"orient"`
	}
	if err := json.Unmarshal(manifestBytes, &manifest); err != nil {
		return ModelAsset{}, fmt.Errorf("decode manifest: %w", err)
	}
	if manifest.Key == "" {
		manifest.Key = filepath.ToSlash(rel)
	}
	if manifest.Name == "" {
		manifest.Name = manifest.Key
	}
	if manifest.Key != key || manifest.Name != c.Name || manifest.Orient.Forward != c.Orient.Forward || manifest.Orient.Up != c.Orient.Up {
		return ModelAsset{}, errors.New("manifest metadata differs from certificate")
	}
	hiName, loName := c.Slug+".hi.bin", c.Slug+".lo.bin"
	hiPath, err := containedFile(convertedRoot, filepath.Join(convertedRoot, "mesh", hiName))
	if err != nil {
		return ModelAsset{}, fmt.Errorf("high mesh: %w", err)
	}
	loPath, err := containedFile(convertedRoot, filepath.Join(convertedRoot, "mesh", loName))
	if err != nil {
		return ModelAsset{}, fmt.Errorf("low mesh: %w", err)
	}
	hi, err := os.ReadFile(hiPath)
	if err != nil {
		return ModelAsset{}, err
	}
	lo, err := os.ReadFile(loPath)
	if err != nil {
		return ModelAsset{}, err
	}
	if err := hashBytesMatch(hi, c.OutputSHA256[hiName]); err != nil {
		return ModelAsset{}, fmt.Errorf("high mesh: %w", err)
	}
	if err := hashBytesMatch(lo, c.OutputSHA256[loName]); err != nil {
		return ModelAsset{}, fmt.Errorf("low mesh: %w", err)
	}
	if err := validInt16Mesh(hi); err != nil {
		return ModelAsset{}, fmt.Errorf("high mesh: %w", err)
	}
	if err := validInt16Mesh(lo); err != nil {
		return ModelAsset{}, fmt.Errorf("low mesh: %w", err)
	}
	return ModelAsset{ID: key, Name: c.Name, Hi: hi, Lo: lo}, nil
}

func containedPath(root, path string) (string, error) {
	resolved, err := filepath.EvalSymlinks(path)
	if err != nil {
		return "", err
	}
	rel, err := filepath.Rel(root, resolved)
	if err != nil || rel == ".." || filepath.IsAbs(rel) || strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", errors.New("path escapes root")
	}
	return resolved, nil
}

func containedFile(root, path string) (string, error) {
	resolved, err := containedPath(root, path)
	if err != nil {
		return "", err
	}
	st, err := os.Stat(resolved)
	if err != nil {
		return "", err
	}
	if !st.Mode().IsRegular() {
		return "", errors.New("not a regular file")
	}
	return resolved, nil
}

func hashMatches(path, expected string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	return hashBytesMatch(data, expected)
}

func hashBytesMatch(data []byte, expected string) error {
	if len(expected) != 64 {
		return errors.New("missing or malformed SHA-256")
	}
	sum := sha256.Sum256(data)
	if hex.EncodeToString(sum[:]) != strings.ToLower(expected) {
		return errors.New("SHA-256 mismatch")
	}
	return nil
}

func validOrientation(forward, up string) bool {
	axis := func(value string) (byte, bool) {
		if len(value) != 2 || (value[0] != '+' && value[0] != '-') {
			return 0, false
		}
		switch value[1] {
		case 'x', 'y', 'z':
			return value[1], true
		default:
			return 0, false
		}
	}
	f, ok := axis(forward)
	if !ok {
		return false
	}
	u, ok := axis(up)
	return ok && f != u
}

func validInt16Mesh(data []byte) error {
	if len(data) == 0 || len(data)%18 != 0 {
		return errors.New("invalid int16 triangle byte length")
	}
	for i := 0; i < len(data); i += 2 {
		v := int16(uint16(data[i]) | uint16(data[i+1])<<8)
		if v < -32767 {
			return errors.New("int16 coordinate exceeds normalized range")
		}
	}
	for i := 0; i < len(data); i += 6 {
		x := float64(int16(uint16(data[i])|uint16(data[i+1])<<8)) / 32767
		y := float64(int16(uint16(data[i+2])|uint16(data[i+3])<<8)) / 32767
		z := float64(int16(uint16(data[i+4])|uint16(data[i+5])<<8)) / 32767
		if x*x+y*y+z*z > 1 {
			return errors.New("vertex exceeds normalized bounding radius")
		}
	}
	return nil
}

func LoadLaneDropins(root string) ([]Lane, error) {
	rootResolved, err := filepath.EvalSymlinks(root)
	if err != nil {
		return nil, err
	}
	lanesDir, err := containedPath(rootResolved, filepath.Join(rootResolved, "lanes"))
	if err != nil {
		return nil, fmt.Errorf("lanes directory: %w", err)
	}
	entries, err := os.ReadDir(lanesDir)
	if err != nil {
		return nil, err
	}
	lanes := make([]Lane, 0)
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".lane.json") {
			continue
		}
		path, err := containedFile(rootResolved, filepath.Join(lanesDir, entry.Name()))
		if err != nil {
			return nil, fmt.Errorf("lane %s: %w", entry.Name(), err)
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return nil, fmt.Errorf("lane %s: %w", entry.Name(), err)
		}
		record, invalid, err := ParseLaneRecord(data)
		if err != nil {
			return nil, fmt.Errorf("lane %s: %w", entry.Name(), err)
		}
		id := strings.TrimSuffix(entry.Name(), ".lane.json")
		lane := Lane{ID: id, Kind: "local", Home: "local"}
		applyLaneRecord(&lane, &record, invalid)
		lanes = append(lanes, lane)
	}
	sort.Slice(lanes, func(i, j int) bool { return lanes[i].ID < lanes[j].ID })
	return lanes, nil
}
