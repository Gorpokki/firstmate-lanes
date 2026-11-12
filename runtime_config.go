package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

type runtimeConfig struct {
	DropIn   string `json:"drop_in"`
	Ships    string `json:"ships"`
	Models   string `json:"models"`
	StateDir string `json:"-"`
}

func loadRuntimeConfig(dropIn, ships string) (runtimeConfig, error) {
	state := os.Getenv("XDG_STATE_HOME")
	if state == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return runtimeConfig{}, err
		}
		state = filepath.Join(home, ".local", "state")
	}
	if !filepath.IsAbs(state) {
		return runtimeConfig{}, errors.New("XDG_STATE_HOME must be absolute")
	}
	config := runtimeConfig{StateDir: filepath.Join(state, "fmlanes")}
	path := os.Getenv("FM_LANES_CONFIG")
	if path == "" {
		path = filepath.Join(config.StateDir, "config.json")
	}
	data, err := os.ReadFile(path)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return config, err
	}
	if err == nil {
		if err = json.Unmarshal(data, &config); err != nil {
			return config, fmt.Errorf("dashboard configuration: %w", err)
		}
	}
	if dropIn != "" {
		config.DropIn = dropIn
	}
	if config.DropIn == "" {
		config.DropIn = filepath.Join(config.StateDir, "dropins")
	}
	if ships != "" {
		config.Ships = ships
		config.Models = filepath.Dir(ships)
	}
	if config.Models == "" {
		config.Models = filepath.Join(config.DropIn, "models")
	}
	if config.Ships == "" {
		config.Ships = filepath.Join(config.Models, "converted")
	}
	for _, p := range []*string{&config.DropIn, &config.Models, &config.Ships} {
		if !filepath.IsAbs(*p) {
			*p = filepath.Join(filepath.Dir(path), *p)
		}
	}
	return config, nil
}

func (c runtimeConfig) protectHomes(home string) error {
	sources, err := homeSources(home)
	if err != nil {
		return err
	}
	targets := []string{c.StateDir}
	if c.DropIn != "" {
		targets = append(targets, filepath.Join(c.DropIn, "models"), filepath.Join(c.DropIn, "lanes"))
	}
	for _, path := range targets {
		target, err := canonicalTarget(path)
		if err != nil {
			return err
		}
		for _, source := range sources {
			relative, err := filepath.Rel(source.Path, target)
			if err != nil {
				return err
			}
			if relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
				return errors.New("application writes must stay outside every home")
			}
		}
	}
	return nil
}

func canonicalTarget(path string) (string, error) {
	path, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	var suffix []string
	for {
		resolved, err := filepath.EvalSymlinks(path)
		if err == nil {
			for i := len(suffix) - 1; i >= 0; i-- {
				resolved = filepath.Join(resolved, suffix[i])
			}
			return resolved, nil
		}
		if !errors.Is(err, os.ErrNotExist) {
			return "", err
		}
		parent := filepath.Dir(path)
		if parent == path {
			return "", err
		}
		suffix = append(suffix, filepath.Base(path))
		path = parent
	}
}
