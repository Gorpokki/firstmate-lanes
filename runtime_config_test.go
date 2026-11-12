package main

import (
	"os"
	"path/filepath"
	"testing"
)

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
