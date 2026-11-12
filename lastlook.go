package main

import (
	"encoding/json"
	"errors"
	"os"
	"sort"
	"sync"
	"time"
)

type lastLook struct {
	path string
	mu   sync.Mutex
}
type savedLook struct {
	At     time.Time         `json:"at"`
	States map[string]string `json:"states"`
}

func newLastLook(path string) *lastLook { return &lastLook{path: path} }
func (s *lastLook) apply(f *Fleet) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	data, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		f.ChangedLanes = []string{}
		return nil
	}
	if err != nil {
		return err
	}
	var old savedLook
	if err = json.Unmarshal(data, &old); err != nil {
		return err
	}
	f.ChangedLanes = []string{}
	for _, l := range f.Stations {
		if old.States[l.ID] != l.State {
			f.ChangedLanes = append(f.ChangedLanes, l.ID)
		}
	}
	sort.Strings(f.ChangedLanes)
	return nil
}
func (s *lastLook) save(f Fleet) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	states := map[string]string{}
	for _, l := range f.Stations {
		states[l.ID] = l.State
	}
	return writePrivateJSON(s.path, savedLook{At: f.UpdatedAt, States: states})
}
