package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestRelativeFlagPathsResolveAgainstWorkingDirectory(t *testing.T) {
	root := t.TempDir()
	t.Setenv("XDG_STATE_HOME", filepath.Join(root, "state"))
	t.Setenv("FM_LANES_CONFIG", "")
	work := filepath.Join(root, "work")
	if err := os.MkdirAll(work, 0700); err != nil {
		t.Fatal(err)
	}
	t.Chdir(work)
	cwd, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	config, err := loadRuntimeConfig("drop", filepath.Join("models", "converted"))
	if err != nil {
		t.Fatal(err)
	}
	if want := filepath.Join(cwd, "drop"); config.DropIn != want {
		t.Fatalf("drop-in resolved to %q, want %q", config.DropIn, want)
	}
	if want := filepath.Join(cwd, "models", "converted"); config.Ships != want {
		t.Fatalf("ships resolved to %q, want %q", config.Ships, want)
	}
	if want := filepath.Join(cwd, "models"); config.Models != want {
		t.Fatalf("models resolved to %q, want %q", config.Models, want)
	}
}

func TestDropInDirectoriesCannotWriteIntoHomes(t *testing.T) {
	root := t.TempDir()
	home := filepath.Join(root, "home")
	if err := os.MkdirAll(filepath.Join(home, "state"), 0700); err != nil {
		t.Fatal(err)
	}
	outside := filepath.Join(root, "outside")
	if err := os.MkdirAll(outside, 0700); err != nil {
		t.Fatal(err)
	}
	for _, dropIn := range []string{home, filepath.Join(root, "linked")} {
		if dropIn != home {
			if err := os.Symlink(home, dropIn); err != nil {
				t.Fatal(err)
			}
		}
		config := runtimeConfig{StateDir: outside, DropIn: dropIn}
		if err := config.protectHomes(home); err == nil {
			t.Fatalf("accepted drop-in writes inside home through %q", dropIn)
		}
	}
}
